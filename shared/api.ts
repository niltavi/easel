// The API contract between the browser and the server.
import type {Diagram, DiagramOp} from "./diagram.ts";

export interface User {
  id: string;
  email: string;
  name?: string;
}

/** The sign-in methods this server offers right now. */
export interface AuthConfig {
  /** Email and password, handled by this server. */
  localLogin: boolean;
  /** Niltavi Identity, a third-party sign-in method. */
  identityLogin: boolean;
  /** Where to send people for Identity sign-in. Present when identityLogin is true. */
  signInUrl?: string;
}

/** Counts and the state of each sign-in method, for the console's overview. */
export interface AdminOverview {
  counts: {accounts: number; admins: number; identityAccounts: number; works: number};
  localLogin: boolean;
  identityLogin: boolean;
  identityReady: boolean;
  publicOrigin: string | null;
  aiConfigured: boolean;
}

/** Sign-in settings. The client secret is never sent back; only whether one is saved. */
export interface AdminSignIn {
  localLogin: boolean;
  identityLogin: boolean;
  identity: {
    issuer: string;
    appId: string;
    appSecretSaved: boolean;
    /** Whether all Identity settings are present and Identity can be turned on. */
    ready: boolean;
    /** The address Identity must redirect to, derived from the public address. */
    callbackUrl: string | null;
  };
}

export interface AdminSignInInput {
  localLogin: boolean;
  identityLogin: boolean;
  /** Omit to leave the saved Identity settings alone. An empty appSecret keeps the saved one. */
  identity?: {issuer: string; appId: string; appSecret?: string};
}

export interface AdminAccount {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "user";
  createdAt: number;
  works: number;
  identity: boolean;
}

export interface AdminGeneral {
  publicOrigin: string;
  aiDailyQuota: number;
  aiConfigured: boolean;
}

export interface RemoteWorkInfo {
  id: string;
  name: string;
  version: number;
  updatedAt: number;
}

export interface RemoteWork extends RemoteWorkInfo {
  /** The serialized .easel document. The server does not parse the content. */
  snapshot: string;
}

export interface PushRequest {
  name: string;
  snapshot: string;
  /** The cloud version this change is based on; 0 for the first upload. */
  baseVersion: number;
  /** Stays the same when the same content is retried; the server deduplicates on it. */
  mutationId: string;
}

export interface PushConflict {
  version: number;
  mutationId: string;
}

export interface Quota {
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface AiRequest {
  prompt: string;
  diagram: Diagram;
}

export interface AiResponse {
  ops: DiagramOp[];
  quota: Quota;
}

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "rate_limited"
  | "invalid_code"
  | "invalid_credentials"
  | "login_disabled"
  | "forbidden"
  | "email_taken"
  | "not_found"
  | "conflict"
  | "gone"
  | "too_large"
  | "quota_exhausted"
  | "ai_unavailable"
  | "ai_invalid_output"
  | "ai_timeout"
  | "server_error";

export interface ErrorBody {
  error: ErrorCode;
  message: string;
}
