/**
 * Shared network-service URL policy: HTTPS anywhere, HTTP only on loopback.
 */
import { hasUniqueStrings } from "./json";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Normalizes a URL hostname for comparison: lowercases it and strips a single
 * trailing dot so a fully-qualified name ("example.com.") compares as
 * "example.com". The WHATWG URL parser keeps that dot on a domain host, which
 * would otherwise slip past an exact denylist match. Pure and total.
 */
export const normalizeHostname = (hostname: string): string => {
  const lower = hostname.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
};

const isUrlFor = (value: unknown, secureProtocol: string, loopbackProtocol: string): boolean => {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      (url.protocol === secureProtocol ||
        (url.protocol === loopbackProtocol && LOOPBACK_HOSTS.has(url.hostname)))
    );
  } catch {
    return false;
  }
};

/**
 * Removes trailing URL separators in linear time without a backtracking regex.
 */
export const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
};

/**
 * Checks a user-configured service endpoint without performing network access.
 */
export const isServiceUrl = (value: unknown): value is string => isUrlFor(value, "https:", "http:");

/**
 * Checks a user-configured WebSocket endpoint: WSS anywhere, WS only on loopback.
 */
export const isWebSocketServiceUrl = (value: unknown): value is string =>
  isUrlFor(value, "wss:", "ws:");

/**
 * Checks a chain descriptor's endpoint list: non-empty, every entry a
 * {@link isServiceUrl} endpoint, no entry repeated. The one rule behind every
 * URI array a dapp may attach to a chain — do not re-derive it locally, because
 * a looser copy on the dapp side would prompt the user to approve a chain the
 * store then refused to persist.
 */
export const isServiceUrlList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isServiceUrl) && hasUniqueStrings(value);

/**
 * Checks an endpoint list a dapp sent: an {@link isServiceUrlList} with at most
 * `maxEntries` entries. The count bound keeps one approval from writing
 * hundreds of kilobytes of URLs into stored preferences (Sherlock audit 153).
 */
export const isBoundedServiceUrlList = (
  value: unknown,
  maxEntries: number,
): value is readonly string[] => isServiceUrlList(value) && value.length <= maxEntries;

/**
 * Checks an optional endpoint list: absent, or a well-formed
 * {@link isServiceUrlList}. Anything else — an empty list, a malformed entry, a
 * repeat — is rejected.
 */
export const isOptionalServiceUrlList = (value: unknown): value is readonly string[] | undefined =>
  value === undefined || isServiceUrlList(value);
