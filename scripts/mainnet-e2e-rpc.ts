/**
 * Dedicated-RPC checks and ERC20 balance reads for the mainnet E2E job.
 *
 * The URL is validated, then used only as a fetch target. Errors never include
 * it: a provider URL often carries an API key. Shared Starknet Foundation
 * hosts are refused so this job cannot put load on the wallet's own RPC.
 */

import { createHash } from "node:crypto";
import { isRecord } from "@bramble/core/json";
import { isServiceUrl, normalizeHostname } from "@bramble/core/service-url";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  STARKNET_NETWORKS,
  STRK_TOKEN_ADDRESS,
  sameFelt,
  USDC_TOKEN_ADDRESS,
  uint256Felts,
} from "@bramble/wallet-model/networks";
import { hash } from "starknet";

const SHARED_MAINNET_RPC_HOSTS = new Set([
  "mainnet.nodes.starknet.org",
  "wallet.nodes.starknet.org",
]);

const MAINNET_CHAIN_ID = STARKNET_NETWORKS.SN_MAIN.chainId;
const BALANCE_SELECTOR = hash.getSelectorFromName("balanceOf");

/** `fetch` signature the balance reader accepts so tests can stub the network. */
export type RpcFetch = (url: string, init: RequestInit) => Promise<Response>;

/** STRK and native USDC balances of the hot wallet, in raw token units. */
export type HotWalletBalances = {
  readonly strk: bigint;
  readonly usdc: bigint;
};

/**
 * Whether `hostname` is one of the shared Starknet hosts the wallet uses for
 * users. Comparison ignores case and a single trailing dot.
 */
export const isSharedMainnetRpcHost = (hostname: string): boolean =>
  SHARED_MAINNET_RPC_HOSTS.has(normalizeHostname(hostname));

/**
 * Returns `value` when it is a canonical HTTPS URL on a dedicated host.
 * Throws a static message otherwise, without echoing `value`.
 */
export const dedicatedMainnetRpcUrl = (value: string | undefined): string => {
  if (typeof value !== "string" || !isServiceUrl(value)) {
    throw new Error("Mainnet E2E RPC URL must be a valid HTTPS service URL");
  }
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Mainnet E2E RPC URL must be a valid HTTPS service URL");
  }
  if (isSharedMainnetRpcHost(url.hostname)) {
    throw new Error("Mainnet E2E RPC URL must be a dedicated test RPC endpoint");
  }
  return value;
};

/**
 * Lowercase hex SHA-256 of the exact URL text. Preflight publishes it as a job
 * output so `execute` can prove it holds the same endpoint without the URL
 * itself appearing in an output or a log.
 */
export const rpcUrlSha256 = (rpcUrl: string): string =>
  createHash("sha256").update(rpcUrl, "utf8").digest("hex");

/**
 * Canonical non-zero account address, or a static error that does not echo
 * the supplied text.
 */
export const starknetAddress = (value: string | undefined): string => {
  const canonical = canonicalFelt(value ?? "");
  if (canonical === null || !isNonZeroStarkFieldElement(canonical)) {
    throw new Error("MAINNET_E2E_ADDRESS must be a Starknet address");
  }
  return canonical;
};

const rpcResult = async (
  fetchImpl: RpcFetch,
  rpcUrl: string,
  method: string,
  params: readonly unknown[],
): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetchImpl(rpcUrl, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
      headers: { "content-type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(`Mainnet RPC ${method} failed`);
  }
  if (!response.ok) throw new Error(`Mainnet RPC ${method} failed`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Mainnet RPC ${method} failed`);
  }
  if (!isRecord(body) || !Object.hasOwn(body, "result")) {
    throw new Error(`Mainnet RPC ${method} failed`);
  }
  return body["result"];
};

const assertMainnet = async (fetchImpl: RpcFetch, rpcUrl: string): Promise<void> => {
  const result = await rpcResult(fetchImpl, rpcUrl, "starknet_chainId", []);
  if (typeof result !== "string" || !sameFelt(result, MAINNET_CHAIN_ID)) {
    throw new Error("Dedicated RPC did not answer Starknet mainnet");
  }
};

const readUint256 = async (
  fetchImpl: RpcFetch,
  rpcUrl: string,
  token: string,
  owner: string,
): Promise<bigint> => {
  const result = await rpcResult(fetchImpl, rpcUrl, "starknet_call", [
    {
      calldata: [owner],
      contract_address: token,
      entry_point_selector: BALANCE_SELECTOR,
    },
    { block_tag: "latest" },
  ]);
  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error("Mainnet RPC starknet_call failed");
  }
  const amount = uint256Felts(result[0], result[1]);
  if (amount === null) throw new Error("Mainnet RPC starknet_call failed");
  return amount;
};

/**
 * Returns `value` only when it passes {@link dedicatedMainnetRpcUrl} and
 * answers `starknet_chainId` with mainnet. Throws otherwise, including when the
 * endpoint is unreachable or redirects. Never substitutes another endpoint and
 * never includes `value` in the thrown message.
 */
export const assertDedicatedMainnetRpc = async (
  value: string | undefined,
  fetchImpl: RpcFetch = fetch,
): Promise<string> => {
  const rpcUrl = dedicatedMainnetRpcUrl(value);
  await assertMainnet(fetchImpl, rpcUrl);
  return rpcUrl;
};

/**
 * Reads the hot wallet's STRK and native USDC balances. Fails closed when the
 * RPC is not dedicated mainnet or either balance is not a uint256. `rpcUrl`
 * is not included in any thrown message.
 */
export const readHotWalletBalances = async (input: {
  readonly address: string;
  readonly fetchImpl?: RpcFetch;
  readonly rpcUrl: string;
}): Promise<HotWalletBalances> => {
  const address = starknetAddress(input.address);
  const fetchImpl = input.fetchImpl ?? fetch;
  const rpcUrl = await assertDedicatedMainnetRpc(input.rpcUrl, fetchImpl);
  const strk = await readUint256(fetchImpl, rpcUrl, STRK_TOKEN_ADDRESS, address);
  const usdc = await readUint256(fetchImpl, rpcUrl, USDC_TOKEN_ADDRESS, address);
  return { strk, usdc };
};
