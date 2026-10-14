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

/** What an endpoint reads as once {@link redactEndpoints} has removed it. */
export const REDACTED_ENDPOINT = "[endpoint]";

// The URL parser drops ASCII tab, CR and LF anywhere in its input, so
// `isServiceUrl` accepts "https:\t//host/key" or a tab inside the key and stores
// the string as written. The pattern lets them appear anywhere in a match.
const IGNORED = "[\\t\\n\\r]*";
const spaced = (word: string): string => [...word].join(IGNORED);
// A URL runs to the first character it cannot carry unescaped — whitespace, a
// quote, an angle bracket, a backtick — so a key never survives as a tail. A
// run of ignored characters continues it only when the URL goes on after it.
const URL_CHAR = '[^\\s"<>`]';
// Any scheme written "scheme://", which is how every URL leaves the wallet and
// so how a node or gateway echoes one; or one of the schemes the validators
// above accept (http, https, ws, wss) in any spelling the parser normalizes for
// them: ignored characters anywhere, backslashes, extra slashes, or none at
// all. The lookbehind starts a match only at the front of a word, which keeps
// the scan linear.
const ENDPOINT_PATTERN = new RegExp(
  "(?<![a-z0-9+.-])(?:[a-z][a-z0-9+.-]*://" +
    `|(?:${spaced("https")}|${spaced("http")}|${spaced("wss")}|${spaced("ws")})${IGNORED}:[\\t\\n\\r\\\\/]*)` +
    `(?:${URL_CHAR}|[\\t\\n\\r]+(?=${URL_CHAR}))+`,
  "gi",
);

/**
 * Replaces every scheme-qualified URL in failure text with
 * {@link REDACTED_ENDPOINT}. A configured RPC or service endpoint may carry an
 * API key in its path or query, and failure text can echo it: a node's error
 * data, a gateway page quoted in a parse error, an SDK message. Apply it to any
 * such text before a user can see or copy it. Everything else — the method,
 * an RPC code, a revert reason, felts — is kept, so the text stays a useful
 * diagnostic. Every spelling the validators above accept is matched whole; to
 * cover the characters the URL parser ignores, a word glued to the end of a URL
 * by only a tab or line break is redacted with it. Pure, total, and linear.
 */
export const redactEndpoints = (text: string): string =>
  text.replace(ENDPOINT_PATTERN, REDACTED_ENDPOINT);
