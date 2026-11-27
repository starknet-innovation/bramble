/**
 * The `site`, `feedParse` and `feed` blocks: what the extension's permissions package says about
 * a site, and how its live phishing feed is read and kept.
 *
 * - `site`: `isBlockedOrigin` and `originInsights` (`blocklist.ts`) for wallet origins (each one
 *   `isWalletOrigin` accepts, as the bridge admits only those) under a fixed feed snapshot and a
 *   reputation context; each warning written as its message key and facts.
 * - `feedParse`: `parsePhishingFeed` over a body, and `normalizePhishingDomain` over entries.
 * - `feed`: `createPhishingFeed` over a memory store and a hand-moved clock, refreshed against
 *   scripted replies; after each step, whether it fetched, the domains in use (sorted) and
 *   `health`. `restart` builds a new feed over the same store, as a new service worker does.
 */
import { isWalletOrigin } from "@bramble/core/origin";
import { isBlockedOrigin, originInsights } from "@bramble/permissions/blocklist";
import { createPhishingFeed, parsePhishingFeed } from "@bramble/permissions/phishing-feed";
import { normalizePhishingDomain } from "@bramble/permissions/phishing-feed-cache";
import { createMemoryStore } from "@bramble/store/kv";

const FEED = ["evil.example", "drain.example.org"];
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const ORIGINS: readonly string[] = [
  "https://app.example",
  "https://web3-drainer.com",
  "https://app.web3-drainer.com",
  "https://web3-drainer.com.",
  "https://web3-drainer.com:8443",
  "https://notweb3-drainer.com",
  "https://web3-drainer.com.evil.example",
  "https://evil.example",
  "https://login.evil.example",
  "https://example.org",
  "https://drain.example.org",
  "https://xn--argnt-5ra.xyz",
  "https://argent.xyz",
  "https://www.argent.xyz",
  "https://argentt.xyz",
  "https://argent.xyz.claim.example",
  "https://braav0s.app",
  "https://star-knet.io",
  "https://starknet.io.zip",
  "https://cartridge.gq",
  "https://ethereum.org",
  "https://ethereum.orgg",
  "https://claim.top",
  "https://sub.example.click",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "https://[::1]:8443",
  "https://192.168.0.1",
];

const CONTEXTS = [
  { label: "never seen", context: {} },
  { label: "connected", context: { connected: true, firstSeenAt: NOW - 2 * DAY, now: NOW } },
  { label: "seen an hour ago", context: { firstSeenAt: NOW - 3_600_000, now: NOW } },
  { label: "seen a day ago", context: { firstSeenAt: NOW - DAY, now: NOW } },
] as const;

/** Every origin under the first context, and a few under the others. */
export const computeSites = (): readonly object[] => {
  const feed = new Set(FEED);
  const pairs = [
    ...ORIGINS.map((origin) => [origin, CONTEXTS[0]] as const),
    ...CONTEXTS.slice(1).flatMap((context) =>
      ["https://app.example", "https://argentt.xyz", "https://evil.example"].map(
        (origin) => [origin, context] as const,
      ),
    ),
  ];
  return pairs.map(([origin, { context, label }]) => {
    if (!isWalletOrigin(origin)) throw new Error(`${origin} is not a wallet origin`);
    const insight = originInsights(origin, context, feed);
    return {
      blocked: isBlockedOrigin(origin, feed),
      context,
      feed: FEED,
      insight: { blocked: insight.blocked, warnings: insight.warningTexts ?? null },
      name: `${origin}, ${label}`,
      origin,
    };
  });
};

const BODIES: readonly (readonly [string, unknown])[] = [
  ["a blocklist", { blocklist: ["Evil.COM", "evil.com.", " phish.example ", "a.b.c"] }],
  ["the eth-phishing-detect blacklist", { blacklist: ["drainer.xyz"], fuzzylist: ["x"] }],
  ["both lists, blocklist first", { blacklist: ["b.example"], blocklist: ["a.example"] }],
  ["a null blocklist beside a blacklist", { blacklist: ["b.example"], blocklist: null }],
  ["malformed entries", { blocklist: ["good.com", 42, "no-dot", "bad_domain.com", "", "é.com"] }],
  ["an empty list", { blocklist: [] }],
  ["no list", { whitelist: ["a.example"] }],
  ["a list that is not an array", { blocklist: "evil.com" }],
  ["an array body", ["evil.com"]],
  ["a long domain", { blocklist: [`${"a".repeat(250)}.com`, `${"a".repeat(249)}.com`] }],
];

const DOMAINS = [
  "Evil.COM",
  "evil.com.",
  "  evil.com\t",
  "evil..com",
  "-evil.com",
  "evil",
  "xn--argnt-5ra.xyz",
  "evil.com:443",
  " evil.com",
];

/** `parsePhishingFeed` over each body, then `normalizePhishingDomain` over each entry. */
export const computeFeedParse = (): readonly object[] => [
  ...BODIES.map(([name, body]) => ({
    body: JSON.stringify(body),
    domains: parsePhishingFeed(body),
    name,
  })),
  ...DOMAINS.map((value) => ({
    name: `normalize ${JSON.stringify(value)}`,
    normalized: normalizePhishingDomain(value),
    value,
  })),
];

type Reply = { readonly status: number; readonly body: string } | { readonly throws: true };
type Step =
  | { readonly op: "refresh"; readonly at: number; readonly reply?: Reply }
  | { readonly op: "restart" };

const ok = (domains: readonly string[]): Reply => ({
  body: JSON.stringify({ blocklist: domains }),
  status: 200,
});
const HOUR = 3_600_000;
const T0 = 1_000_000;

const SEQUENCES: readonly { readonly name: string; readonly steps: readonly Step[] }[] = [
  {
    name: "a fetched list is cached and reused within the TTL",
    steps: [
      { at: T0, op: "refresh", reply: ok(["evil.example"]) },
      { at: T0 + 6 * HOUR - 1, op: "refresh" },
      { op: "restart" },
      { at: T0 + 6 * HOUR - 1, op: "refresh" },
      { at: T0 + 6 * HOUR, op: "refresh", reply: ok(["evil.example", "new.example"]) },
    ],
  },
  {
    name: "failures keep the last good list",
    steps: [
      { at: T0, op: "refresh", reply: ok(["evil.example"]) },
      { at: T0 + 7 * HOUR, op: "refresh", reply: { body: "{}", status: 500 } },
      { at: T0 + 8 * HOUR, op: "refresh", reply: { throws: true } },
      { at: T0 + 9 * HOUR, op: "refresh", reply: { body: "not json", status: 200 } },
      { at: T0 + 10 * HOUR, op: "refresh", reply: { body: "{}", status: 200 } },
      { at: T0 + 25 * HOUR, op: "refresh", reply: { throws: true } },
      { op: "restart" },
      { at: T0 + 25 * HOUR, op: "refresh", reply: { throws: true } },
      { at: T0 + 26 * HOUR, op: "refresh", reply: ok([]) },
    ],
  },
  {
    name: "nothing loaded is stale",
    steps: [
      { at: T0, op: "refresh", reply: { throws: true } },
      { at: T0 + HOUR, op: "refresh", reply: { body: "[]", status: 200 } },
      { at: T0 + 2 * HOUR, op: "refresh", reply: ok(["a.example"]) },
    ],
  },
  {
    name: "a cache from the future is ignored",
    steps: [
      { at: T0 + 10 * HOUR, op: "refresh", reply: ok(["future.example"]) },
      { op: "restart" },
      { at: T0, op: "refresh", reply: ok(["now.example"]) },
    ],
  },
];

const respond = (reply: Reply | undefined): Response => {
  if (!reply) throw new Error("the script has no reply for this fetch");
  if ("throws" in reply) throw new TypeError("network down");
  return new Response(reply.body, { status: reply.status });
};

/** Runs every refresh sequence over a memory store. */
export const computeFeed = async (): Promise<readonly object[]> => {
  const cases: object[] = [];
  for (const { name, steps } of SEQUENCES) {
    const store = createMemoryStore();
    let now = 0;
    let reply: Reply | undefined;
    let fetched = false;
    const make = () =>
      createPhishingFeed({
        fetch: async () => {
          fetched = true;
          return respond(reply);
        },
        now: () => now,
        store,
      });
    let feed = make();
    const results: object[] = [];
    for (const step of steps) {
      if (step.op === "restart") {
        feed = make();
        results.push({ step });
        continue;
      }
      now = step.at;
      reply = step.reply;
      fetched = false;
      await feed.refresh();
      results.push({
        domains: [...feed.blockedDomains()].sort(),
        fetched,
        health: feed.health(),
        step,
      });
    }
    cases.push({ name, steps: results });
  }
  return cases;
};
