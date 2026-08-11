/**
 * Phishing / malicious-domain decisioning for dapp origins: a bundled baseline
 * blocklist, lookalike / site-reputation heuristics, and a hook for an
 * externally-supplied dynamic blocklist. Pure module: no clock, network,
 * storage, or browser globals. Callers inject reputation context (first-seen
 * timestamp, prior-connection status, current time) and the dynamic blocklist
 * snapshot so this file stays deterministic and unit-testable.
 *
 * Product decision (issue #34): phishing protection consumes a live, updatable
 * remote threat feed *in addition to* the bundled list, rather than remaining a
 * static baseline. The feed is fetched, validated, and cached by
 * `phishing-feed.ts`; this module only decides — given a host, the baseline list,
 * and the current feed snapshot — whether an origin is blocked. The bundled
 * `BLOCKED_DOMAINS` baseline is the permanent offline floor: it is always consulted
 * here regardless of feed state, so protection for already-listed domains and
 * the lookalike / risky-TLD heuristics never depends on the network. Blocking
 * is deny-by-default only for exact known-bad domains (baseline or feed), while
 * softer signals (lookalikes, punycode, risky TLDs) surface as warnings the
 * user still decides on.
 */

/**
 * Bundled baseline of known-bad registrable domains — the always-on offline floor.
 * Matching an origin's host to one of these (exactly or as a subdomain) blocks
 * the connection even when the remote feed is unreachable. Crypto drainer /
 * fake-airdrop patterns; the live feed (see `phishing-feed.ts`) extends this at
 * runtime without shipping a new build.
 */
const BLOCKED_DOMAINS: readonly string[] = [
  "airdrop-starknet.com",
  "argent-claim.com",
  "argent-wallet-verify.com",
  "braavos-airdrop.com",
  "braavos-wallet-verify.com",
  "claim-starknet.com",
  "connect-wallet-verify.com",
  "starknet-airdrop.com",
  "starknet-claim.app",
  "starknet-rewards.com",
  "starknet-token.com",
  "starkware-airdrop.com",
  "wallet-connect-verify.com",
  "web3-drainer.com",
];

/**
 * Well-known Starknet / crypto sites that phishing domains impersonate. Used
 * as the reference set for lookalike detection; these exact domains and their
 * subdomains are always treated as legitimate.
 */
const PROTECTED_DOMAINS: readonly string[] = [
  "argent.xyz",
  "braavos.app",
  "cartridge.gg",
  "ethereum.org",
  "starknet.io",
];

/**
 * Top-level domains disproportionately used for scams and malware. Presence is
 * a soft warning, never an automatic block.
 */
const RISKY_TLDS: ReadonlySet<string> = new Set([
  "cf",
  "click",
  "country",
  "ga",
  "gdn",
  "gq",
  "kim",
  "link",
  "ml",
  "mov",
  "rest",
  "review",
  "tk",
  "top",
  "work",
  "xin",
  "zip",
]);

/**
 * Digit-to-letter folding used to catch digit-substitution lookalikes such as
 * "st4rknet.io" or "argen7.xyz".
 */
const DIGIT_FOLD: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "6": "b",
  "7": "t",
  "8": "b",
  "9": "g",
};

const DAY_MS = 86_400_000;

/**
 * Reputation context supplied by the background when computing insights.
 */
export type OriginContext = {
  readonly connected?: boolean;
  readonly firstSeenAt?: number | null;
  readonly now?: number;
};

/**
 * Result of evaluating an origin: whether it is blocked outright plus any
 * human-readable warning / insight strings.
 */
export type OriginInsight = {
  readonly blocked: boolean;
  readonly warnings: readonly string[];
};

const hostnameOf = (origin: string): string | null => {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    // Strip a single trailing dot so a fully-qualified form ("example.com.")
    // matches the same registrable domain as "example.com" and cannot slip
    // past the exact blocklist. Mirrors host handling in shared/origin.ts.
    return host.endsWith(".") ? host.slice(0, -1) : host;
  } catch {
    return null;
  }
};

const matchesBase = (host: string, base: string): boolean =>
  host === base || host.endsWith(`.${base}`);

const matchesAny = (host: string, bases: readonly string[]): boolean =>
  bases.some((base) => matchesBase(host, base));

// Registrable-domain-aware membership test against a (potentially large)
// dynamic set: the host matches if it, or any of its parent domains, is a
// member — so a feed entry "evil.com" also blocks "login.evil.com". Walking
// the parent suffixes is O(labels) lookups rather than O(entries), keeping the
// check cheap even for a feed of tens of thousands of domains.
const hostInSet = (host: string, blocked: ReadonlySet<string>): boolean => {
  if (blocked.size === 0) {
    return false;
  }
  let candidate = host;
  while (candidate.length > 0) {
    if (blocked.has(candidate)) {
      return true;
    }
    const dot = candidate.indexOf(".");
    if (dot === -1) {
      return false;
    }
    candidate = candidate.slice(dot + 1);
  }
  return false;
};

const EMPTY_BLOCKED: ReadonlySet<string> = new Set();

const foldDigits = (value: string): string =>
  value.replace(/[0-9]/g, (digit) => DIGIT_FOLD[digit] ?? digit);

const levenshteinWithin1 = (a: string, b: string): boolean => {
  if (Math.abs(a.length - b.length) > 1) {
    return false;
  }
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(
        Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost),
      );
    }
    previous = current;
  }
  return (previous[b.length] ?? Number.POSITIVE_INFINITY) <= 1;
};

const isLookalike = (host: string, domain: string): boolean =>
  host !== domain &&
  (host.replaceAll("-", "") === domain ||
    foldDigits(host) === domain ||
    host.includes(domain) ||
    levenshteinWithin1(host, domain));

const lookalikeTarget = (host: string): string | null => {
  if (matchesAny(host, PROTECTED_DOMAINS)) {
    return null;
  }
  return PROTECTED_DOMAINS.find((domain) => isLookalike(host, domain)) ?? null;
};

const riskyTld = (host: string): string | null => {
  const labels = host.split(".");
  const tld = labels[labels.length - 1];
  return tld !== undefined && RISKY_TLDS.has(tld) ? tld : null;
};

const hasPunycodeLabel = (host: string): boolean =>
  host.split(".").some((label) => label.startsWith("xn--"));

const reputationWarning = (context: OriginContext): string | null => {
  if (context.connected === true) {
    return "You have connected to this site before.";
  }
  if (context.firstSeenAt === undefined || context.firstSeenAt === null) {
    return "First time this wallet has seen this site; you have no prior history with it.";
  }
  if (typeof context.now === "number" && context.now - context.firstSeenAt < DAY_MS) {
    return "This site was first seen less than a day ago.";
  }
  return null;
};

/**
 * Returns whether an origin's host is blocked: on the bundled baseline list, or on
 * the optional dynamic feed snapshot (exact match or subdomain of a blocked
 * registrable domain in either). The baseline is always checked, so protection
 * holds even when no feed snapshot is supplied. Unparseable origins are not
 * blocked here; origin validation happens at the message boundary.
 */
export const isBlockedOrigin = (
  origin: string,
  dynamicBlocked: ReadonlySet<string> = EMPTY_BLOCKED,
): boolean => {
  const host = hostnameOf(origin);
  if (host === null) {
    return false;
  }
  return matchesAny(host, BLOCKED_DOMAINS) || hostInSet(host, dynamicBlocked);
};

/**
 * Evaluates an origin for phishing signals and site reputation. Returns whether
 * it is blocked outright plus ordered warning strings covering blocklist hits,
 * punycode, brand lookalikes, risky TLDs, and first-seen / prior-connection
 * status. Never throws.
 */
export const originInsights = (
  origin: string,
  context: OriginContext = {},
  dynamicBlocked: ReadonlySet<string> = EMPTY_BLOCKED,
): OriginInsight => {
  const host = hostnameOf(origin);
  if (host === null) {
    return { blocked: false, warnings: ["Origin could not be parsed as a valid site."] };
  }

  const warnings: string[] = [];
  const blocked = matchesAny(host, BLOCKED_DOMAINS) || hostInSet(host, dynamicBlocked);
  if (blocked) {
    warnings.push("This domain is on the wallet blocklist of known phishing and scam sites.");
  }
  if (hasPunycodeLabel(host)) {
    warnings.push(
      "Domain uses punycode (internationalized characters) that can mimic a real name.",
    );
  }
  const target = lookalikeTarget(host);
  if (target !== null) {
    warnings.push(`Domain closely resembles ${target}; watch for a spoofed lookalike.`);
  }
  const tld = riskyTld(host);
  if (tld !== null) {
    warnings.push(`The .${tld} top-level domain is frequently used for scams; be cautious.`);
  }
  const reputation = reputationWarning(context);
  if (reputation !== null) {
    warnings.push(reputation);
  }

  return { blocked, warnings };
};

/**
 * A pre-bound origin decision surface. It closes over a live accessor for the
 * dynamic feed snapshot so enforcement call sites can stay ignorant of where
 * the extra blocklist comes from — they just ask the guard. The baseline list and
 * heuristics are always applied by the underlying functions.
 */
export type OriginGuard = {
  readonly insights: (origin: string, context?: OriginContext) => OriginInsight;
  readonly isBlocked: (origin: string) => boolean;
};

/**
 * Builds an {@link OriginGuard} over a dynamic-blocklist accessor. The accessor
 * is read on every call so a background refresh that swaps in a newer feed
 * snapshot takes effect immediately, with no re-wiring. Omit it for a
 * baseline-and-heuristics-only guard (the offline baseline).
 */
export const createOriginGuard = (
  dynamicBlocked: () => ReadonlySet<string> = () => EMPTY_BLOCKED,
): OriginGuard => ({
  insights: (origin, context) => originInsights(origin, context, dynamicBlocked()),
  isBlocked: (origin) => isBlockedOrigin(origin, dynamicBlocked()),
});

/**
 * Baseline-and-heuristics-only guard used as the safe default wherever a
 * feed-backed guard has not been wired (tests, degraded startup). Equivalent to
 * the pre-#34 static behaviour.
 */
export const DEFAULT_ORIGIN_GUARD: OriginGuard = createOriginGuard();
