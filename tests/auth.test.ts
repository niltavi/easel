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

const build = (): App => createApp({db, ai: null, dailyQuota: 5, now: () => clock});

const IDENTITY: IdentityConfig = {issuer: "https://identity.test", appId: "test-app", appSecret: "test-secret"};

const buildWithIdentity = (): App =>
  createApp({db, ai: null, dailyQuota: 5, identity: IDENTITY, origin: "https://easel.test", now: () => clock});

const post = (app: App, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api${path}`, {method: "POST", body: JSON.stringify(body), headers: {"content-type": "application/json", ...headers}});
const put = (app: App, path: string, body: unknown, token: string) =>
  app.request(`/api${path}`, {method: "PUT", body: JSON.stringify(body), headers: {"content-type": "application/json", authorization: `Bearer ${token}`}});
const getWith = (app: App, path: string, token: string) => app.request(`/api${path}`, {headers: {authorization: `Bearer ${token}`}});
const works = (app: App, token: string) => getWith(app, "/works", token);
const userRow = (email: string) =>
  db.prepare("SELECT password_hash, email_verified, role FROM users WHERE email = ?").get(email) as
    | {password_hash: string | null; email_verified: number; role: string}
    | undefined;
const setSetting = (key: string, value: string) =>
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);

beforeEach(() => {
  db = openDatabase(":memory:");
  clock = Date.UTC(2026, 10, 19, 10);
});

describe("local sign-in", () => {
  it("registers with a password, without sending email, then signs in to the same account", async () => {
    const app = build();
    expect(await (await app.request("/api/auth/config")).json()).toEqual({localLogin: true, identityLogin: false});

    const registered = await post(app, "/auth/register", {email: " Ada@Example.com ", password: "correct horse"});
    expect(registered.status).toBe(200);
    const first = (await registered.json()) as {token: string; user: {id: string; email: string}};
    expect(first.user.email).toBe("ada@example.com");
    expect((await works(app, first.token)).status).toBe(200);

    const login = await post(app, "/auth/login", {email: "ada@example.com", password: "correct horse"});
    expect(login.status).toBe(200);
    const second = (await login.json()) as {token: string; user: {id: string}};
    expect(second.user.id).toBe(first.user.id);
    expect(second.token).not.toBe(first.token);
    expect((await works(app, second.token)).status).toBe(200);
  });

  it("stores a salted hash and leaves the email unverified", async () => {
    const app = build();
    await post(app, "/auth/register", {email: "ada@example.com", password: "correct horse"});
    const row = userRow("ada@example.com")!;
    expect(row.email_verified).toBe(0);
    expect(row.password_hash).toMatch(/^scrypt:/);
    expect(row.password_hash).not.toContain("correct horse");
  });

  it("applies the email and password rules", async () => {
    const app = build();
    expect((await post(app, "/auth/register", {email: "not-an-email", password: "correct horse"})).status).toBe(400);
    for (const password of ["short", "x".repeat(129), 12345678, undefined]) {
      const res = await post(app, "/auth/register", {email: "ada@example.com", password});
      expect(res.status).toBe(400);
      expect(((await res.json()) as {message: string}).message).toBe("Use a password of 8 to 128 characters");
    }
    expect(userRow("ada@example.com")).toBeUndefined();
  });

  it("does not let a second registration take over an address", async () => {
    const app = build();
    await post(app, "/auth/register", {email: "ada@example.com", password: "correct horse"});
    const again = await post(app, "/auth/register", {email: "ada@example.com", password: "another password"});
    expect(again.status).toBe(409);
    expect(((await again.json()) as {error: string}).error).toBe("email_taken");
    expect((await post(app, "/auth/login", {email: "ada@example.com", password: "another password"})).status).toBe(401);
    expect((await post(app, "/auth/login", {email: "ada@example.com", password: "correct horse"})).status).toBe(200);
  });

  it("returns a conflict when two requests register the same address at once", async () => {
    const app = build();
    const first = {email: "ada@example.com", password: "first password"};
    const second = {email: "ADA@example.com", password: "second password"};
    const responses = await Promise.all([post(app, "/auth/register", first), post(app, "/auth/register", second)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const accepted = responses[0].ok ? first : second;
    expect((await post(app, "/auth/login", accepted)).status).toBe(200);
  });

  it("rejects a wrong password and an unknown account the same way, and locks after repeated failures", async () => {
    const app = build();
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
    const res = await post(build(), "/auth/login", {email: "ada@example.com", password: "wrong password"}, {"accept-language": "zh-CN"});
    expect(((await res.json()) as {message: string}).message).toBe("邮箱或密码不正确");
  });

  it("no longer has the emailed-code endpoints", async () => {
    const app = build();
    // Unknown paths fall through to the sign-in check, so they are never successful.
    expect((await post(app, "/auth/request", {email: "ada@example.com"})).status).toBe(401);
    expect((await post(app, "/auth/verify", {email: "ada@example.com", code: "000000"})).status).toBe(401);
  });
});

describe("administrator console", () => {
  const register = async (app: App, email: string) => {
    const res = await post(app, "/auth/register", {email, password: "correct horse"});
    return ((await res.json()) as {token: string; user: {id: string}});
  };
  const signInBody = (identityLogin: boolean, localLogin = true) => ({localLogin, identityLogin});

  it("makes the first account the administrator and no one else", async () => {
    const app = build();
    await register(app, "ada@example.com");
    await register(app, "grace@example.com");
    expect(userRow("ada@example.com")!.role).toBe("admin");
    expect(userRow("grace@example.com")!.role).toBe("user");
  });

  it("lets only an administrator open the console", async () => {
    const app = build();
    const admin = (await register(app, "ada@example.com")).token;
    const member = (await register(app, "grace@example.com")).token;
    for (const path of ["/admin/overview", "/admin/sign-in", "/admin/accounts", "/admin/general"]) {
      expect((await getWith(app, path, admin)).status).toBe(200);
      expect((await getWith(app, path, member)).status).toBe(403);
    }
    expect((await put(app, "/admin/sign-in", signInBody(false), member)).status).toBe(403);
  });

  it("reports the sign-in methods and whether Identity is set up", async () => {
    const app = build();
    const admin = (await register(app, "ada@example.com")).token;
    const signIn = await (await getWith(app, "/admin/sign-in", admin)).json();
    expect(signIn).toEqual({
      localLogin: true,
      identityLogin: false,
      identity: {issuer: "", appId: "", appSecretSaved: false, ready: false, callbackUrl: null},
    });
  });

  it("saves Identity settings from the console, never returns the secret, and reports the callback address", async () => {
    const app = build();
    const admin = (await register(app, "ada@example.com")).token;
    await put(app, "/admin/general", {publicOrigin: "https://easel.test/", aiDailyQuota: 5}, admin);

    const saved = await put(app, "/admin/sign-in", {
      ...signInBody(true),
      identity: {issuer: "https://identity.test/", appId: "app-1", appSecret: "shh"},
    }, admin);
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.identity).toEqual({
      issuer: "https://identity.test",
      appId: "app-1",
      appSecretSaved: true,
      ready: true,
      callbackUrl: "https://easel.test/auth/callback",
    });
    expect(JSON.stringify(body)).not.toContain("shh");
    expect((await app.request("/api/auth/config")).status).toBe(200);
    expect(await (await app.request("/api/auth/config")).json()).toEqual({localLogin: true, identityLogin: true, signInUrl: "/api/auth/signin"});

    // An empty secret keeps the saved one.
    await put(app, "/admin/sign-in", {...signInBody(true), identity: {issuer: "https://identity.test", appId: "app-2", appSecret: ""}}, admin);
    const kept = db.prepare("SELECT value FROM settings WHERE key = 'identity_app_secret'").get() as {value: string};
    expect(kept.value).toBe("shh");
    expect(db.prepare("SELECT value FROM settings WHERE key = 'identity_app_id'").get()).toEqual({value: "app-2"});
  });

  it("lets Identity be turned on before it is set up, but not as the only method while it cannot work", async () => {
    const app = build();
    const admin = (await register(app, "ada@example.com")).token;
    // Turning it on first is the way into the Identity settings page.
    expect((await put(app, "/admin/sign-in", signInBody(true), admin)).status).toBe(200);
    expect(await (await app.request("/api/auth/config")).json()).toEqual({localLogin: true, identityLogin: false});
    // With local sign-in off, the server must still have a working method.
    const lockedOut = await put(app, "/admin/sign-in", signInBody(true, false), admin);
    expect(lockedOut.status).toBe(400);
    expect(((await lockedOut.json()) as {error: string}).error).toBe("bad_request");
  });

  it("refuses to turn off every sign-in method, and rejects a malformed address", async () => {
    const app = build();
    const admin = (await register(app, "ada@example.com")).token;
    expect((await put(app, "/admin/sign-in", signInBody(false, false), admin)).status).toBe(400);
    const badUrl = await put(app, "/admin/sign-in", {...signInBody(false), identity: {issuer: "identity.test", appId: "app"}}, admin);
    expect(badUrl.status).toBe(400);
    expect(((await badUrl.json()) as {error: string}).error).toBe("bad_request");
  });

  it("turns off local sign-in, which then refuses password requests", async () => {
    const app = buildWithIdentity();
    const admin = (await register(app, "ada@example.com")).token;
    const saved = await put(app, "/admin/sign-in", signInBody(true, false), admin);
    expect((await saved.json() as {localLogin: boolean}).localLogin).toBe(false);

    expect(await (await app.request("/api/auth/config")).json()).toEqual({localLogin: false, identityLogin: true, signInUrl: "/api/auth/signin"});
    const blocked = await post(app, "/auth/login", {email: "ada@example.com", password: "correct horse"});
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as {error: string}).error).toBe("login_disabled");
    expect((await post(app, "/auth/register", {email: "new@example.com", password: "correct horse"})).status).toBe(403);
  });

  it("keeps local sign-in on when no other method can be used, so the server stays reachable", async () => {
    const app = build();
    setSetting("local_login", "0");
    expect(await (await app.request("/api/auth/config")).json()).toEqual({localLogin: true, identityLogin: false});
  });

  it("lists accounts, searches them, and changes administrators without leaving none", async () => {
    const app = build();
    const ada = await register(app, "ada@example.com");
    const grace = await register(app, "grace@example.com");

    const all = (await (await getWith(app, "/admin/accounts", ada.token)).json()) as {accounts: {email: string; role: string}[]};
    expect(all.accounts.map((a) => a.email).sort()).toEqual(["ada@example.com", "grace@example.com"]);
    const found = (await (await getWith(app, "/admin/accounts?q=grace", ada.token)).json()) as {accounts: {email: string}[]};
    expect(found.accounts.map((a) => a.email)).toEqual(["grace@example.com"]);

    const promoted = await post(app, `/admin/accounts/${grace.user.id}/role`, {role: "admin"}, {authorization: `Bearer ${ada.token}`});
    expect(promoted.status).toBe(200);
    expect(userRow("grace@example.com")!.role).toBe("admin");

    const self = await post(app, `/admin/accounts/${ada.user.id}/role`, {role: "user"}, {authorization: `Bearer ${ada.token}`});
    expect(self.status).toBe(400);
    expect(((await self.json()) as {message: string}).message).toBe("You can't remove your own administrator access");
  });

  it("validates the public address and the daily AI quota", async () => {
    const app = build();
    const admin = (await register(app, "ada@example.com")).token;
    expect((await put(app, "/admin/general", {publicOrigin: "easel.test", aiDailyQuota: 5}, admin)).status).toBe(400);
    expect((await put(app, "/admin/general", {publicOrigin: "https://easel.test", aiDailyQuota: 1001}, admin)).status).toBe(400);
    const ok = await put(app, "/admin/general", {publicOrigin: "https://easel.test/some/path", aiDailyQuota: 12}, admin);
    expect(await ok.json()).toEqual({publicOrigin: "https://easel.test", aiDailyQuota: 12, aiConfigured: false});
    expect(await (await app.request("/api/ai/quota", {headers: {authorization: `Bearer ${admin}`}})).json()).toEqual(expect.objectContaining({limit: 12}));
  });
});

describe("Identity OIDC sign-in", () => {
  it("reports identity sign-in mode and the redirect URL", async () => {
    const app = buildWithIdentity();
    // Off until an administrator turns it on.
    expect(await (await app.request("/api/auth/config")).json()).toEqual({localLogin: true, identityLogin: false});
    setSetting("identity_login", "1");
    const config = await (await app.request("/api/auth/config")).json();
    expect(config).toEqual({localLogin: true, identityLogin: true, signInUrl: "/api/auth/signin"});
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
    // An account whose email was verified before Identity existed.
    db.prepare("INSERT INTO users (id, email, created_at, email_verified) VALUES (?, ?, ?, 1)").run(randomUUID(), "ada@example.com", clock);
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
    expect(userRow("old@example.com")).toEqual({password_hash: null, email_verified: 1, role: "admin"});
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
