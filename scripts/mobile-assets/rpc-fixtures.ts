/**
 * Renders the Debug-only JSON-RPC fixtures the iOS UI tests use instead of a live node
 * (design-mobile.md section 6). Every chain id, endpoint, and token address comes from the
 * extension's network catalog; the balances are fixed test amounts converted to base units with
 * each token's own decimals. The send-path replies (class hash, nonce, fee estimates) are the
 * node answers recorded from the extension's own send path in the transaction fixture
 * (`bun run mobile:parity`), so the Send UI test reviews exactly what the extension reviewed.
 * The Swift file is wrapped in `#if DEBUG`, so a Release build carries none of it.
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

/** The Swift source for `RpcFixtures`. */
export const renderRpcFixtures = (): string => {
  const endpoints = NETWORK_IDS.flatMap((id) =>
    STARKNET_NETWORKS[id].rpcUrls.map(
      (url) => `        "${url}": "${STARKNET_NETWORKS[id].chainId}",`,
    ),
  );
  const balances = DEFAULT_TOKENS.filter((token) =>
    NETWORK_IDS.some((id) => id === token.networkId),
  )
    .map((token) => {
      const units = baseUnits(READY_AMOUNTS[token.symbol] ?? "1", token.decimals);
      const low = units % UINT128_LIMIT;
      const high = units / UINT128_LIMIT;
      return `        "${canonical(token.address)}": ["${hex(low)}", "${hex(high)}"],`;
    })
    .filter((line, index, all) => all.indexOf(line) === index);
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
    "    /// Canonical token address → `balanceOf` u256 limbs (low, high) in the `ready` state.",
    "    static let readyBalances: [String: [String]] = [",
    ...balances,
    "    ]",
    "",
    "    // Replies recorded from the extension's own send path (extension-transactions-wire.json):",
    "    // a JSON object carrying `result` or `error`, merged into a reply under the request's id.",
    "",
    "    /// `starknet_getClassHashAt` for a deployed account.",
    `    static let deployedClassHash = ${rawJson(recorded(DEPLOYED_SCENARIO, "starknet_getClassHashAt").reply)}`,
    "    /// `starknet_getClassHashAt` for an account that is not deployed yet.",
    `    static let undeployedClassHash = ${rawJson(recorded(UNDEPLOYED_SCENARIO, "starknet_getClassHashAt").reply)}`,
    "    /// `starknet_getNonce` for a deployed account.",
    `    static let deployedNonce = ${rawJson(recorded(DEPLOYED_SCENARIO, "starknet_getNonce").reply)}`,
    "    /// `starknet_getNonce` for an account that is not deployed yet.",
    `    static let undeployedNonce = ${rawJson(recorded(UNDEPLOYED_SCENARIO, "starknet_getNonce").reply)}`,
    "    /// One `starknet_estimateFee` entry for the transfer's INVOKE.",
    `    static let invokeEstimate = ${rawJson(estimateEntry(recorded(DEPLOYED_SCENARIO, "starknet_estimateFee", "INVOKE"), 0))}`,
    "    /// One `starknet_estimateFee` entry for the account's DEPLOY_ACCOUNT.",
    `    static let deployEstimate = ${rawJson(estimateEntry(recorded(UNDEPLOYED_SCENARIO, "starknet_estimateFee", "DEPLOY_ACCOUNT,INVOKE"), 0))}`,
    "    /// `starknet_estimateFee` in the `feeFailure` state.",
    `    static let estimateFailure = ${rawJson(EXECUTION_ERROR)}`,
    "}",
    "#endif",
    "",
  ].join("\n");
};
