/**
 * Renders the Debug-only JSON-RPC fixtures the iOS UI tests use instead of a live node
 * (design-mobile.md section 6). Every chain id, endpoint, and token address comes from the
 * extension's network catalog; the balances are fixed test amounts converted to base units with
 * each token's own decimals. The send-path replies (class hash, nonce, fee estimates) are the
 * node answers recorded from the extension's own send path in the transaction fixture
 * (`bun run mobile:parity`), so the Send UI test reviews exactly what the extension reviewed.
 * The Swift file is wrapped in `#if DEBUG`, so a Release build carries none of it.
 *
 * The node only knows the published E2E wallet's primary account (OZ index 0, read from the
 * extension-written parity fixture): account discovery over these fixtures finds that one account
 * with activity, as it would on a real node, instead of every probed shape.
 */
import { readFileSync } from "node:fs";
import {
  canonicalFelt,
  DEFAULT_TOKENS,
  STARKNET_NETWORKS,
  UINT128_LIMIT,
} from "@bramble/wallet-model/networks";
import { HEADER } from "./shared";

/** Repository-relative path of the generated fixtures. */
export const RPC_FIXTURES_PATH = "mobile/ios/Bramble/App/RpcFixtures.generated.swift";

const NETWORK_IDS = ["SN_MAIN", "SN_SEPOLIA"] as const;

/** The published phrase's derived accounts, written from the extension by `bun run mobile:parity`. */
const PARITY_FIXTURE = "mobile/core/tests/fixtures/extension-parity.json";

/** The recorded send path (written by `generate-mobile-transaction-vectors.ts`). */
const WIRE_FIXTURE = "mobile/core/tests/fixtures/extension-transactions-wire.json";
const DEPLOYED_SCENARIO = "deployed-SN_SEPOLIA";
const UNDEPLOYED_SCENARIO = "undeployed-SN_SEPOLIA";

/**
 * Starknet JSON-RPC `TRANSACTION_EXECUTION_ERROR` (code 41), the reply a node gives an estimate
 * that cannot execute. The recorded path has no failing estimate, so this one is spelled from the
 * spec; the core only needs an error reply to take the fee-failure branch.
 */
const EXECUTION_ERROR = { error: { code: 41, message: "Transaction execution error" } };

interface WireExchange {
  readonly method: string;
  readonly params: unknown;
  readonly reply: Record<string, unknown>;
}

interface WireScenario {
  readonly name: string;
  readonly reviewInvoke: readonly string[];
}

/** One recorded review-phase exchange of a scenario; throws when the recording lacks it. */
const recorded = (scenario: string, method: string, requestTypes?: string): WireExchange => {
  const wire = JSON.parse(readFileSync(WIRE_FIXTURE, "utf8")) as {
    readonly scenarios: readonly WireScenario[];
  };
  const exchanges = (
    wire.scenarios.find((entry) => entry.name === scenario)?.reviewInvoke ?? []
  ).map((line) => JSON.parse(line) as WireExchange);
  const found = exchanges.find((exchange) => {
    if (exchange.method !== method) return false;
    if (requestTypes === undefined) return true;
    const request = (exchange.params as { request?: { type?: string }[] }).request ?? [];
    return request.map((entry) => entry.type).join(",") === requestTypes;
  });
  if (!found) throw new Error(`${WIRE_FIXTURE} has no ${method} in ${scenario}`);
  return found;
};

/** One estimate entry of a recorded `starknet_estimateFee` reply. */
const estimateEntry = (exchange: WireExchange, index: number): unknown => {
  const entries = exchange.reply["result"];
  if (!Array.isArray(entries) || entries[index] === undefined) {
    throw new Error(`Recorded estimate has no entry ${index}`);
  }
  return entries[index];
};

/** A JSON value as a Swift raw string literal. */
const rawJson = (value: unknown): string => `#"${JSON.stringify(value)}"#`;

/** Whole-token test amounts for the `ready` state, keyed by symbol; tokens not listed hold 1. */
const READY_AMOUNTS: Readonly<Record<string, string>> = { ETH: "0.0421", STRK: "125.5" };

const baseUnits = (amount: string, decimals: number): bigint => {
  const [whole = "0", fraction = ""] = amount.split(".");
  if (fraction.length > decimals) {
    throw new Error(`${amount} has more fraction digits than ${decimals}`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
};

const hex = (value: bigint): string => `0x${value.toString(16)}`;

const canonical = (address: string): string => {
  const value = canonicalFelt(address);
  if (!value) {
    throw new Error(`Token address ${address} is not a felt`);
  }
  return value;
};

/** Canonical addresses of the published wallet's OZ index-0 account on each network. */
const primaryAccounts = (): string[] => {
  const parity = JSON.parse(readFileSync(PARITY_FIXTURE, "utf8")) as {
    readonly accounts: readonly { readonly accountIndex: number; readonly address: string }[];
  };
  const addresses = parity.accounts
    .filter((account) => account.accountIndex === 0)
    .map((account) => canonical(account.address));
  if (addresses.length === 0) throw new Error(`${PARITY_FIXTURE} has no index-0 account`);
  return [...new Set(addresses)].sort();
};

/** Kotlin twin of the Swift fixtures, for the Android instrumented suite's `FixtureNode`. */
export const KOTLIN_RPC_FIXTURES_PATH =
  "mobile/android/app/src/androidTest/java/org/bramble/wallet/RpcFixtures.generated.kt";

/** Every fixture value, computed once and rendered for each platform. */
interface FixtureData {
  readonly chainIds: readonly (readonly [string, string])[];
  readonly primaryAccounts: readonly string[];
  readonly readyBalances: readonly (readonly [string, string, string])[];
  readonly replies: readonly (readonly [string, string, unknown])[];
}

const fixtureData = (): FixtureData => {
  const chainIds = NETWORK_IDS.flatMap((id) =>
    STARKNET_NETWORKS[id].rpcUrls.map((url) => [url, STARKNET_NETWORKS[id].chainId] as const),
  );
  const seen = new Set<string>();
  const readyBalances = DEFAULT_TOKENS.filter((token) =>
    NETWORK_IDS.some((id) => id === token.networkId),
  ).flatMap((token) => {
    const address = canonical(token.address);
    if (seen.has(address)) return [];
    seen.add(address);
    const units = baseUnits(READY_AMOUNTS[token.symbol] ?? "1", token.decimals);
    return [[address, hex(units % UINT128_LIMIT), hex(units / UINT128_LIMIT)] as const];
  });
  // [Swift name, doc, reply]: replies recorded from the extension's own send path.
  const replies = [
    [
      "deployedClassHash",
      "`starknet_getClassHashAt` for a deployed account.",
      recorded(DEPLOYED_SCENARIO, "starknet_getClassHashAt").reply,
    ],
    [
      "undeployedClassHash",
      "`starknet_getClassHashAt` for an account that is not deployed yet.",
      recorded(UNDEPLOYED_SCENARIO, "starknet_getClassHashAt").reply,
    ],
    [
      "deployedNonce",
      "`starknet_getNonce` for a deployed account.",
      recorded(DEPLOYED_SCENARIO, "starknet_getNonce").reply,
    ],
    [
      "undeployedNonce",
      "`starknet_getNonce` for an account that is not deployed yet.",
      recorded(UNDEPLOYED_SCENARIO, "starknet_getNonce").reply,
    ],
    [
      "invokeEstimate",
      "One `starknet_estimateFee` entry for the transfer's INVOKE.",
      estimateEntry(recorded(DEPLOYED_SCENARIO, "starknet_estimateFee", "INVOKE"), 0),
    ],
    [
      "deployEstimate",
      "One `starknet_estimateFee` entry for the account's DEPLOY_ACCOUNT.",
      estimateEntry(
        recorded(UNDEPLOYED_SCENARIO, "starknet_estimateFee", "DEPLOY_ACCOUNT,INVOKE"),
        0,
      ),
    ],
    ["estimateFailure", "`starknet_estimateFee` in the `feeFailure` state.", EXECUTION_ERROR],
  ] as const;
  return { chainIds, primaryAccounts: primaryAccounts(), readyBalances, replies };
};

/** `deployedClassHash` → `DEPLOYED_CLASS_HASH`. */
const constantName = (name: string): string => name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();

/** The Kotlin source for the Android instrumented suite's `RpcFixtures`. */
export const renderKotlinRpcFixtures = (): string => {
  const data = fixtureData();
  return [
    `// ${HEADER}`,
    "package org.bramble.wallet",
    "",
    "/**",
    " * Deterministic JSON-RPC answers for the instrumented suite's offline `FixtureNode`, the same",
    " * values as the iOS `RpcFixtures.generated.swift`, rendered from the extension's network catalog",
    " * and its recorded send path. Public data only; test source set, never on the app's classpath.",
    " */",
    "object RpcFixtures {",
    "    /** Bundled endpoint → the chain id its `starknet_chainId` answers. */",
    "    val chainIds: Map<String, String> =",
    "        mapOf(",
    ...data.chainIds.map(([url, id]) => `            "${url}" to "${id}",`),
    "        )",
    "",
    "    /** The published wallet's primary account (OZ index 0): the only deployed or funded address. */",
    "    val primaryAccounts: Set<String> =",
    "        setOf(",
    ...data.primaryAccounts.map((address) => `            "${address}",`),
    "        )",
    "",
    "    /** Canonical token address → `balanceOf` u256 limbs (low, high) in the `ready` state. */",
    "    val readyBalances: Map<String, List<String>> =",
    "        mapOf(",
    ...data.readyBalances.map(
      ([address, low, high]) => `            "${address}" to listOf("${low}", "${high}"),`,
    ),
    "        )",
    ...data.replies.flatMap(([name, doc, reply]) => [
      "",
      `    /** ${doc} */`,
      `    const val ${constantName(name)} = """${JSON.stringify(reply)}"""`,
    ]),
    "}",
    "",
  ].join("\n");
};

/** The Swift source for `RpcFixtures`. */
export const renderRpcFixtures = (): string => {
  const data = fixtureData();
  const endpoints = data.chainIds.map(([url, id]) => `        "${url}": "${id}",`);
  const balances = data.readyBalances.map(
    ([address, low, high]) => `        "${address}": ["${low}", "${high}"],`,
  );
  return [
    `// ${HEADER}`,
    "#if DEBUG",
    "/// Deterministic JSON-RPC answers for the Debug-only offline UI-test seam (`FixtureTransport`),",
    "/// rendered from the extension's network catalog. Public data only; never compiled into Release.",
    "enum RpcFixtures {",
    "    /// The states an offline UI suite launches into: the Home states the snapshot suite captures",
    "    /// (deployed, or offline for `balanceError`) and the Send journey's account states.",
    "    enum State: String, CaseIterable {",
    "        case ready, empty, balanceError, undeployed, unfunded, feeFailure",
    "    }",
    "",
    "    /// Bundled endpoint → the chain id its `starknet_chainId` answers.",
    "    static let chainIds: [String: String] = [",
    ...endpoints,
    "    ]",
    "",
    "    /// The published wallet's primary account (OZ index 0) on each network: the only address",
    "    /// this node reports as deployed or funded, so discovery finds exactly that account.",
    "    static let primaryAccounts: Set<String> = [",
    ...data.primaryAccounts.map((address) => `        "${address}",`),
    "    ]",
    "",
    "    /// Canonical token address → `balanceOf` u256 limbs (low, high) in the `ready` state.",
    "    static let readyBalances: [String: [String]] = [",
    ...balances,
    "    ]",
    "",
    "    // Replies recorded from the extension's own send path (extension-transactions-wire.json):",
    "    // a JSON object carrying `result` or `error`, merged into a reply under the request's id.",
    "",
    ...data.replies.flatMap(([name, doc, reply]) => [
      `    /// ${doc}`,
      `    static let ${name} = ${rawJson(reply)}`,
    ]),
    "}",
    "#endif",
    "",
  ].join("\n");
};
