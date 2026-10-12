/**
 * On-chain anchors for Vesu addresses that reach an executable call (Sherlock
 * 169). The Vesu API is a discovery source only: it names the pool and the
 * vToken that a supply approves and deposits into, and nothing in its answer
 * proves those addresses belong to Vesu. The pinned V2 pool factory keeps the
 * registry that does — `v_token_for_asset(pool, asset)` is non-zero only for
 * an asset of a pool that factory created — so the terminal asks it, at the
 * latest block, before any call is built, and fails closed when it cannot.
 */
import { CallData, type RpcProvider } from "starknet";
import { VESU_ADDRESSES } from "../constants";
import { WalletError } from "../support/errors";
import { DEFAULT_NETWORK, isStarkFieldElement } from "../support/networks";
import { withRpcFallback } from "../support/provider";

/** Refusal when the pinned factory does not list the asset in the pool. */
export const VESU_UNREGISTERED = "This Vesu pool or asset is not registered on chain";

/** Refusal when the factory's registry could not be read. */
export const VESU_REGISTRY_UNAVAILABLE = "Could not verify the Vesu pool on chain";

/**
 * Reads the vToken the pinned Vesu V2 pool factory registers for `asset` in
 * `pool`. Throws {@link VESU_UNREGISTERED} when the factory answers zero (an
 * unknown pool, or an asset that pool does not list) and
 * {@link VESU_REGISTRY_UNAVAILABLE} when every endpoint fails or answers with
 * something that is not one field element.
 */
export const registeredVesuVToken = async (
  pool: string,
  asset: string,
  readWith: <T>(run: (provider: RpcProvider) => Promise<T>) => Promise<T> = (run) =>
    withRpcFallback([...DEFAULT_NETWORK.rpcUrls], run),
): Promise<string> => {
  let result: readonly string[];
  try {
    result = await readWith((provider) =>
      provider.callContract(
        {
          calldata: CallData.compile([pool, asset]),
          contractAddress: VESU_ADDRESSES.poolFactory,
          entrypoint: "v_token_for_asset",
        },
        "latest",
      ),
    );
  } catch {
    throw new WalletError(VESU_REGISTRY_UNAVAILABLE);
  }
  const vToken = result.length === 1 ? result[0] : undefined;
  if (vToken === undefined || !isStarkFieldElement(vToken.toLowerCase())) {
    throw new WalletError(VESU_REGISTRY_UNAVAILABLE);
  }
  if (BigInt(vToken) === 0n) {
    throw new WalletError(VESU_UNREGISTERED);
  }
  return `0x${BigInt(vToken).toString(16)}`;
};
