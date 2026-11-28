import {DatabaseSync} from "node:sqlite";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {beforeEach, describe, expect, it} from "vitest";
import {createApp} from "../server/app.ts";
import {openDatabase} from "../server/db.ts";

type App = ReturnType<typeof createApp>;
type Db = ReturnType<typeof openDatabase>;

let db: Db;
let clock: number;
let mails: {email: string; code: string}[];

const build = (selfHosted: boolean): App =>
  createApp({db, mailer: async (email, code) => void mails.push({email, code}), ai: null, dailyQuota: 5, selfHosted, now: () => clock});

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

  it("returns a conflict when two requests register the same address at once", async () => {
    const app = build(true);
    const first = {email: "ada@example.com", password: "first password"};
    const second = {email: "ADA@example.com", password: "second password"};
    const responses = await Promise.all([post(app, "/auth/register", first), post(app, "/auth/register", second)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const accepted = responses[0].ok ? first : second;
    expect((await post(app, "/auth/login", accepted)).status).toBe(200);
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

describe("database upgrade", () => {
  it("adds the new account columns to an existing database and treats old accounts as verified", () => {
    const path = join(mkdtempSync(join(tmpdir(), "easel-")), "easel.db");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)");
    old.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'old@example.com', 1)").run();
    old.close();
    db = openDatabase(path);
    expect(userRow("old@example.com")).toEqual({password_hash: null, email_verified: 1});
    db.close();
    openDatabase(path).close();
  });
});
