import type {AiRequest, AiResponse, ErrorBody, ErrorCode, PushRequest, Quota, RemoteWork, RemoteWorkInfo, User} from "../../shared/api.ts";

export class ApiError extends Error {
  readonly code: ErrorCode | "network" | "aborted";
  readonly status: number;
  readonly body: unknown;
  constructor(code: ErrorCode | "network" | "aborted", status: number, message: string, body?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

interface Options {
  token?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, {token, body, signal}: Options = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      headers: {
        ...(body === undefined ? {} : {"content-type": "application/json"}),
        ...(token ? {authorization: `Bearer ${token}`} : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw new ApiError("aborted", 0, "已取消");
    throw new ApiError("network", 0, "网络不可用", error);
  }
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON responses such as gateway error pages are treated as a service failure.
  }
  if (!response.ok) {
    const error = json as Partial<ErrorBody> | null;
    throw new ApiError(error?.error ?? "server_error", response.status, error?.message ?? "服务暂时不可用", json);
  }
  return json as T;
}

export const api = {
  requestCode: (email: string) => request<{ok: true}>("POST", "/auth/request", {body: {email}}),
  verifyCode: (email: string, code: string) => request<{token: string; user: User}>("POST", "/auth/verify", {body: {email, code}}),
  signOut: (token: string) => request<{ok: true}>("POST", "/auth/signout", {token}),
  listWorks: (token: string) => request<{works: RemoteWorkInfo[]}>("GET", "/works", {token}),
  getWork: (token: string, id: string) => request<RemoteWork>("GET", `/works/${id}`, {token}),
  pushWork: (token: string, id: string, body: PushRequest) => request<{version: number}>("PUT", `/works/${id}`, {token, body}),
  deleteWork: (token: string, id: string) => request<{ok: true}>("DELETE", `/works/${id}`, {token}),
  quota: (token: string) => request<Quota>("GET", "/ai/quota", {token}),
  aiPreview: (token: string, body: AiRequest, signal: AbortSignal) => request<AiResponse>("POST", "/ai/preview", {token, body, signal}),
};
