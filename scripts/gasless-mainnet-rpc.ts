/**
 * Picks the Starknet mainnet RPC for the opt-in gasless script. A configured
 * URL is kept only when `starknet_chainId` is mainnet. A bare host such as
 * `http://wallet.nodes.starknet.org` is not an RPC and is replaced by the
 * wallet default. The private key is never involved.
 */
import { isRecord } from "../packages/foundation/core/src/json";
import {
  STARKNET_NETWORKS,
  sameFelt,
} from "../packages/foundation/wallet-model/src/networks/networks";

const CHAIN_ID = STARKNET_NETWORKS.SN_MAIN.chainId;
const WALLET_RPC = STARKNET_NETWORKS.SN_MAIN.rpcUrls[0];

type MainnetRpcChoice = {
  readonly note: string | null;
  readonly source: string;
  readonly url: string;
};

type RpcFetch = (url: string, init: RequestInit) => Promise<Response>;

const chainIdOf = async (url: string, fetchImpl: RpcFetch): Promise<string | null> => {
  try {
    const response = await fetchImpl(url, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "starknet_chainId", params: [] }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json()) as unknown;
    if (!response.ok || !isRecord(body) || typeof body["result"] !== "string") return null;
    return body["result"];
  } catch {
    return null;
  }
};

/**
 * URL safe to print. Userinfo and the query string are removed so an RPC key
 * in the configured URL is not written to the log.
 */
export const displayRpcUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return "unreadable RPC URL";
  }
};

/**
 * Uses `configuredUrl` when it answers mainnet's chain id. Otherwise uses the
 * wallet's mainnet RPC and explains the rejection in `note`.
 */
export const selectMainnetRpc = async (input: {
  readonly configuredSource: string;
  readonly configuredUrl: string;
  readonly fetchImpl?: RpcFetch;
}): Promise<MainnetRpcChoice> => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const answered = await chainIdOf(input.configuredUrl, fetchImpl);
  if (answered !== null && sameFelt(answered, CHAIN_ID)) {
    return { note: null, source: input.configuredSource, url: input.configuredUrl };
  }
  const why = answered === null ? "did not answer starknet_chainId" : `returned chain ${answered}`;
  const shown = displayRpcUrl(input.configuredUrl);
  if (WALLET_RPC === undefined) {
    return {
      note: `${input.configuredSource} ${shown} ${why}, and no wallet RPC is configured.`,
      source: input.configuredSource,
      url: input.configuredUrl,
    };
  }
  return {
    note: `${input.configuredSource} ${shown} ${why}. Using the wallet mainnet RPC.`,
    source: "wallet default",
    url: WALLET_RPC,
  };
};
