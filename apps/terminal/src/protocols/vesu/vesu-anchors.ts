/**
 * On-chain anchors for Vesu addresses that reach an executable call (Sherlock
 * 169). The Vesu API is a discovery source only: it names the pool and the
 * vToken that a supply approves and deposits into, and nothing in its answer
 * proves those addresses belong to Vesu. The pinned V2 pool factory keeps the
 * registry that does — `v_token_for_asset(pool, asset)` is non-zero only for
 * an asset of a pool that factory created — so the terminal asks it, every
 * asset of one call at one block, before any call is built, and fails closed
 * when it cannot.
 */
import { CallData, type RpcProvider } from "starknet";
import { VESU_ADDRESSES } from "../constants";
import { WalletError } from "../support/errors";
import { DEFAULT_NETWORK, isStarkFieldElement, sameAddress } from "../support/networks";
import { withRpcFallback } from "../support/provider";
import type { LendingQuote } from "../types";

/** Refusal when the pinned factory does not list the asset in the pool. */
export const VESU_UNREGISTERED = "This Vesu pool or asset is not registered on chain";

/** Refusal when the factory's registry could not be read. */
export const VESU_REGISTRY_UNAVAILABLE = "Could not verify the Vesu pool on chain";

type RegistryReader = <T>(run: (provider: RpcProvider) => Promise<T>) => Promise<T>;

const defaultReader: RegistryReader = (run) => withRpcFallback([...DEFAULT_NETWORK.rpcUrls], run);

/**
 * Reads the vTokens the pinned Vesu V2 pool factory registers for each of
 * `assets` in `pool`, all from one provider at one block (#270), so a pool
 * and its assets are never judged against two different chain states. The
 * block is the provider's latest, read once. Throws {@link VESU_UNREGISTERED}
 * when the factory answers zero for an asset (an unknown pool, or an asset
 * that pool does not list) and {@link VESU_REGISTRY_UNAVAILABLE} when every
 * endpoint fails, the block number is unusable, or an answer is not one field
 * element. Returns the vTokens in the order of `assets`.
 */
export const registeredVesuVTokens = async (
  pool: string,
  assets: readonly string[],
  readWith: RegistryReader = defaultReader,
): Promise<readonly string[]> => {
  let results: readonly (readonly string[])[];
  try {
    results = await readWith(async (provider) => {
      const block = await provider.getBlockNumber();
      if (!Number.isSafeInteger(block) || block < 0) {
        throw new WalletError(VESU_REGISTRY_UNAVAILABLE);
      }
      return Promise.all(
        assets.map((asset) =>
          provider.callContract(
            {
              calldata: CallData.compile([pool, asset]),
              contractAddress: VESU_ADDRESSES.poolFactory,
              entrypoint: "v_token_for_asset",
            },
            block,
          ),
        ),
      );
    });
  } catch {
    throw new WalletError(VESU_REGISTRY_UNAVAILABLE);
  }
  return results.map((result) => {
    const vToken = result.length === 1 ? result[0] : undefined;
    if (vToken === undefined || !isStarkFieldElement(vToken.toLowerCase())) {
      throw new WalletError(VESU_REGISTRY_UNAVAILABLE);
    }
    if (BigInt(vToken) === 0n) {
      throw new WalletError(VESU_UNREGISTERED);
    }
    return `0x${BigInt(vToken).toString(16)}`;
  });
};

/**
 * Reads the vToken the pinned Vesu V2 pool factory registers for `asset` in
 * `pool`, with the refusals of {@link registeredVesuVTokens}.
 */
export const registeredVesuVToken = async (
  pool: string,
  asset: string,
  readWith: RegistryReader = defaultReader,
): Promise<string> => {
  const [vToken] = await registeredVesuVTokens(pool, [asset], readWith);
  if (vToken === undefined) {
    throw new WalletError(VESU_REGISTRY_UNAVAILABLE);
  }
  return vToken;
};

/**
 * Verifies both legs of a Multiply position against the pinned factory's
 * registry before its calls are built. A Multiply build hands the pool to
 * `modify_lever` and to both delegation calls, so a pool the API names but the
 * factory never created would receive the user's margin and debt (Sherlock
 * 169). Throws the same refusals as {@link registeredVesuVToken}.
 */
export const verifyVesuMultiplyPool = async (
  pool: string,
  collateralAsset: string,
  debtAsset: string,
  readWith?: RegistryReader,
): Promise<void> => {
  await registeredVesuVTokens(pool, [collateralAsset, debtAsset], readWith);
};

/**
 * Re-reads the pinned factory's registry for a lending quote right before the
 * wallet handoff (#270). `quoteLending` reads it once, when quoting, and the
 * review can sit open for as long as the user takes, so the targets its calls
 * use — the pool, and the vToken a supply approves and deposits into — are
 * checked again here. Throws {@link VESU_UNREGISTERED} when the pool no longer
 * lists the asset or the collateral asset, and {@link VESU_REGISTRY_UNAVAILABLE}
 * when the registry cannot be read or now names a different vToken than the
 * quote's.
 */
export const recheckVesuLendingQuote = async (
  quote: Pick<LendingQuote, "asset" | "collateralAsset" | "poolAddress" | "vTokenAddress">,
  readWith?: RegistryReader,
): Promise<void> => {
  if (quote.vTokenAddress === null) {
    throw new WalletError(VESU_REGISTRY_UNAVAILABLE);
  }
  const assets =
    quote.collateralAsset === null ? [quote.asset] : [quote.asset, quote.collateralAsset];
  const [vToken] = await registeredVesuVTokens(quote.poolAddress, assets, readWith);
  if (vToken === undefined || !sameAddress(vToken, quote.vTokenAddress)) {
    throw new WalletError(VESU_REGISTRY_UNAVAILABLE);
  }
};
