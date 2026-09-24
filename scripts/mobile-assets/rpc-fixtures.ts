/**
 * Renders the Debug-only JSON-RPC fixtures the iOS UI tests use instead of a live node
 * (design-mobile.md section 6). Every chain id, endpoint, and token address comes from the
 * extension's network catalog; the balances are fixed test amounts converted to base units with
 * each token's own decimals. The Swift file is wrapped in `#if DEBUG`, so a Release build carries
 * none of it.
 */
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
    "    /// The Home states the snapshot suite captures.",
    "    enum State: String, CaseIterable {",
    "        case ready, empty, balanceError",
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
    "}",
    "#endif",
    "",
  ].join("\n");
};
