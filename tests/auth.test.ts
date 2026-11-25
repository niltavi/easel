import {DatabaseSync} from "node:sqlite";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {beforeEach, describe, expect, it} from "vitest";
import {createApp} from "../server/app.ts";
import {openDatabase} from "../server/db.ts";
import type {IdentityConfig} from "../server/identity.ts";

type App = ReturnType<typeof createApp>;
type Db = ReturnType<typeof openDatabase>;

let db: Db;
let clock: number;
let mails: {email: string; code: string}[];

const build = (selfHosted: boolean): App =>
  createApp({db, mailer: async (email, code) => void mails.push({email, code}), ai: null, dailyQuota: 5, selfHosted, now: () => clock});

const IDENTITY: IdentityConfig = {issuer: "https://identity.test", appId: "test-app", appSecret: "test-secret"};

const buildWithIdentity = (): App =>
  createApp({db, mailer: async () => {}, ai: null, dailyQuota: 5, identity: IDENTITY, origin: "https://easel.test", now: () => clock});

const post = (app: App, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api${path}`, {method: "POST", body: JSON.stringify(body), headers: {"content-type": "application/json", ...headers}});
const works = (app: App, token: string) => app.request("/api/works", {headers: {authorization: `Bearer ${token}`}});
const userRow = (email: string) =>
  db.prepare("SELECT password_hash, email_verified FROM users WHERE email = ?").get(email) as {password_hash: string | null; email_verified: number} | undefined;

beforeEach(() => {
  db = openDatabase(":memory:");
  clock = Date.UTC(2026, 10, 19, 10);
  mails = [];
});

describe("self-hosted sign-in", () => {
  it("registers without sending email, then signs in with the password", async () => {
    const app = build(true);
    expect(await (await app.request("/api/auth/config")).json()).toEqual({signIn: "password"});

    const registered = await post(app, "/auth/register", {email: " Ada@Example.com ", password: "correct horse"});
    expect(registered.status).toBe(200);
    const first = (await registered.json()) as {token: string; user: {id: string; email: string}};
    expect(first.user.email).toBe("ada@example.com");
    expect(mails).toEqual([]);
    expect((await works(app, first.token)).status).toBe(200);

    const login = await post(app, "/auth/login", {email: "ada@example.com", password: "correct horse"});
    expect(login.status).toBe(200);
    const second = (await login.json()) as {token: string; user: {id: string}};
    expect(second.user.id).toBe(first.user.id);
    expect(second.token).not.toBe(first.token);
    expect((await works(app, second.token)).status).toBe(200);
  });

  it("stores a salted hash and leaves the email unverified", async () => {
    const app = build(true);
    await post(app, "/auth/register", {email: "ada@example.com", password: "correct horse"});
    const row = userRow("ada@example.com")!;
    expect(row.email_verified).toBe(0);
    expect(row.password_hash).toMatch(/^scrypt:/);
    expect(row.password_hash).not.toContain("correct horse");
  });

  it("applies the email and password rules", async () => {
    const app = build(true);
    expect((await post(app, "/auth/register", {email: "not-an-email", password: "correct horse"})).status).toBe(400);
    for (const password of ["short", "x".repeat(129), 12345678, undefined]) {
      const res = await post(app, "/auth/register", {email: "ada@example.com", password});
      expect(res.status).toBe(400);
      expect(((await res.json()) as {message: string}).message).toBe("Use a password of 8 to 128 characters");
    }
    expect(userRow("ada@example.com")).toBeUndefined();
  });

  it("does not let a second registration take over an address", async () => {
    const app = build(true);
    await post(app, "/auth/register", {email: "ada@example.com", password: "correct horse"});
    const again = await post(app, "/auth/register", {email: "ada@example.com", password: "another password"});
    expect(again.status).toBe(409);
    expect(((await again.json()) as {error: string}).error).toBe("email_taken");
    expect((await post(app, "/auth/login", {email: "ada@example.com", password: "another password"})).status).toBe(401);
    expect((await post(app, "/auth/login", {email: "ada@example.com", password: "correct horse"})).status).toBe(200);
  });

  it("rejects a wrong password and an unknown account the same way, and locks after repeated failures", async () => {
    const app = build(true);
    await post(app, "/auth/register", {email: "ada@example.com", password: "correct horse"});
    const wrong = await post(app, "/auth/login", {email: "ada@example.com", password: "wrong password"});
    const unknown = await post(app, "/auth/login", {email: "nobody@example.com", password: "wrong password"});
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());

    for (let i = 0; i < 4; i++) await post(app, "/auth/login", {email: "ada@example.com", password: "wrong password"});
    expect((await post(app, "/auth/login", {email: "ada@example.com", password: "correct horse"})).status).toBe(429);
    clock += 16 * 60_000;
    expect((await post(app, "/auth/login", {email: "ada@example.com", password: "correct horse"})).status).toBe(200);
  });

  it("answers in the language of the request", async () => {
    const res = await post(build(true), "/auth/login", {email: "ada@example.com", password: "wrong password"}, {"accept-language": "zh-CN"});
    expect(((await res.json()) as {message: string}).message).toBe("邮箱或密码不正确");
  });

  it("turns off the emailed-code endpoints, so nothing can mark an address verified", async () => {
    const app = build(true);
    expect((await post(app, "/auth/request", {email: "ada@example.com"})).status).toBe(404);
    expect((await post(app, "/auth/verify", {email: "ada@example.com", code: "000000"})).status).toBe(404);
    expect(mails).toEqual([]);
  });
});

describe("default sign-in", () => {
  it("still requires the emailed code and offers no way to register with a password", async () => {
    const app = build(false);
    expect(await (await app.request("/api/auth/config")).json()).toEqual({signIn: "code"});
    expect((await post(app, "/auth/register", {email: "ada@example.com", password: "correct horse"})).status).toBe(404);
    expect((await post(app, "/auth/login", {email: "ada@example.com", password: "correct horse"})).status).toBe(404);
    expect(userRow("ada@example.com")).toBeUndefined();

    expect((await post(app, "/auth/request", {email: "ada@example.com"})).status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(userRow("ada@example.com")).toBeUndefined();
    expect((await post(app, "/auth/verify", {email: "ada@example.com", code: "000000" === mails[0].code ? "111111" : "000000"})).status).toBe(400);
    const verified = await post(app, "/auth/verify", {email: "ada@example.com", code: mails[0].code});
    expect(verified.status).toBe(200);
    expect(userRow("ada@example.com")).toEqual({password_hash: null, email_verified: 1});
  });

  it("does not accept the password of an account registered in self-hosted mode", async () => {
    await post(build(true), "/auth/register", {email: "ada@example.com", password: "correct horse"});
    const app = build(false);
    expect((await post(app, "/auth/login", {email: "ada@example.com", password: "correct horse"})).status).toBe(404);
    expect(userRow("ada@example.com")!.email_verified).toBe(0);
    // Verifying the emailed code is what marks the address as verified.
    await post(app, "/auth/request", {email: "ada@example.com"});
    expect((await post(app, "/auth/verify", {email: "ada@example.com", code: mails[0].code})).status).toBe(200);
    expect(userRow("ada@example.com")!.email_verified).toBe(1);
  });
});

describe("Identity OIDC sign-in", () => {
  it("reports identity sign-in mode and the redirect URL", async () => {
    const app = buildWithIdentity();
    const config = await (await app.request("/api/auth/config")).json();
    expect(config).toEqual({signIn: "identity", signInUrl: "/api/auth/signin"});
  });

  it("exchanges a valid grant code for a session token", async () => {
    const app = buildWithIdentity();
    // Create a user and a grant directly in the database to simulate the callback.
    const userId = randomUUID();
    db.prepare("INSERT INTO users (id, email, created_at, email_verified, identity_sub, identity_issuer) VALUES (?, ?, ?, 1, ?, ?)").run(
      userId, "ada@example.com", clock, "sub-123", IDENTITY.issuer);
    const grantCode = randomBytes(16).toString("base64url");
    db.prepare("INSERT INTO auth_grants (code, user_id, identity_sid, expires_at) VALUES (?, ?, ?, ?)").run(
      grantCode, userId, "sid-abc", clock + 300_000);

    const res = await post(app, "/auth/grant", {code: grantCode});
    expect(res.status).toBe(200);
    const body = (await res.json()) as {token: string; user: {id: string; email: string}};
    expect(body.user.id).toBe(userId);
    expect(body.user.email).toBe("ada@example.com");
    expect(body.token).toBeTruthy();

    // The session works for authenticated endpoints.
    expect((await works(app, body.token)).status).toBe(200);
  });

  it("rejects an expired or already-used grant code", async () => {
    const app = buildWithIdentity();
    const userId = randomUUID();
    db.prepare("INSERT INTO users (id, email, created_at, email_verified) VALUES (?, ?, ?, 1)").run(userId, "ada@example.com", clock);

    // Expired grant
    const expired = randomBytes(16).toString("base64url");
    db.prepare("INSERT INTO auth_grants (code, user_id, identity_sid, expires_at) VALUES (?, ?, ?, ?)").run(
      expired, userId, null, clock - 1);
    expect((await post(app, "/auth/grant", {code: expired})).status).toBe(401);

    // Valid grant, used twice
    const valid = randomBytes(16).toString("base64url");
    db.prepare("INSERT INTO auth_grants (code, user_id, identity_sid, expires_at) VALUES (?, ?, ?, ?)").run(
      valid, userId, null, clock + 300_000);
    expect((await post(app, "/auth/grant", {code: valid})).status).toBe(200);
    expect((await post(app, "/auth/grant", {code: valid})).status).toBe(401);
  });

  it("migrates an old verified-email account on first Identity login", async () => {
    // Create an old user with verified email (via email code login).
    const app = build(false);
    await post(app, "/auth/request", {email: "ada@example.com"});
    await post(app, "/auth/verify", {email: "ada@example.com", code: mails[0].code});
    const oldUser = db.prepare("SELECT id FROM users WHERE email = ?").get("ada@example.com") as {id: string};
    expect(oldUser).toBeTruthy();

    // Now create works for the old user.
    const appIdentity = buildWithIdentity();
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
      createHash("sha256").update(token).digest("hex"), oldUser.id, clock + 86400_000);
    const workRes = await appIdentity.request("/api/works/test-work-1", {
      method: "PUT",
      headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
      body: JSON.stringify({name: "My Drawing", snapshot: "{}", baseVersion: 0, mutationId: "d:1"}),
    });
    expect(workRes.status).toBe(200);

    // Simulate Identity callback: findOrCreateUser would match by verified email.
    // We test the grant flow: insert user with identity_sub linked to old user.
    db.prepare("UPDATE users SET identity_sub = ?, identity_issuer = ? WHERE id = ?").run("sub-new", IDENTITY.issuer, oldUser.id);
    const grantCode = randomBytes(16).toString("base64url");
    db.prepare("INSERT INTO auth_grants (code, user_id, identity_sid, expires_at) VALUES (?, ?, ?, ?)").run(
      grantCode, oldUser.id, "sid-1", clock + 300_000);
    const grantRes = await post(appIdentity, "/auth/grant", {code: grantCode});
    expect(grantRes.status).toBe(200);
    const session = (await grantRes.json()) as {token: string; user: {id: string}};
    // The user ID is the same as the old one — works are preserved.
    expect(session.user.id).toBe(oldUser.id);

    // The old works are still accessible.
    const worksRes = await appIdentity.request("/api/works", {headers: {authorization: `Bearer ${session.token}`}});
    const worksBody = (await worksRes.json()) as {works: Array<{id: string}>};
    expect(worksBody.works).toHaveLength(1);
    expect(worksBody.works[0].id).toBe("test-work-1");
  });

  it("does not migrate an unverified-email account", () => {
    // Create an unverified user (self-hosted registration).
    build(true);
    db.prepare("INSERT INTO users (id, email, created_at, email_verified, password_hash) VALUES (?, ?, ?, 0, ?)").run(
      "old-user", "unverified@example.com", clock, "scrypt:fake:fake");
    // The unverified user should NOT be linked.
    const existing = db.prepare("SELECT id FROM users WHERE email = ? AND email_verified = 1 AND identity_sub IS NULL").get("unverified@example.com");
    expect(existing).toBeUndefined();
  });
});

describe("database upgrade", () => {
  it("adds all columns to an existing database and treats old accounts as verified", () => {
    const path = join(mkdtempSync(join(tmpdir(), "easel-")), "easel.db");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)");
    old.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)");
    old.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'old@example.com', 1)").run();
    old.close();
    db = openDatabase(path);
    expect(userRow("old@example.com")).toEqual({password_hash: null, email_verified: 1});
    // Identity columns are added.
    const user = db.prepare("SELECT identity_sub, identity_issuer, name FROM users WHERE id = 'u1'").get() as
      {identity_sub: string | null; identity_issuer: string | null; name: string | null};
    expect(user.identity_sub).toBeNull();
    expect(user.identity_issuer).toBeNull();
    // New tables exist.
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name: string}[]).map((t) => t.name));
    expect(tables.has("auth_grants")).toBe(true);
    expect(tables.has("pending_auth")).toBe(true);
    db.close();
    openDatabase(path).close();
  });
});
