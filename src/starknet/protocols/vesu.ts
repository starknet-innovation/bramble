/**
 * Vesu integration — lending (earn/borrow), fully on-chain. `quoteLending`
 * resolves the pool config from the Vesu API (`GET {VESU_API_BASE}/pools/{poolId}`),
 * reads the singleton address on-chain via `singleton()` on the pool extension,
 * and projects the position (supply/borrow rates + resolved contract addresses)
 * into a `LendingQuote`. `buildLendingCalls` assembles the documented multicalls
 * for the in-wallet invoke path (earn: approve -> vToken ERC-4626
 * deposit/withdraw; borrow/repay: approve -> singleton `modify_position` with
 * signed i257 amounts). No external SDK — calldata is built with the vendored
 * starknet-js.
 *
 * ⚠️ VERIFY BEFORE FUNDS: the recon pointed at Vesu's STAGING API; the constant
 * now points at production (`VESU_API_BASE`), but pool ids and every resolved
 * address (extension, singleton, vToken) must be re-confirmed on a mainnet
 * explorer / docs.vesu.xyz before signing. LendingQuoteParams carries no
 * `rpcUrls`, so the `singleton()` read runs against the default mainnet endpoint
 * (Vesu is mainnet-only here); thread a configured RPC list through once the
 * shared contract exposes one.
 */
import type { Call } from "starknet";
import { WalletError } from "../../shared/errors";
import { isRecord } from "../../shared/json";
import { DEFAULT_NETWORK, isNonZeroStarkFieldElement } from "../networks";
import { isTransportRpcError, withRpcFallback } from "../provider";
import { VESU_API_BASE } from "./constants";
import type { LendingParams, LendingQuote, LendingQuoteParams } from "./types";
import {
  buildVesuBorrowCalls,
  buildVesuRepayCalls,
  buildVesuSupplyCalls,
  buildVesuWithdrawCalls,
  findVesuAsset,
  parseSingletonAddress,
  parseVesuAmount,
  parseVesuPool,
} from "./vesu-lending";

/**
 * Vesu protocol id for tagging quotes and routing.
 */
export const VESU_PROTOCOL_ID = "vesu" as const;

// Fetches and parses the Vesu pool config over HTTP, mapping any transport or
// shape failure to a stable WalletError.
const fetchVesuPool = async (poolId: string) => {
  const url = `${VESU_API_BASE}/pools/${poolId}`;
  let body: unknown;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new WalletError("Vesu pool request failed");
    }
    body = await response.json();
  } catch (error) {
    throw error instanceof WalletError ? error : new WalletError("Vesu pool request failed");
  }
  const config = parseVesuPool(body);
  if (config === null) {
    throw new WalletError("Could not resolve Vesu pool");
  }
  return config;
};

// Reads `singleton()` on the pool extension, returning null on a semantic
// (non-transport) failure so a quote still resolves for earn-only flows.
const resolveSingleton = async (extensionAddress: string): Promise<string | null> =>
  withRpcFallback([...DEFAULT_NETWORK.rpcUrls], async (provider) => {
    try {
      const response = await provider.callContract(
        { calldata: [], contractAddress: extensionAddress, entrypoint: "singleton" },
        "latest",
      );
      return parseSingletonAddress(response);
    } catch (error) {
      if (isTransportRpcError(error)) {
        throw error;
      }
      return null;
    }
  });

/**
 * Resolves the Vesu pool config and projects a lending position. Fetches the
 * pool from the Vesu API, resolves the per-asset vToken and current rates,
 * reads the singleton address on-chain, and returns a `LendingQuote` a review
 * screen shows before the user commits. `vTokenAddress` / `singletonAddress` are
 * null when the pool does not list the asset or the singleton read fails.
 */
export const quoteLending = async (params: LendingQuoteParams): Promise<LendingQuote> => {
  const { action, amount, asset, poolId } = params;
  if (!isNonZeroStarkFieldElement(asset)) {
    throw new WalletError("Invalid Vesu asset");
  }
  if (!isNonZeroStarkFieldElement(poolId)) {
    throw new WalletError("Invalid Vesu pool id");
  }
  const amountRaw = parseVesuAmount(amount);

  const config = await fetchVesuPool(poolId);
  const assetConfig = findVesuAsset(config, asset);
  const singletonAddress = await resolveSingleton(config.extensionAddress);

  return {
    action,
    amount: amountRaw.toString(),
    asset,
    borrowApyBps: assetConfig?.borrowApyBps ?? null,
    poolId,
    singletonAddress,
    supplyApyBps: assetConfig?.supplyApyBps ?? null,
    vTokenAddress: assetConfig?.vTokenAddress ?? null,
  };
};

// Narrows a quote to a resolved vToken address for the earn flows.
const requireVToken = (quote: LendingQuote): string => {
  if (quote.vTokenAddress === null) {
    throw new WalletError("Vesu vToken not resolved for asset");
  }
  return quote.vTokenAddress;
};

// Narrows a quote to a resolved singleton address for the borrow flows.
const requireSingleton = (quote: LendingQuote): string => {
  if (quote.singletonAddress === null) {
    throw new WalletError("Vesu singleton not resolved for pool");
  }
  return quote.singletonAddress;
};

/**
 * Builds the Vesu lending multicall for a quoted action, dispatching on
 * `quote.action`: supply -> [approve, vToken.deposit]; withdraw ->
 * [vToken.withdraw]; borrow -> [modify_position]; repay -> [approve,
 * modify_position] (with signed i257 debt amounts). Returns starknet-js Calls
 * ready for submitInvokeTransaction; never signs or broadcasts.
 */
export const buildLendingCalls = (params: LendingParams): readonly Call[] => {
  const { accountAddress, quote } = params;
  if (!isNonZeroStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid Vesu account address");
  }
  if (!isRecord(quote)) {
    throw new WalletError("Vesu buildLendingCalls needs a lending quote");
  }
  const amountRaw = parseVesuAmount(quote.amount);
  switch (quote.action) {
    case "supply":
      return buildVesuSupplyCalls(quote.asset, requireVToken(quote), amountRaw, accountAddress);
    case "withdraw":
      return buildVesuWithdrawCalls(requireVToken(quote), amountRaw, accountAddress);
    case "borrow":
      return buildVesuBorrowCalls(
        requireSingleton(quote),
        quote.poolId,
        quote.asset,
        amountRaw,
        accountAddress,
      );
    case "repay":
      return buildVesuRepayCalls(
        requireSingleton(quote),
        quote.poolId,
        quote.asset,
        amountRaw,
        accountAddress,
      );
    default:
      throw new WalletError("Unsupported Vesu lending action");
  }
};
