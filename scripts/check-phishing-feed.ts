/**
 * Daily check that the live phishing feed still loads the way the extension
 * reads it (issue 772): no host permission, so the source must answer 200 with
 * `Access-Control-Allow-Origin: *`, and its list must parse and fit both caps.
 * The old source returned 404 for a long time and nothing noticed. Prints
 * counts and fixed outcome labels only, never the list or the URL.
 */

import {
  DEFAULT_PHISHING_FEED_URL,
  parsePhishingFeed,
} from "../packages/features/permissions/src/phishing-feed";
import {
  MAX_PHISHING_DOMAIN_CHARS,
  MAX_PHISHING_DOMAINS,
  normalizePhishingDomain,
  phishingDomainChars,
} from "../packages/features/permissions/src/phishing-feed-cache";
import {
  HTTP_BODY_LIMITS,
  HTTP_REQUEST_TIMEOUT_MS,
  readBoundedText,
  UNTRUSTED_REQUEST_INIT,
} from "../packages/foundation/core/src/http-json";

type FeedOutcome =
  | "http-error"
  | "malformed"
  | "near-cap"
  | "no-cors"
  | "ok"
  | "timeout"
  | "too-small"
  | "transport-error";
type CheckFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** One identifier-free feed check result, for CI logs and alerts. */
export type PhishingFeedCheck = {
  /** Valid domains the extension would keep. */
  readonly domains: number;
  readonly outcome: FeedOutcome;
  /** Share of the tighter of the two caps the list uses, in whole percent. */
  readonly percentOfCap: number;
};

// Fewer than this means the source changed shape or was emptied: October
// 2026's list had about 110,000 valid domains.
const MIN_DOMAINS = 50_000;
// Alert ahead of the caps, while there is still time to raise them.
const NEAR_CAP = 0.9;

// Measures what the parser would keep before its caps cut in: valid,
// normalized, unique domains, so duplicates and junk entries don't read as
// growth toward the caps.
const capUse = (body: unknown): number => {
  const record = typeof body === "object" && body !== null ? body : null;
  const raw = record
    ? (Reflect.get(record, "blocklist") ?? Reflect.get(record, "blacklist"))
    : null;
  if (!Array.isArray(raw)) return 0;
  const kept = new Set<string>();
  for (const entry of raw) {
    const domain = typeof entry === "string" ? normalizePhishingDomain(entry) : null;
    if (domain !== null) kept.add(domain);
  }
  const chars = [...kept].reduce((total, domain) => total + phishingDomainChars(domain), 0);
  return Math.max(kept.size / MAX_PHISHING_DOMAINS, chars / MAX_PHISHING_DOMAIN_CHARS);
};

const outcomeOf = (domains: number, use: number): FeedOutcome =>
  domains < MIN_DOMAINS ? "too-small" : use >= NEAR_CAP ? "near-cap" : "ok";

/** Fetches the default feed once, as the extension would, and grades it. */
export const runPhishingFeedCheck = async (
  options: { readonly fetch?: CheckFetch; readonly timeoutMs?: number } = {},
): Promise<PhishingFeedCheck> => {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? HTTP_REQUEST_TIMEOUT_MS);
  const failed = (outcome: FeedOutcome): PhishingFeedCheck => ({
    domains: 0,
    outcome,
    percentOfCap: 0,
  });
  try {
    const response = await (options.fetch ?? fetch)(DEFAULT_PHISHING_FEED_URL, {
      ...UNTRUSTED_REQUEST_INIT,
      signal: deadline,
    });
    if (!response.ok) return failed("http-error");
    if (response.headers.get("access-control-allow-origin") !== "*") return failed("no-cors");
    const body: unknown = JSON.parse(
      await readBoundedText(response, HTTP_BODY_LIMITS.phishingFeed, deadline),
    );
    const domains = parsePhishingFeed(body);
    if (domains === null) return failed("malformed");
    const use = capUse(body);
    return {
      domains: domains.length,
      outcome: outcomeOf(domains.length, use),
      percentOfCap: Math.round(use * 100),
    };
  } catch (error) {
    if (error instanceof SyntaxError) return failed("malformed");
    return failed(
      deadline.aborted || (error instanceof DOMException && error.name === "TimeoutError")
        ? "timeout"
        : "transport-error",
    );
  }
};

if (import.meta.main) {
  const result = await runPhishingFeedCheck();
  console.log(JSON.stringify(result));
  if (result.outcome !== "ok") {
    process.exitCode = 1;
  }
}
