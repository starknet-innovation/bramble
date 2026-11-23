/**
 * Custom RPC endpoints (wallet-core P4), from the extension's own code, for the mobile core's port
 * (`bramble-core`'s `rpc_override.rs`, `networks::with_rpc_override`, `public_store`'s
 * preferences, and `wallet_core::nostr::relay_url::{is_custom_rpc_url, redact_endpoints}`):
 *
 * - `set`: what the preferences store's `setRpcOverride` does with typed text on a network, from
 *   a store holding `before` (or nothing): the `rpcOverrides` it then holds, or the error it
 *   throws (nothing written). With what it holds, the endpoints `networkRpcUrls` tries in order
 *   and whether `explorerFallbackAllowed` lets the explorer answer with no stored choice;
 * - `fallback`: `explorerFallbackAllowed` over a stored override map and explorer choice;
 * - `stored`: a preferences record an earlier build stored, read back through the store
 *   (`normalizeStoredPreferences`, `withCanonicalEndpoints`): the `rpcOverrides` and
 *   `explorerFallback` it reads as, or the error the read throws;
 * - `redact`: `redactEndpoints` over failure text that names endpoints.
 *
 * Left out: the settings form's `canonicalServiceUrl` rewrite of typed text (mobile refuses a
 * spelling the parser would change instead), custom networks, and the explorer API, indexer and
 * STRK20 endpoints, which mobile does not configure. `bun run mobile:parity` writes it;
 * `bun run check` fails on drift. Every endpoint is made up.
 */
import type { Json } from "@bramble/core/json";
import { redactEndpoints } from "@bramble/core/service-url";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import { explorerFallbackAllowed } from "@bramble/wallet-model/preferences";
import { networkRpcUrls } from "../apps/extension/src/background/runtime/runtime-state";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const SETTINGS_PARITY_FIXTURE_PATH =
  "mobile/core/tests/fixtures/extension-settings-parity.jsonl";

const KEYED = "https://rpc.example/v0_10/apiKEY?token=a%2Fb";

/** A preferences store over a memory store holding `fields` over the defaults. */
const storeWith = async (fields: Readonly<Record<string, unknown>>) => {
  const store = createMemoryStore();
  await store.set(PREFERENCES_STORE_KEY, {
    ...defaultWalletPreferences(),
    ...fields,
  } as unknown as Json);
  return createPreferencesStore({ store });
};

const message = (error: unknown): string => (error as Error).message;

type SetCase = readonly [
  name: string,
  rpcUrl: string,
  networkId?: StarknetNetworkId,
  before?: Readonly<Record<string, string>>,
];

const SETS: readonly SetCase[] = [
  ["a bare origin", "https://rpc.example"],
  ["a bare origin with its slash", "https://rpc.example/"],
  ["a path and an API key in the query", KEYED],
  ["trimmed", `  ${KEYED}\n`],
  ["trimmed as JavaScript trims (NBSP, BOM, ideographic space)", " ﻿https://rpc.example　"],
  ["a port and an encoded space", "https://rpc.example:8443/?key=a%20b"],
  ["a percent-encoded tilde", "https://rpc.example/%7ekey"],
  ["a tilde", "https://rpc.example/~key"],
  ["an IPv4 host", "https://127.0.0.1:8545/rpc"],
  ["an IPv6 host", "https://[::1]:8545/rpc"],
  ["a punycode host", "https://xn--bcher-kva.example/rpc"],
  ["a trailing-dot host", "https://rpc.example./rpc"],
  ["Sepolia", KEYED, "SN_SEPOLIA"],
  ["replaces the one stored", "https://other.example/rpc", "SN_MAIN", { SN_MAIN: KEYED }],
  ["leaves the other network's", "https://other.example/rpc", "SN_MAIN", { SN_SEPOLIA: KEYED }],
  ["empty clears", "", "SN_MAIN", { SN_MAIN: KEYED, SN_SEPOLIA: KEYED }],
  ["whitespace clears", " \t\n", "SN_SEPOLIA", { SN_SEPOLIA: KEYED }],
  ["clearing nothing", ""],
  ["http on 127.0.0.1", "http://127.0.0.1:5050/rpc"],
  ["http on localhost", "http://localhost:5050"],
  ["http elsewhere", "http://rpc.example"],
  ["http on a loopback-looking name", "http://localhost.example"],
  ["credentials", "https://user:secret@rpc.example"],
  ["a username alone", "https://user@rpc.example"],
  ["a fragment", "https://rpc.example/#key"],
  ["an empty fragment", "https://rpc.example/#"],
  ["an upper-case host", "https://RPC.example/key"],
  ["an upper-case scheme", "HTTPS://rpc.example"],
  ["the default port", "https://rpc.example:443/key"],
  ["a zero-padded port", "https://rpc.example:08443/key"],
  ["a port out of range", "https://rpc.example:65536/key"],
  ["a space in the path", "https://rpc.example/a b"],
  ["a tab in the path", "https://rpc.example/a\tb"],
  ["a backslash", "https://rpc.example/a\\b"],
  ["a dot segment", "https://rpc.example/a/../b"],
  ["a missing slash", "https:rpc.example"],
  ["an extra slash", "https:///rpc.example"],
  ["a backtick in the query", "https://rpc.example/?k=`"],
  ["a quote in the path", 'https://rpc.example/a"b'],
  ["a non-ASCII host", "https://bücher.example/rpc"],
  ["a non-ASCII path", "https://rpc.example/é"],
  ["wss", "wss://rpc.example"],
  ["no scheme", "rpc.example"],
  ["a non-ASCII scheme", "httpé://rpc.example"],
  ["2,048 characters", `https://rpc.example/${"k".repeat(2028)}`],
  ["2,049 characters", `https://rpc.example/${"k".repeat(2029)}`],
];

const computeSets = async () => {
  const cases: object[] = [];
  for (const [name, rpcUrl, networkId = "SN_MAIN", before] of SETS) {
    const store = await storeWith(before === undefined ? {} : { rpcOverrides: before });
    let error: string | null = null;
    try {
      await store.setRpcOverride({ networkId, rpcUrl });
    } catch (thrown) {
      error = message(thrown);
    }
    const held = await store.read();
    cases.push({
      before: before ?? null,
      error,
      explorerFallbackAllowed: explorerFallbackAllowed(held, networkId),
      name,
      networkId,
      rpcOverrides: held.rpcOverrides ?? null,
      rpcUrl,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[networkId], held),
    });
  }
  return cases;
};

type FallbackCase = readonly [
  name: string,
  networkId: StarknetNetworkId,
  rpcOverrides: Readonly<Record<string, string>>,
  explorerFallback?: Readonly<Partial<Record<StarknetNetworkId, boolean>>>,
];

const FALLBACKS: readonly FallbackCase[] = [
  ["no override, no choice", "SN_MAIN", {}],
  ["an override, no choice", "SN_MAIN", { SN_MAIN: KEYED }],
  ["the other network's override", "SN_SEPOLIA", { SN_MAIN: KEYED }],
  ["an override, chosen on", "SN_MAIN", { SN_MAIN: KEYED }, { SN_MAIN: true }],
  ["no override, chosen off", "SN_MAIN", {}, { SN_MAIN: false }],
  ["an override, the other network chosen on", "SN_MAIN", { SN_MAIN: KEYED }, { SN_SEPOLIA: true }],
];

const computeFallbacks = () =>
  FALLBACKS.map(([name, networkId, rpcOverrides, explorerFallback]) => ({
    allowed: explorerFallbackAllowed(
      { ...(explorerFallback === undefined ? {} : { explorerFallback }), rpcOverrides },
      networkId,
    ),
    explorerFallback: explorerFallback ?? null,
    name,
    networkId,
    rpcOverrides,
  }));

// Over the 2,048-character cap once each space is percent-encoded.
const OUTGROWN = `https://rpc.example/${" ".repeat(1000)}key`;

const STORED: readonly (readonly [string, Readonly<Record<string, unknown>>])[] = [
  ["canonical overrides are kept", { rpcOverrides: { SN_MAIN: KEYED, SN_SEPOLIA: KEYED } }],
  ["http on loopback is kept", { rpcOverrides: { SN_MAIN: "http://127.0.0.1:5050/rpc" } }],
  ["an upper-case host is respelled", { rpcOverrides: { SN_MAIN: "https://RPC.example/apiKEY" } }],
  ["a raw space is respelled", { rpcOverrides: { SN_MAIN: "https://rpc.example/a b" } }],
  ["an outgrown endpoint is dropped, fallback pinned off", { rpcOverrides: { SN_MAIN: OUTGROWN } }],
  [
    "a backtick endpoint is dropped, the other kept",
    { rpcOverrides: { SN_MAIN: "https://rpc.example/?k=`", SN_SEPOLIA: KEYED } },
  ],
  [
    "a drop keeps a stored choice",
    { explorerFallback: { SN_MAIN: true }, rpcOverrides: { SN_MAIN: OUTGROWN } },
  ],
  ["an override under SN_DEVNET", { rpcOverrides: { SN_DEVNET: KEYED } }],
  ["a non-string endpoint fails the read", { rpcOverrides: { SN_MAIN: 1 } }],
  ["an empty endpoint fails the read", { rpcOverrides: { SN_MAIN: "" } }],
  ["http elsewhere fails the read", { rpcOverrides: { SN_MAIN: "http://rpc.example" } }],
];

const computeStored = async () => {
  const cases: object[] = [];
  for (const [name, fields] of STORED) {
    const store = await storeWith(fields);
    try {
      const held = await store.read();
      cases.push({
        error: null,
        explorerFallback: held.explorerFallback ?? null,
        name,
        rpcOverrides: held.rpcOverrides ?? null,
        stored: fields,
      });
    } catch (thrown) {
      cases.push({ error: message(thrown), name, stored: fields });
    }
  }
  return cases;
};

const REDACTIONS: readonly (readonly [string, string])[] = [
  ["an endpoint in an error", `fetch failed: ${KEYED} (ECONNREFUSED)`],
  ["two endpoints", "tried https://a.example/k1 then http://127.0.0.1:5050/rpc"],
  ["JSON-escaped slashes", 'body {"url":"https:\\/\\/rpc.example\\/apiKEY"}'],
  ["ended by a quote", 'url "https://rpc.example/key" refused'],
  ["ended by an angle bracket", "<https://rpc.example/key>"],
  ["ended by a backtick", "`https://rpc.example/key`"],
  ["a scheme glued to a word", "xhttps://rpc.example/key"],
  ["no endpoint", "RPC error 21: Invalid message selector 0x2e26"],
  ["a bare host", "rpc.example/apiKEY timed out"],
];

const computeRedactions = () =>
  REDACTIONS.map(([name, text]) => ({ name, redacted: redactEndpoints(text), text }));

/** Runs the extension's code for every case and renders one JSON line per case. */
export const renderSettingsParity = async (): Promise<string> => {
  const blocks: readonly (readonly [string, readonly object[]])[] = [
    ["set", await computeSets()],
    ["fallback", computeFallbacks()],
    ["stored", await computeStored()],
    ["redact", computeRedactions()],
  ];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
