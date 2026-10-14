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

// The longest endpoint kept, measured on its canonical spelling.
const MAX_SERVICE_URL_LENGTH = 2048;

// The endpoint rule before spelling was checked, which is what an earlier build
// stored under: a string the URL parser reads as a credential- and
// fragment-free URL on the secure scheme, or the loopback one on a loopback host.
const parseEndpoint = (
  value: string,
  secureProtocol: string,
  loopbackProtocol: string,
): URL | null => {
  if (value.length === 0 || value.length > MAX_SERVICE_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    return url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      (url.protocol === secureProtocol ||
        (url.protocol === loopbackProtocol && LOOPBACK_HOSTS.has(url.hostname)))
      ? url
      : null;
  } catch {
    return null;
  }
};

// True when the last character the parser reads is a slash or backslash. The
// parser drops trailing C0 controls and spaces, and ASCII tab, CR and LF
// anywhere, so those are skipped.
const endsWithSeparator = (value: string): boolean => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) <= 0x20) {
    end -= 1;
  }
  const last = value.charCodeAt(end - 1);
  return last === 0x2f || last === 0x5c;
};

// The characters {@link redactEndpoints} ends a URL at. The parser
// percent-encodes them in a path, and all but the backtick in a query; a host
// may still hold a quote or a backtick. Encoding what is left changes no
// request: the parser decodes a host, and a server reads %60 in a query as a
// backtick.
const REDACTION_BREAKS = /[\s"<>`]/gu;

// The parser's serialization, with two changes. A bare origin keeps the form it
// was written in, because the parser adds a slash ("https://rpc.example" would
// become ".../"), and that would break equality with a bundled default or an
// existing list entry. And every redaction break left is percent-encoded.
const canonicalFor = (
  value: unknown,
  secureProtocol: string,
  loopbackProtocol: string,
): string | null => {
  if (typeof value !== "string") return null;
  const url = parseEndpoint(value, secureProtocol, loopbackProtocol);
  if (url === null) return null;
  const href = url.href;
  const bare = url.pathname === "/" && href.endsWith("/") && !endsWithSeparator(value);
  const canonical = (bare ? href.slice(0, -1) : href).replace(REDACTION_BREAKS, (char) =>
    encodeURIComponent(char),
  );
  return canonical.length <= MAX_SERVICE_URL_LENGTH ? canonical : null;
};

const isCanonicalFor = (
  value: unknown,
  secureProtocol: string,
  loopbackProtocol: string,
): boolean =>
  typeof value === "string" && canonicalFor(value, secureProtocol, loopbackProtocol) === value;

// An endpoint an earlier build stored, carried to its canonical spelling. See
// normalizeStoredServiceUrl.
const normalizeStoredFor = (
  value: unknown,
  secureProtocol: string,
  loopbackProtocol: string,
): unknown => {
  if (typeof value !== "string" || !parseEndpoint(value, secureProtocol, loopbackProtocol)) {
    return value;
  }
  const canonical = canonicalFor(value, secureProtocol, loopbackProtocol);
  return canonical !== null && isCanonicalFor(canonical, secureProtocol, loopbackProtocol)
    ? canonical
    : undefined;
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
 * Checks a service endpoint without performing network access: HTTPS, or HTTP
 * on a loopback host, with no credentials or fragment, written in its canonical
 * spelling. That spelling is the URL parser's serialization (a bare origin may
 * keep or drop its trailing slash) with no character {@link redactEndpoints}
 * ends a URL at. The parser would otherwise accept a raw spelling it only fixes
 * when it serializes: backslashes, missing or extra slashes, tab, CR and LF
 * anywhere, and whitespace, quotes, angle brackets and backticks it
 * percent-encodes. Such a spelling, if stored and echoed, could leave the tail
 * of an API key outside a redaction. A record an earlier build stored is
 * brought to this rule by {@link normalizeStoredServiceUrl}.
 */
export const isServiceUrl = (value: unknown): value is string =>
  isCanonicalFor(value, "https:", "http:");

/**
 * Checks a WebSocket endpoint: WSS anywhere, WS only on loopback, in the
 * canonical spelling {@link isServiceUrl} describes.
 */
export const isWebSocketServiceUrl = (value: unknown): value is string =>
  isCanonicalFor(value, "wss:", "ws:");

/**
 * Brings an endpoint an earlier build stored to the rule of
 * {@link isServiceUrl}. Those builds stored the spelling as entered, so a
 * preferences record could hold one this build refuses. Returns the canonical
 * spelling, which makes the same request. Returns `undefined` when the earlier
 * rule accepted the endpoint but its canonical spelling is over the
 * 2,048-character cap, which only a long run of characters the parser
 * percent-encodes can cause. The caller drops such an endpoint rather than fail
 * the whole record. Anything else is returned unchanged for the record's
 * validator to reject, because the earlier rule refused it too. Pure and total.
 */
export const normalizeStoredServiceUrl = (value: unknown): unknown =>
  normalizeStoredFor(value, "https:", "http:");

/** The {@link normalizeStoredServiceUrl} carry for a WebSocket endpoint. */
export const normalizeStoredWebSocketServiceUrl = (value: unknown): unknown =>
  normalizeStoredFor(value, "wss:", "ws:");

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

// A scheme, "://", then everything up to the first character a URL cannot
// carry unescaped (whitespace, a quote, an angle bracket, a backtick), so a key
// in the path or query never survives as a tail. The lookbehind starts a match
// only at the front of a word, which keeps the scan linear.
const ENDPOINT_PATTERN = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s"<>`]+/gi;

/**
 * Replaces every scheme-qualified URL in failure text with
 * {@link REDACTED_ENDPOINT}. A configured RPC or service endpoint may carry an
 * API key in its path or query, and failure text can echo it: a node's error
 * data, a gateway page quoted in a parse error, an SDK message. Apply it to any
 * such text before a user can see or copy it. Everything else — the method,
 * an RPC code, a revert reason, felts — is kept, so the text stays a useful
 * diagnostic. An endpoint the wallet holds is redacted whole: it passed
 * {@link isServiceUrl}, so it is written "scheme://" and holds no character the
 * match stops at, and a node or gateway echoes the same serialized form. Pure,
 * total, and linear.
 */
export const redactEndpoints = (text: string): string =>
  text.replace(ENDPOINT_PATTERN, REDACTED_ENDPOINT);
