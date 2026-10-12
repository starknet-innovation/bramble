import type { ApiRequest, ApiResponse } from "./http.js";
export {
  AVNU_PAYMASTER_URL,
  PRIVATE_SWAP_FEE_TOKEN,
  PRIVACY_POOL_ADDRESS,
} from "../../shared/privacy.js";

const HTTPS_PROTOCOL = "https:";
const LOCAL_ORIGINS = new Set([
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5273",
  "http://localhost:3000",
  "http://localhost:5273",
]);

/**
 * How long the STRK20 gateway waits for each upstream before answering 504
 * `upstream_timeout`. The wallet's own paymaster deadline must end first
 * (`PAYMASTER_TIMEOUT_MS` in `packages/features/privacy`, pinned by a
 * conformance test), so a slow relay surfaces in the wallet as its own
 * deadline expiry rather than as a gateway status.
 */
export const PAYMASTER_UPSTREAM_TIMEOUT_MS = 25_000;
/** The prover's upstream deadline: proving takes far longer than a relay call. */
export const PROVER_UPSTREAM_TIMEOUT_MS = 110_000;
export const MAX_PROOF_CHARACTERS = 512 * 1024;
export const MAX_PROOF_FACTS = 4_096;
export const MAX_CALLDATA_FELTS = 4_096;

export type GatewayAudience = "extension" | "terminal";

type OriginDecision =
  | { readonly allowed: false }
  | { readonly allowed: true; readonly origin?: string };

const configuredOrigins = (name: string): readonly string[] =>
  (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const validConfiguredOrigin = (origin: string, audience: GatewayAudience): boolean => {
  if (audience === "extension") {
    return EXTENSION_ORIGIN_SHAPE.test(origin);
  }
  if (LOCAL_ORIGINS.has(origin)) {
    return true;
  }
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      url.origin === origin &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

const expectedOrigins = (audience: GatewayAudience): ReadonlySet<string> => {
  const configured =
    audience === "extension"
      ? configuredOrigins("BRAMBLE_EXTENSION_ORIGINS")
      : configuredOrigins("TERMINAL_ALLOWED_ORIGINS");
  const valid = configured.filter((origin) => validConfiguredOrigin(origin, audience));
  if (valid.length > 0 && valid.length === configured.length) {
    return new Set(valid);
  }
  if (configured.length > 0) {
    return new Set();
  }
  return audience === "terminal"
    ? new Set(["https://mc-wallet-terminal.vercel.app", ...LOCAL_ORIGINS])
    : new Set();
};

const EXTENSION_ORIGIN_SHAPE = /^chrome-extension:\/\/[a-p]{32}$/;

// Chrome omits Origin and Referer from privileged extension GET fetches, but
// always stamps extension POSTs with the extension's own chrome-extension://
// origin, so both header shapes are the same privileged fetch. Fetch Metadata
// remains browser-controlled: requiring this exact non-navigation shape blocks
// website fetches, forms, and address-bar navigations, and a website can never
// present a chrome-extension:// origin. It is not software attestation; non-
// browser clients can spoof HTTP headers, so deployment rate limits remain
// mandatory.
const isPrivilegedExtensionFetch = (request: ApiRequest): boolean =>
  (request.headers.origin === undefined ||
    (typeof request.headers.origin === "string" &&
      EXTENSION_ORIGIN_SHAPE.test(request.headers.origin))) &&
  request.headers.referer === undefined &&
  request.headers["sec-fetch-site"] === "none" &&
  request.headers["sec-fetch-mode"] === "cors" &&
  request.headers["sec-fetch-dest"] === "empty";

const originDecision = (request: ApiRequest, audience: GatewayAudience): OriginDecision => {
  const origin = request.headers.origin;
  if (audience === "extension" && isPrivilegedExtensionFetch(request)) {
    return { allowed: true };
  }
  if (typeof origin !== "string" || !expectedOrigins(audience).has(origin)) {
    return { allowed: false };
  }
  return { allowed: true, origin };
};

const setSecurityHeaders = (response: ApiResponse): void => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
};

export const reject = (
  response: ApiResponse,
  status: number,
  code: string,
): ApiResponse => {
  setSecurityHeaders(response);
  return response.status(status).json({ error: code });
};

/**
 * Applies exact-origin CORS for either the released extension ids or the
 * Terminal deployment. This is a browser-origin control, not build
 * attestation; external rate limiting remains mandatory.
 */
export const authorizeOrigin = (
  request: ApiRequest,
  response: ApiResponse,
  audience: GatewayAudience,
): boolean => {
  const decision = originDecision(request, audience);
  setSecurityHeaders(response);
  if (!decision.allowed) {
    reject(response, 403, "origin_not_allowed");
    return false;
  }
  if (decision.origin) {
    response.setHeader("Access-Control-Allow-Origin", decision.origin);
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin");
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return false;
  }
  return true;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key));

export const isFelt = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <
      0x800000000000011000000000000000000000000000000000000000000000001n;
  } catch {
    return false;
  }
};

export const isNonZeroFelt = (value: unknown): value is string =>
  isFelt(value) && BigInt(value) > 0n;

export const readJsonBody = <T>(
  request: ApiRequest,
  maxBytes: number,
): T | null => {
  const length = Number(request.headers["content-length"] ?? "0");
  if (!Number.isFinite(length) || length < 0 || length > maxBytes) {
    return null;
  }
  if (!isRecord(request.body)) {
    return null;
  }
  try {
    if (Buffer.byteLength(JSON.stringify(request.body), "utf8") > maxBytes) {
      return null;
    }
  } catch {
    return null;
  }
  return request.body as T;
};

export const serviceUrl = (name: string, fallback?: string): string | null => {
  const candidate = process.env[name] ?? fallback;
  if (!candidate) {
    return null;
  }
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== HTTPS_PROTOCOL ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
};
