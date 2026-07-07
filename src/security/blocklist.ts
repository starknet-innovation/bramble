/**
 * Vendored phishing / malicious-domain blocklist plus lookalike and
 * site-reputation heuristics for dapp origins. Pure module: no clock, network,
 * storage, or browser globals. Callers inject reputation context (first-seen
 * timestamp, prior-connection status, current time) so this file stays
 * deterministic and unit-testable.
 *
 * The blocklist is a curated starter set. It is intentionally small, explicit,
 * and easy to extend; it is not a substitute for a live threat feed. Blocking
 * is deny-by-default only for exact known-bad domains, while softer signals
 * (lookalikes, punycode, risky TLDs) surface as warnings the user still
 * decides on.
 */

/**
 * Known-bad registrable domains. Matching an origin's host to one of these
 * (exactly or as a subdomain) blocks the connection. Starter set of crypto
 * drainer / fake-airdrop patterns; replace or extend with real threat intel.
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
 * Returns whether an origin's host is on the wallet blocklist (exact match or
 * subdomain of a blocked registrable domain). Unparseable origins are not
 * blocked here; origin validation happens at the message boundary.
 */
export const isBlockedOrigin = (origin: string): boolean => {
  const host = hostnameOf(origin);
  return host !== null && matchesAny(host, BLOCKED_DOMAINS);
};

/**
 * Evaluates an origin for phishing signals and site reputation. Returns whether
 * it is blocked outright plus ordered warning strings covering blocklist hits,
 * punycode, brand lookalikes, risky TLDs, and first-seen / prior-connection
 * status. Never throws.
 */
export const originInsights = (origin: string, context: OriginContext = {}): OriginInsight => {
  const host = hostnameOf(origin);
  if (host === null) {
    return { blocked: false, warnings: ["Origin could not be parsed as a valid site."] };
  }

  const warnings: string[] = [];
  const blocked = matchesAny(host, BLOCKED_DOMAINS);
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
