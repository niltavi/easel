import {locale, t} from "./i18n.ts";
import type {AdminAccount, AdminGeneral, AdminOverview, AdminSignIn, AdminSignInInput, AiRequest, AuthConfig, AiResponse, ErrorBody, ErrorCode, PushRequest, Quota, RemoteWork, RemoteWorkInfo, User} from "../../shared/api.ts";

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
        "accept-language": locale,
        ...(body === undefined ? {} : {"content-type": "application/json"}),
        ...(token ? {authorization: `Bearer ${token}`} : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw new ApiError("aborted", 0, t("api.aborted"));
    throw new ApiError("network", 0, t("api.network"), error);
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
    throw new ApiError(error?.error ?? "server_error", response.status, error?.message ?? t("api.unavailable"), json);
  }
  return json as T;
}

export const api = {
  authConfig: () => request<AuthConfig>("GET", "/auth/config"),
  register: (email: string, password: string) => request<{token: string; user: User}>("POST", "/auth/register", {body: {email, password}}),
  login: (email: string, password: string) => request<{token: string; user: User}>("POST", "/auth/login", {body: {email, password}}),
  exchangeGrant: (code: string) => request<{token: string; user: User}>("POST", "/auth/grant", {body: {code}}),
  admin: {
    overview: (token: string) => request<AdminOverview>("GET", "/admin/overview", {token}),
    signIn: (token: string) => request<AdminSignIn>("GET", "/admin/sign-in", {token}),
    saveSignIn: (token: string, body: AdminSignInInput) => request<AdminSignIn>("PUT", "/admin/sign-in", {token, body}),
    testIdentity: (token: string, issuer?: string) =>
      request<{ok: true; issuer: string; authorizationEndpoint: string}>("POST", "/admin/sign-in/test", {token, body: issuer ? {issuer} : {}}),
    accounts: (token: string, query: string) =>
      request<{accounts: AdminAccount[]}>("GET", `/admin/accounts${query ? `?q=${encodeURIComponent(query)}` : ""}`, {token}),
    setRole: (token: string, id: string, role: "admin" | "user") =>
      request<{id: string; role: "admin" | "user"}>("POST", `/admin/accounts/${encodeURIComponent(id)}/role`, {token, body: {role}}),
    general: (token: string) => request<AdminGeneral>("GET", "/admin/general", {token}),
    saveGeneral: (token: string, body: Pick<AdminGeneral, "publicOrigin" | "aiDailyQuota">) => request<AdminGeneral>("PUT", "/admin/general", {token, body}),
  },
  signOut: (token: string) => request<{ok: true}>("POST", "/auth/signout", {token}),
  listWorks: (token: string) => request<{works: RemoteWorkInfo[]}>("GET", "/works", {token}),
  getWork: (token: string, id: string) => request<RemoteWork>("GET", `/works/${id}`, {token}),
  pushWork: (token: string, id: string, body: PushRequest) => request<{version: number}>("PUT", `/works/${id}`, {token, body}),
  deleteWork: (token: string, id: string) => request<{ok: true}>("DELETE", `/works/${id}`, {token}),
  quota: (token: string) => request<Quota>("GET", "/ai/quota", {token}),
  aiPreview: (token: string, body: AiRequest, signal: AbortSignal) => request<AiResponse>("POST", "/ai/preview", {token, body, signal}),
};
