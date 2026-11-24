// The API contract between the browser and the server.
import type {Diagram, DiagramOp} from "./diagram.ts";

export interface User {
  id: string;
  email: string;
  name?: string;
}

/** How this server signs people in. */
export interface AuthConfig {
  signIn: "code" | "password" | "identity";
  /** When signIn is "identity", the URL to navigate to for sign-in. */
  signInUrl?: string;
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
