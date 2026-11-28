// Server settings the administrator manages in the console. A value saved there wins; the environment fills in what was never saved.
import type {DatabaseSync} from "node:sqlite";
import type {IdentityConfig} from "./identity.ts";

export interface EnvDefaults {
  identity?: IdentityConfig;
  origin?: string;
  dailyQuota: number;
}

export function createSettings(db: DatabaseSync, env: EnvDefaults) {
  const read = (key: string): string | undefined => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as {value: string} | undefined)?.value;
  const write = (key: string, value: string) =>
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  const clear = (key: string) => db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  const flag = (key: string, fallback: boolean) => {
    const value = read(key);
    return value === undefined ? fallback : value === "1";
  };

  /** Identity credentials, or null while any part is missing. */
  const identity = (): IdentityConfig | null => {
    const issuer = read("identity_issuer") || env.identity?.issuer || "";
    const appId = read("identity_app_id") || env.identity?.appId || "";
    const appSecret = read("identity_app_secret") || env.identity?.appSecret || "";
    return issuer && appId && appSecret ? {issuer, appId, appSecret} : null;
  };

  /** The public address of this server, used for Identity redirects. */
  const origin = (): string | null => (read("public_origin") || env.origin || "").replace(/\/+$/, "") || null;

  const identityReady = () => identity() !== null && origin() !== null;

  /** Which sign-in methods are on. Local sign-in stays on when nothing else can be used, so the server stays reachable. */
  const methods = (): {localLogin: boolean; identityLogin: boolean} => {
    const identityLogin = identityReady() && flag("identity_login", false);
    return {localLogin: flag("local_login", true) || !identityLogin, identityLogin};
  };

  const aiDailyQuota = () => {
    const value = Number(read("ai_daily_quota"));
    return Number.isInteger(value) && read("ai_daily_quota") !== undefined ? value : env.dailyQuota;
  };

  return {
    read,
    write,
    clear,
    flag,
    identity,
    origin,
    identityReady,
    methods,
    aiDailyQuota,
    /** The saved value, or the environment's when nothing was saved. Used to show what is in effect. */
    identitySource: () => ({
      issuer: read("identity_issuer") ?? env.identity?.issuer ?? "",
      appId: read("identity_app_id") ?? env.identity?.appId ?? "",
      appSecretSaved: Boolean(read("identity_app_secret") || env.identity?.appSecret),
      origin: read("public_origin") ?? env.origin ?? "",
    }),
  };
}

export type Settings = ReturnType<typeof createSettings>;
