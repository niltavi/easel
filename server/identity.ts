// OIDC client for Niltavi Identity: discovery, PKCE, token exchange, ID token verification via JWKS, session validation.
import {createHash, randomBytes} from "node:crypto";
import {createPublicKey, verify} from "node:crypto";

export interface IdentityConfig {
  issuer: string;
  appId: string;
  appSecret: string;
}

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint: string;
  jwks_uri: string;
}

interface JwkRsa {
  kty: "RSA";
  kid: string;
  n: string;
  e: string;
  use?: string;
  alg?: string;
}

interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  locale?: string;
  sid?: string;
  orgs?: Array<{org_id: string; name: string; role: string; personal: boolean}>;
}

export interface IdentityUser {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  sid: string | null;
}

// Keyed by URL: the administrator can change the issuer, so a cache for one issuer must never answer for another.
const discoveryCache = new Map<string, {data: OidcDiscovery; fetchedAt: number}>();
const jwksCache = new Map<string, {keys: JwkRsa[]; fetchedAt: number}>();

const DISCOVERY_TTL = 3600_000;
const JWKS_TTL = 3600_000;

export async function discover(issuer: string): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL) return cached.data;
  const response = await fetch(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`, {signal: AbortSignal.timeout(8_000)});
  if (!response.ok) throw new Error(`OIDC discovery failed: ${response.status}`);
  const data = (await response.json()) as OidcDiscovery;
  if (!data.authorization_endpoint || !data.token_endpoint || !data.jwks_uri) throw new Error("OIDC discovery document is incomplete");
  discoveryCache.set(issuer, {data, fetchedAt: Date.now()});
  return data;
}

async function fetchJwks(jwksUri: string): Promise<JwkRsa[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL) return cached.keys;
  const response = await fetch(jwksUri);
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
  const data = (await response.json()) as {keys: JwkRsa[]};
  const keys = data.keys.filter((k) => k.kty === "RSA");
  jwksCache.set(jwksUri, {keys, fetchedAt: Date.now()});
  return keys;
}

function base64urlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function base64urlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function generatePkce(): {verifier: string; challenge: string} {
  const verifier = base64urlEncode(randomBytes(32));
  const challenge = base64urlEncode(createHash("sha256").update(verifier).digest());
  return {verifier, challenge};
}

export function generateState(): string {
  return base64urlEncode(randomBytes(16));
}

export function buildAuthUrl(
  discovery: OidcDiscovery,
  config: IdentityConfig,
  redirectUri: string,
  state: string,
  challenge: string,
  locale?: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.appId,
    redirect_uri: redirectUri,
    scope: "openid email profile orgs",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (locale) params.set("ui_locales", locale);
  return `${discovery.authorization_endpoint}?${params}`;
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export async function exchangeCode(
  discovery: OidcDiscovery,
  config: IdentityConfig,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const credentials = Buffer.from(`${config.appId}:${config.appSecret}`).toString("base64");
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${credentials}`,
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }
  return (await response.json()) as TokenResponse;
}

function decodeJwtPart(part: string): unknown {
  return JSON.parse(base64urlDecode(part).toString("utf8"));
}

export async function verifyIdToken(
  idToken: string,
  config: IdentityConfig,
  jwksUri: string,
): Promise<IdTokenClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid ID token format");
  const header = decodeJwtPart(parts[0]) as {alg: string; kid?: string};
  if (header.alg !== "RS256") throw new Error(`Unsupported ID token algorithm: ${header.alg}`);
  const keys = await fetchJwks(jwksUri);
  const key = header.kid ? keys.find((k) => k.kid === header.kid) : keys[0];
  if (!key) throw new Error("No matching JWK found for ID token");
  const publicKey = createPublicKey({key: {kty: key.kty, n: key.n, e: key.e}, format: "jwk"});
  const signature = base64urlDecode(parts[2]);
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!verify("RSA-SHA256", data, publicKey, signature)) throw new Error("ID token signature verification failed");
  const claims = decodeJwtPart(parts[1]) as IdTokenClaims;
  if (claims.iss !== config.issuer) throw new Error(`ID token issuer mismatch: ${claims.iss}`);
  if (claims.aud !== config.appId) throw new Error(`ID token audience mismatch: ${claims.aud}`);
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now - 60) throw new Error("ID token expired");
  return claims;
}

export async function checkSession(
  config: IdentityConfig,
  sub: string,
  sid: string,
): Promise<{active: boolean; orgs?: IdTokenClaims["orgs"]}> {
  const credentials = Buffer.from(`${config.appId}:${config.appSecret}`).toString("base64");
  const response = await fetch(`${config.issuer}/apps/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({sub, sid}),
  });
  if (!response.ok) throw new Error(`Session check failed: ${response.status}`);
  return (await response.json()) as {active: boolean; orgs?: IdTokenClaims["orgs"]};
}

export type {OidcDiscovery, IdTokenClaims};
