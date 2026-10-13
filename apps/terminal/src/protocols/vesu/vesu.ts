/**
 * Vesu V2 integration — lending (earn/borrow), fully on-chain. `quoteLending`
 * resolves the pool config from the Vesu API (`GET {VESU_API_BASE}/pools/{poolId}`)
 * and projects the position (supply/borrow rates + resolved contract addresses)
 * into a `LendingQuote`. `buildLendingCalls` assembles the multicalls for the
 * in-wallet invoke path (earn: approve -> vToken ERC-4626 deposit/withdraw;
 * borrow/repay: (approve ->) V2 `Pool.modify_position` with signed i257 amounts,
 * called directly on the pool contract — V2 has no Singleton). No external SDK —
 * calldata is built with the vendored starknet-js.
 *
 * The calldata layouts and entrypoints are checked against the deployed
 * mainnet V2 class ABIs and the current vesuxyz/vesu-v2 source. A retained
 * feature gate can fail closed if the integration ever needs to be suspended.
 * `LendingQuoteParams` carries no `rpcUrls`; Vesu is mainnet-only here.
 */
import type { Call } from "starknet";
import { WalletError } from "../support/errors";
import { boundedFetch } from "../support/bounded-network";
import { isRecord } from "../support/json";
import { isNonZeroStarkFieldElement, sameAddress } from "../support/networks";
import { VESU_API_BASE, VESU_LENDING_ENABLED } from "../constants";
import { registeredVesuVToken } from "./vesu-anchors";
import type { LendingParams, LendingQuote, LendingQuoteParams } from "../types";
import {
  buildVesuBorrowCalls,
  buildVesuRepayCalls,
  buildVesuSupplyCalls,
  buildVesuWithdrawCalls,
  findVesuAsset,
  parseVesuAmount,
  parseVesuCollateralAmount,
  parseVesuPool,
} from "./vesu-lending";

// Guards every entry into the Vesu lending path so one constant can fail the
// integration closed without allowing quote or calldata construction.
const assertLendingEnabled = (): void => {
  if (!VESU_LENDING_ENABLED) {
    throw new WalletError("Vesu lending is temporarily unavailable");
  }
};

// Fetches and parses the Vesu pool config through the bounded network boundary,
// mapping any transport, deadline, size or shape failure to a stable WalletError.
const fetchVesuPool = async (poolId: string) => {
  const url = `${VESU_API_BASE}/pools/${poolId}`;
  let body: unknown;
  try {
    const response = await boundedFetch(url);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new WalletError("Vesu pool request failed");
    }
    body = await response.json();
  } catch (error) {
    throw error instanceof WalletError ? error : new WalletError("Vesu pool request failed");
  }
  const config = parseVesuPool(body);
  if (config === null || !sameAddress(config.poolAddress, poolId)) {
    throw new WalletError("Could not resolve Vesu pool");
  }
  return config;
};

/**
 * Resolves the Vesu V2 pool config and projects a lending position. Fetches the
 * pool's rates from the Vesu API and its vToken from the pinned pool factory's
 * on-chain registry, and returns a `LendingQuote` a review screen shows before
 * the user commits. In V2 `poolId` is the `Pool` contract address, so
 * `poolAddress` is that same value (the contract borrow/repay call
 * `modify_position` on). The pool must be one the factory created and must
 * list the asset (and the collateral asset, when given), or the quote is
 * refused; an API answer naming a different vToken is refused too. Borrow/repay
 * callers must pass
 * `collateralAsset` (the asset keying the V2 position) and may pass
 * `collateralAmount` (smallest-unit collateral to supply; "0" = none); both are
 * validated and echoed onto the quote.
 *
 * Throws if the integration safety gate is disabled.
 */
export const quoteLending = async (params: LendingQuoteParams): Promise<LendingQuote> => {
  assertLendingEnabled();
  const { action, amount, asset, poolId, collateralAsset, collateralAmount } = params;
  if (!isNonZeroStarkFieldElement(asset)) {
    throw new WalletError("Invalid Vesu asset");
  }
  if (!isNonZeroStarkFieldElement(poolId)) {
    throw new WalletError("Invalid Vesu pool id");
  }
  const amountRaw = parseVesuAmount(amount);

  let resolvedCollateralAsset: string | null = null;
  let resolvedCollateralAmount: string | null = null;
  if (collateralAsset !== undefined) {
    if (!isNonZeroStarkFieldElement(collateralAsset)) {
      throw new WalletError("Invalid Vesu collateral asset");
    }
    resolvedCollateralAsset = collateralAsset;
    resolvedCollateralAmount = parseVesuCollateralAmount(collateralAmount ?? "0").toString();
  }

  const config = await fetchVesuPool(poolId);
  const assetConfig = findVesuAsset(config, asset);
  // The API names the pool and vToken; the pinned factory's registry decides
  // whether they are Vesu's (Sherlock 169). The registered vToken is the one
  // the calls use, and an API answer naming a different one is refused.
  const vTokenAddress = await registeredVesuVToken(poolId, asset);
  if (
    assetConfig?.vTokenAddress !== undefined &&
    assetConfig.vTokenAddress !== null &&
    !sameAddress(assetConfig.vTokenAddress, vTokenAddress)
  ) {
    throw new WalletError("The Vesu API named a vToken this pool does not register");
  }
  if (resolvedCollateralAsset !== null) {
    await registeredVesuVToken(poolId, resolvedCollateralAsset);
  }

  return {
    action,
    amount: amountRaw.toString(),
    asset,
    borrowApyBps: assetConfig?.borrowApyBps ?? null,
    collateralAmount: resolvedCollateralAmount,
    collateralAsset: resolvedCollateralAsset,
    poolAddress: poolId,
    poolId,
    supplyApyBps: assetConfig?.supplyApyBps ?? null,
    vTokenAddress,
  };
};

// Narrows a quote to a resolved vToken address for the earn flows.
const requireVToken = (quote: LendingQuote): string => {
  if (quote.vTokenAddress === null) {
    throw new WalletError("Vesu vToken not resolved for asset");
  }
  return quote.vTokenAddress;
};

// Narrows a quote to a resolved collateral asset for the borrow/repay flows. A
// V2 position is keyed by (collateral_asset, debt_asset, user), so the real
// collateral asset is mandatory here — there is no `0x0` fallback.
const requireCollateralAsset = (quote: LendingQuote): string => {
  if (quote.collateralAsset === null) {
    throw new WalletError("Vesu borrow/repay requires a collateral asset");
  }
  return quote.collateralAsset;
};

/**
 * Builds the Vesu V2 lending multicall for a quoted action, dispatching on
 * `quote.action`: supply -> [approve, vToken.deposit]; withdraw ->
 * [vToken.withdraw]; borrow -> [(approve,) Pool.modify_position]; repay ->
 * [approve, Pool.modify_position] (with signed i257 amounts, called directly on
 * the pool contract). Returns starknet-js Calls ready for
 * submitInvokeTransaction; never signs or broadcasts.
 *
 * Throws if the integration safety gate is disabled.
 */
export const buildLendingCalls = (params: LendingParams): readonly Call[] => {
  assertLendingEnabled();
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
        quote.poolAddress,
        requireCollateralAsset(quote),
        parseVesuCollateralAmount(quote.collateralAmount ?? "0"),
        quote.asset,
        amountRaw,
        accountAddress,
      );
    case "repay":
      return buildVesuRepayCalls(
        quote.poolAddress,
        requireCollateralAsset(quote),
        quote.asset,
        amountRaw,
        accountAddress,
      );
    default:
      throw new WalletError("Unsupported Vesu lending action");
  }
};
