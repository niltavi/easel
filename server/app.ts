import {createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {Hono, type Context} from "hono";
import {bodyLimit} from "hono/body-limit";
import type {AuthConfig, ErrorCode, PushRequest, Quota, RemoteWork, RemoteWorkInfo, User} from "../shared/api.ts";
import {MAX_AI_OBJECTS, MAX_PROMPT_LENGTH, parseDiagram, validateOps} from "../shared/diagram.ts";
import {AiError, type AiProvider} from "./ai.ts";
import {discover, generatePkce, generateState, buildAuthUrl, exchangeCode, verifyIdToken, checkSession, type IdentityConfig} from "./identity.ts";
import type {Mailer} from "./mail.ts";
import {langOf, message, type MessageKey} from "./messages.ts";

export interface AppOptions {
  db: DatabaseSync;
  mailer: Mailer;
  /** When not configured, the AI endpoint returns "temporarily unavailable". */
  ai: AiProvider | null;
  /** Number of valid previews per account per day; adjustable on the server. */
  dailyQuota: number;
  /**
   * Self-hosted mode: people register and sign in with an email and a password, and no email is ever sent.
   * Off by default, where signing in requires a code emailed to the address.
   */
  selfHosted?: boolean;
  /** Identity OIDC provider. When configured, sign-in goes through Identity. */
  identity?: IdentityConfig;
  /** Public origin of this server, for redirect URIs. */
  origin?: string;
  aiTimeoutMs?: number;
  now?: () => number;
}

const CODE_TTL = 10 * 60_000;
const CODE_RESEND_INTERVAL = 60_000;
const CODE_MAX_ATTEMPTS = 5;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK = 15 * 60_000;
const SESSION_TTL = 30 * 24 * 3600_000;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const DAY = 24 * 3600_000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const isEmail = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isWorkId = (value: string) => /^[\w-]{8,64}$/.test(value);

const isPassword = (value: unknown): value is string => typeof value === "string" && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))));

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("base64url")}:${(await derive(password, salt)).toString("base64url")}`;
}

async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, salt, hash] = (stored ?? "").split(":");
  // Derive a key even when there is nothing to compare with, so a missing account takes as long as a wrong password.
  const key = await derive(password, salt ? Buffer.from(salt, "base64url") : Buffer.alloc(16));
  if (scheme !== "scrypt" || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  return expected.length === key.length && timingSafeEqual(expected, key);
}

type Env = {Variables: {user: User}};

export function createApp({db, mailer, ai, dailyQuota, selfHosted = false, identity, origin, aiTimeoutMs = 60_000, now = Date.now}: AppOptions) {
  const app = new Hono<Env>().basePath("/api");
  const fail = (c: Context, status: 400 | 401 | 404 | 409 | 410 | 413 | 429 | 500 | 502 | 503 | 504, error: ErrorCode, key: MessageKey, extra: object = {}, params: Record<string, string | number> = {}) =>
    c.json({error, message: message(langOf(c.req.header("accept-language")), key, params), ...extra}, status);

  app.onError((error, c) => {
    console.error("[easel]", error);
    return fail(c, 500, "server_error", "serverError");
  });
  app.use("*", bodyLimit({maxSize: MAX_SNAPSHOT_BYTES + 64 * 1024, onError: (c) => fail(c, 413, "too_large", "tooLarge")}));

  const readJson = async (c: Context): Promise<Record<string, unknown> | null> => {
    try {
      const body = await c.req.json();
      return typeof body === "object" && body !== null && !Array.isArray(body) ? body : null;
    } catch {
      return null;
    }
  };

  const startSession = (c: Context, user: User) => {
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), user.id, now() + SESSION_TTL);
    return c.json({token, user: {id: user.id, email: user.email}});
  };

  app.get("/auth/config", (c) => {
    if (identity) return c.json({signIn: "identity", signInUrl: "/api/auth/signin"} satisfies AuthConfig);
    return c.json({signIn: selfHosted ? "password" : "code"} satisfies AuthConfig);
  });

  // ---------- Identity OIDC sign-in ----------

  const GRANT_TTL = 5 * 60_000;
  const PENDING_AUTH_TTL = 10 * 60_000;

  if (identity && origin) {
    const redirectUri = `${origin}/auth/callback`;

    app.get("/auth/signin", async (c) => {
      try {
        const disc = await discover(identity.issuer);
        const {verifier, challenge} = generatePkce();
        const state = generateState();
        db.prepare("INSERT INTO pending_auth (state, code_verifier, redirect_uri, expires_at) VALUES (?, ?, ?, ?)").run(
          state, verifier, redirectUri, now() + PENDING_AUTH_TTL);
        db.prepare("DELETE FROM pending_auth WHERE expires_at < ?").run(now());
        const locale = langOf(c.req.header("accept-language"));
        const url = buildAuthUrl(disc, identity, redirectUri, state, challenge, locale === "zh-CN" ? "zh-CN" : "en");
        return c.redirect(url);
      } catch (error) {
        console.error("[easel] Identity redirect failed", error);
        return c.redirect("/?auth_error=identity_unavailable");
      }
    });
  }

  // Exchange a one-time grant code (from the OIDC callback) for a session token.
  if (identity) {
    app.post("/auth/grant", async (c) => {
      const body = await readJson(c);
      const code = typeof body?.code === "string" ? body.code : "";
      if (!code) return fail(c, 400, "bad_request", "incompleteRequest");
      const grant = db.prepare("SELECT user_id, identity_sid, expires_at FROM auth_grants WHERE code = ?").get(code) as
        | {user_id: string; identity_sid: string | null; expires_at: number}
        | undefined;
      if (!grant || grant.expires_at < now()) {
        if (grant) db.prepare("DELETE FROM auth_grants WHERE code = ?").run(code);
        return fail(c, 401, "invalid_code", "codeExpired");
      }
      db.prepare("DELETE FROM auth_grants WHERE code = ?").run(code);
      const user = db.prepare("SELECT id, email, name, identity_sub FROM users WHERE id = ?").get(grant.user_id) as
        | {id: string; email: string; name: string | null; identity_sub: string | null}
        | undefined;
      if (!user) return fail(c, 401, "unauthorized", "sessionExpired");
      const token = randomBytes(32).toString("base64url");
      db.prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at, identity_sub, identity_sid, last_checked) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(sha256(token), user.id, now() + SESSION_TTL, user.identity_sub, grant.identity_sid, now());
      return c.json({token, user: {id: user.id, email: user.email, name: user.name ?? undefined}});
    });
  }

  // ---------- Sign-in on a self-hosted server: email and password, no email is sent ----------

  // Failed sign-ins per email, kept in memory; enough to slow down guessing against one account.
  const failures = new Map<string, {count: number; until: number}>();

  app.post("/auth/register", async (c) => {
    if (!selfHosted) return fail(c, 404, "not_found", "endpointNotFound");
    const body = await readJson(c);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
    if (!isEmail(email)) return fail(c, 400, "bad_request", "invalidEmail");
    if (!isPassword(body?.password)) return fail(c, 400, "bad_request", "passwordRule");
    // An address that already has an account is never taken over, including one created by an emailed code.
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return fail(c, 409, "email_taken", "emailTaken");
    const user: User = {id: randomUUID(), email};
    // Nothing proved that the address belongs to this person, so it is recorded as unverified.
    db.prepare("INSERT INTO users (id, email, created_at, password_hash, email_verified) VALUES (?, ?, ?, ?, 0)").run(
      user.id, email, now(), await hashPassword(body.password));
    return startSession(c, user);
  });

  app.post("/auth/login", async (c) => {
    if (!selfHosted) return fail(c, 404, "not_found", "endpointNotFound");
    const body = await readJson(c);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password.slice(0, PASSWORD_MAX) : "";
    const failed = failures.get(email);
    if (failed && failed.count >= LOGIN_MAX_FAILURES && failed.until > now()) return fail(c, 429, "rate_limited", "tooManyAttempts");
    const row = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(email) as
      | {id: string; email: string; password_hash: string | null}
      | undefined;
    if (!(await checkPassword(password, row?.password_hash ?? null)) || !row) {
      const count = failed && failed.until > now() ? failed.count + 1 : 1;
      failures.set(email, {count, until: now() + LOGIN_LOCK});
      return fail(c, 401, "invalid_credentials", "invalidCredentials");
    }
    failures.delete(email);
    return startSession(c, {id: row.id, email: row.email});
  });

  // ---------- Sign-in: email verification code ----------

  app.post("/auth/request", async (c) => {
    // A self-hosted server sends no email, so there is no code to request or verify.
    if (selfHosted) return fail(c, 404, "not_found", "endpointNotFound");
    const body = await readJson(c);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
    if (!isEmail(email)) return fail(c, 400, "bad_request", "invalidEmail");
    const existing = db.prepare("SELECT sent_at FROM codes WHERE email = ?").get(email) as {sent_at: number} | undefined;
    if (existing && now() - existing.sent_at < CODE_RESEND_INTERVAL) {
      return fail(c, 429, "rate_limited", "codeJustSent");
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    db.prepare(
      "INSERT INTO codes (email, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?) " +
        "ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at",
    ).run(email, sha256(`${email}:${code}`), now() + CODE_TTL, now());
    try {
      await mailer(email, code, langOf(c.req.header("accept-language")));
    } catch (error) {
      console.error("[easel] failed to send verification code email", error);
      db.prepare("DELETE FROM codes WHERE email = ?").run(email);
      return fail(c, 503, "server_error", "codeNotSent");
    }
    return c.json({ok: true});
  });

  app.post("/auth/verify", async (c) => {
    if (selfHosted) return fail(c, 404, "not_found", "endpointNotFound");
    const body = await readJson(c);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!isEmail(email) || !/^\d{6}$/.test(code)) return fail(c, 400, "invalid_code", "codeIncorrect");
    const row = db.prepare("SELECT code_hash, expires_at, attempts FROM codes WHERE email = ?").get(email) as
      | {code_hash: string; expires_at: number; attempts: number}
      | undefined;
    if (!row || row.expires_at < now() || row.attempts >= CODE_MAX_ATTEMPTS) {
      return fail(c, 400, "invalid_code", "codeExpired");
    }
    const matches = timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(sha256(`${email}:${code}`)));
    if (!matches) {
      db.prepare("UPDATE codes SET attempts = attempts + 1 WHERE email = ?").run(email);
      return fail(c, 400, "invalid_code", "codeIncorrect");
    }
    db.prepare("DELETE FROM codes WHERE email = ?").run(email);
    let user = db.prepare("SELECT id, email FROM users WHERE email = ?").get(email) as User | undefined;
    if (!user) {
      user = {id: randomUUID(), email};
      db.prepare("INSERT INTO users (id, email, created_at, email_verified) VALUES (?, ?, ?, 1)").run(user.id, email, now());
    } else db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(user.id);
    return startSession(c, user);
  });

  // ---------- All endpoints below require sign-in ----------

  const IDENTITY_CHECK_INTERVAL = 60_000;
  const IDENTITY_MAX_STALE = 5 * 60_000;

  app.use("*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const row = token
      ? (db
          .prepare("SELECT u.id, u.email, u.name, s.expires_at, s.identity_sub, s.identity_sid, s.last_checked FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
          .get(sha256(token)) as {id: string; email: string; name: string | null; expires_at: number; identity_sub: string | null; identity_sid: string | null; last_checked: number | null} | undefined)
      : undefined;
    if (!row || row.expires_at < now()) return fail(c, 401, "unauthorized", "sessionExpired");
    // Identity sessions must be validated periodically.
    if (identity && row.identity_sub && row.identity_sid) {
      const lastChecked = row.last_checked ?? 0;
      const stale = now() - lastChecked;
      if (stale >= IDENTITY_CHECK_INTERVAL) {
        try {
          const result = await checkSession(identity, row.identity_sub, row.identity_sid);
          if (!result.active) {
            db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
            return fail(c, 401, "unauthorized", "sessionExpired");
          }
          db.prepare("UPDATE sessions SET last_checked = ? WHERE token_hash = ?").run(now(), sha256(token));
        } catch {
          if (stale >= IDENTITY_MAX_STALE) {
            db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
            return fail(c, 401, "unauthorized", "sessionExpired");
          }
        }
      }
    }
    c.set("user", {id: row.id, email: row.email, name: row.name ?? undefined});
    await next();
  });

  app.post("/auth/signout", (c) => {
    const token = (c.req.header("authorization") ?? "").slice(7);
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    return c.json({ok: true});
  });

  // ---------- Work snapshots ----------

  app.get("/works", (c) => {
    const works = db
      .prepare("SELECT id, name, version, updated_at AS updatedAt FROM works WHERE user_id = ? AND deleted = 0 ORDER BY updated_at DESC")
      .all(c.get("user").id) as unknown as RemoteWorkInfo[];
    return c.json({works});
  });

  app.get("/works/:id", (c) => {
    const row = db
      .prepare("SELECT id, name, version, updated_at AS updatedAt, snapshot, deleted FROM works WHERE user_id = ? AND id = ?")
      .get(c.get("user").id, c.req.param("id")) as (RemoteWork & {deleted: number}) | undefined;
    if (!row) return fail(c, 404, "not_found", "workNotFound");
    if (row.deleted) return fail(c, 410, "gone", "workGone");
    const {deleted: _deleted, ...work} = row;
    return c.json(work);
  });

  /**
   * Commit a new version. Only commits based on the current version are accepted;
   * a late commit gets a 409, and the committer keeps its own changes as a conflict copy.
   */
  app.put("/works/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await readJson(c)) as Partial<PushRequest> | null;
    if (
      !isWorkId(id) ||
      !body ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.length > 120 ||
      typeof body.snapshot !== "string" ||
      !Number.isInteger(body.baseVersion) ||
      (body.baseVersion as number) < 0 ||
      typeof body.mutationId !== "string" ||
      !/^[\w:-]{1,80}$/.test(body.mutationId)
    ) {
      return fail(c, 400, "bad_request", "incompleteRequest");
    }
    if (Buffer.byteLength(body.snapshot) > MAX_SNAPSHOT_BYTES) return fail(c, 413, "too_large", "workTooLarge");
    const userId = c.get("user").id;
    const {name, snapshot, mutationId} = body;
    const baseVersion = body.baseVersion as number;

    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT version, mutation_id, deleted FROM works WHERE user_id = ? AND id = ?").get(userId, id) as
        | {version: number; mutation_id: string; deleted: number}
        | undefined;
      let result: {status: 200; version: number} | {status: 409; version: number; mutationId: string} | {status: 410};
      if (!row) {
        if (baseVersion !== 0) result = {status: 410};
        else {
          db.prepare("INSERT INTO works (id, user_id, name, version, mutation_id, snapshot, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)").run(
            id, userId, name, mutationId, snapshot, now());
          result = {status: 200, version: 1};
        }
      } else if (!row.deleted && row.mutation_id === mutationId) {
        // Retry of the same commit: do not create a new version.
        result = {status: 200, version: row.version};
      } else if (row.deleted && baseVersion !== 0) {
        result = {status: 410};
      } else if (row.deleted || row.version === baseVersion) {
        // Version numbers only ever increase; a work whose sync is turned back on also continues from its previous version.
        const version = row.version + 1;
        db.prepare("UPDATE works SET name = ?, version = ?, mutation_id = ?, snapshot = ?, updated_at = ?, deleted = 0 WHERE user_id = ? AND id = ?").run(
          name, version, mutationId, snapshot, now(), userId, id);
        result = {status: 200, version};
      } else {
        result = {status: 409, version: row.version, mutationId: row.mutation_id};
      }
      db.exec("COMMIT");
      if (result.status === 200) return c.json({version: result.version});
      if (result.status === 410) return fail(c, 410, "gone", "workGone");
      return fail(c, 409, "conflict", "newerVersion", {version: result.version, mutationId: result.mutationId});
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });

  /** Remove the cloud copy. Keeps a record without content, so later commits from offline devices get an explicit "removed". */
  app.delete("/works/:id", (c) => {
    const result = db
      .prepare("UPDATE works SET deleted = 1, snapshot = '', version = version + 1, mutation_id = '', updated_at = ? WHERE user_id = ? AND id = ? AND deleted = 0")
      .run(now(), c.get("user").id, c.req.param("id"));
    if (result.changes === 0) return fail(c, 404, "not_found", "workNotFound");
    return c.json({ok: true});
  });

  // ---------- AI ----------

  const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10);
  const quotaFor = (userId: string): Quota => {
    const row = db.prepare("SELECT count FROM ai_usage WHERE user_id = ? AND day = ?").get(userId, dayKey(now())) as {count: number} | undefined;
    return {
      limit: dailyQuota,
      remaining: Math.max(0, dailyQuota - (row?.count ?? 0)),
      resetAt: (Math.floor(now() / DAY) + 1) * DAY,
    };
  };

  app.get("/ai/quota", (c) => c.json(quotaFor(c.get("user").id)));

  const inFlight = new Set<string>();

  app.post("/ai/preview", async (c) => {
    const userId = c.get("user").id;
    const body = await readJson(c);
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt || prompt.length > MAX_PROMPT_LENGTH) return fail(c, 400, "bad_request", "promptRequired");
    const diagram = parseDiagram(body?.diagram);
    if (!diagram) return fail(c, 400, "bad_request", "diagramInvalid", {}, {max: MAX_AI_OBJECTS});
    if (!ai) return fail(c, 503, "ai_unavailable", "aiUnavailable");
    if (quotaFor(userId).remaining <= 0) return fail(c, 429, "quota_exhausted", "quotaExhausted", {quota: quotaFor(userId)});
    // Handle only one request per account at a time, so concurrency cannot bypass the quota.
    if (inFlight.has(userId)) return fail(c, 429, "rate_limited", "previousInProgress");
    inFlight.add(userId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), aiTimeoutMs);
    c.req.raw.signal.addEventListener("abort", () => controller.abort(), {once: true});
    try {
      const raw = await ai(prompt, diagram, controller.signal);
      // The user already cancelled: return no result and do not consume quota.
      if (c.req.raw.signal.aborted) return c.body(null, 204);
      const checked = validateOps(diagram, raw);
      if (!checked.ok) {
        const empty = Array.isArray(raw) && raw.length === 0;
        return fail(c, 502, "ai_invalid_output", empty ? "aiEmpty" : "aiUnusable");
      }
      // Only results that pass validation and can be previewed count against the quota.
      db.prepare("INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1").run(
        userId, dayKey(now()));
      return c.json({ops: checked.ops, quota: quotaFor(userId)});
    } catch (error) {
      if (error instanceof AiError) {
        if (error.code === "ai_timeout") return fail(c, 504, "ai_timeout", "aiTimeout");
        return fail(c, error.code === "ai_unavailable" ? 503 : 502, error.code, error.key);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      inFlight.delete(userId);
    }
  });

  app.all("*", (c) => fail(c, 404, "not_found", "endpointNotFound"));
  return app;
}

/** OIDC callback, sign-out landing and back-channel notification routes. Mounted at the app root, not under /api. */
export function createIdentityRoutes({db, identity, origin, now = Date.now}: Pick<AppOptions, "db" | "identity" | "origin" | "now">) {
  if (!identity || !origin) return null;
  const routes = new Hono();
  const redirectUri = `${origin}/auth/callback`;

  const GRANT_TTL = 5 * 60_000;

  function findOrCreateUser(sub: string, email: string, emailVerified: boolean, name: string | null): {id: string; email: string; name: string | null; migrated: boolean} {
    // Already linked to this Identity sub?
    const existing = db.prepare("SELECT id, email, name FROM users WHERE identity_sub = ? AND identity_issuer = ?").get(sub, identity!.issuer) as
      | {id: string; email: string; name: string | null}
      | undefined;
    if (existing) {
      if (name && name !== existing.name) db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, existing.id);
      return {...existing, name: name ?? existing.name, migrated: false};
    }

    // Migration: match by verified email.
    if (emailVerified) {
      const byEmail = db.prepare("SELECT id, email, name, email_verified, identity_sub FROM users WHERE email = ?").get(email.toLowerCase()) as
        | {id: string; email: string; name: string | null; email_verified: number; identity_sub: string | null}
        | undefined;
      if (byEmail && byEmail.email_verified === 1 && !byEmail.identity_sub) {
        db.prepare("UPDATE users SET identity_sub = ?, identity_issuer = ?, email_verified = 1, name = COALESCE(?, name) WHERE id = ?").run(
          sub, identity!.issuer, name, byEmail.id);
        return {id: byEmail.id, email: byEmail.email, name: name ?? byEmail.name, migrated: true};
      }
    }

    // New user.
    const id = randomUUID();
    db.prepare(
      "INSERT INTO users (id, email, created_at, email_verified, identity_sub, identity_issuer, name) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(id, email.toLowerCase(), now!(), emailVerified ? 1 : 0, sub, identity!.issuer, name);
    return {id, email: email.toLowerCase(), name, migrated: false};
  }

  routes.get("/auth/callback", async (c) => {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      console.error("[easel] Identity auth error:", error, url.searchParams.get("error_description"));
      return c.redirect("/?auth_error=identity_denied");
    }
    if (!code || !state) return c.redirect("/?auth_error=identity_invalid");

    const pending = db.prepare("SELECT code_verifier, redirect_uri, expires_at FROM pending_auth WHERE state = ?").get(state) as
      | {code_verifier: string; redirect_uri: string; expires_at: number}
      | undefined;
    if (!pending || pending.expires_at < now!()) {
      if (pending) db.prepare("DELETE FROM pending_auth WHERE state = ?").run(state);
      return c.redirect("/?auth_error=identity_expired");
    }
    db.prepare("DELETE FROM pending_auth WHERE state = ?").run(state);

    try {
      const disc = await discover(identity!.issuer);
      const tokens = await exchangeCode(disc, identity!, code, pending.redirect_uri, pending.code_verifier);
      const claims = await verifyIdToken(tokens.id_token, identity!, disc.jwks_uri);
      if (!claims.email) return c.redirect("/?auth_error=identity_no_email");

      const user = findOrCreateUser(claims.sub, claims.email, claims.email_verified ?? false, claims.name ?? null);
      // Store the Identity session ID on the user for session validation.
      if (claims.sid) {
        db.prepare("UPDATE users SET identity_sid = ? WHERE id = ?").run(claims.sid, user.id);
      }

      // Create a one-time grant code that the SPA can exchange for a session token.
      const grantCode = randomBytes(32).toString("base64url");
      db.prepare("INSERT INTO auth_grants (code, user_id, identity_sid, expires_at) VALUES (?, ?, ?, ?)").run(
        grantCode, user.id, claims.sid ?? null, now!() + GRANT_TTL);
      // Clean up expired grants.
      db.prepare("DELETE FROM auth_grants WHERE expires_at < ?").run(now!());

      return c.redirect(`/?auth_grant=${encodeURIComponent(grantCode)}`);
    } catch (err) {
      console.error("[easel] Identity callback failed", err);
      return c.redirect("/?auth_error=identity_failed");
    }
  });

  routes.get("/auth/signed-out", (c) => c.redirect("/"));

  // Back-channel logout notification from Identity.
  routes.post("/auth/notifications", async (c) => {
    try {
      const form = await c.req.formData().catch(() => null);
      const logoutToken = form?.get("logout_token");
      if (typeof logoutToken !== "string") return c.json({error: "missing_token"}, 400);
      const disc = await discover(identity!.issuer);
      const claims = await verifyIdToken(logoutToken, identity!, disc.jwks_uri);
      // Invalidate all sessions for this sub (or just the specific sid).
      if (claims.sid) {
        db.prepare("DELETE FROM sessions WHERE identity_sub = ? AND identity_sid = ?").run(claims.sub, claims.sid);
      } else {
        db.prepare("DELETE FROM sessions WHERE identity_sub = ?").run(claims.sub);
      }
      return c.body(null, 200);
    } catch (err) {
      console.error("[easel] back-channel logout failed", err);
      return c.json({error: "invalid_token"}, 400);
    }
  });

  return routes;
}
