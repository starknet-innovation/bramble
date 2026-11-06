/**
 * Curated Vesu vault allowlist checks (#270). Every vault call the terminal
 * builds — deposit, `request_redeem`, `claim_redeem` — must target a vault in
 * `VESU_CURATED_VAULTS`, and the vault's live class hash is read again right
 * before the wallet sees the calls. The Vesu API only decides which vaults are
 * shown; nothing it returns authorizes a target.
 */
import type { RpcProvider } from "starknet";
import { type CuratedVesuVault, VESU_CURATED_VAULTS } from "../constants";
import { WalletError } from "../support/errors";
import { DEFAULT_NETWORK, isStarkFieldElement, sameAddress } from "../support/networks";
import { withRpcFallback } from "../support/provider";

/** Refusal for a vault, or a vault asset, outside the curated allowlist. */
export const VESU_VAULT_NOT_CURATED = "Bramble doesn't support this Vesu vault";

/** Refusal when a curated vault runs a class other than its pinned one. */
export const VESU_VAULT_CLASS_CHANGED = "This Vesu vault's contract changed, so nothing was sent";

/** Refusal when the vault's class could not be read. */
export const VESU_VAULT_UNVERIFIED = "Could not verify the Vesu vault on chain";

type ClassReader = <T>(run: (provider: RpcProvider) => Promise<T>) => Promise<T>;

const defaultReader: ClassReader = (run) => withRpcFallback([...DEFAULT_NETWORK.rpcUrls], run);

/**
 * Returns the allowlisted entry for `vaultAddress`, or throws
 * {@link VESU_VAULT_NOT_CURATED}. Pure; no network access.
 */
export const curatedVesuVault = (vaultAddress: string): CuratedVesuVault => {
  const vault = VESU_CURATED_VAULTS.find((entry) => sameAddress(entry.address, vaultAddress));
  if (vault === undefined) throw new WalletError(VESU_VAULT_NOT_CURATED);
  return vault;
};

/**
 * Refuses unless `vaultAddress` is allowlisted and its live class hash equals
 * the pinned one. Throws {@link VESU_VAULT_CLASS_CHANGED} on a different class
 * and {@link VESU_VAULT_UNVERIFIED} when every endpoint fails or the answer is
 * not one field element, so a read failure never passes.
 */
export const verifyCuratedVesuVault = async (
  vaultAddress: string,
  readWith: ClassReader = defaultReader,
): Promise<void> => {
  const vault = curatedVesuVault(vaultAddress);
  let live: unknown;
  try {
    live = await readWith((provider) => provider.getClassHashAt(vault.address));
  } catch {
    throw new WalletError(VESU_VAULT_UNVERIFIED);
  }
  if (typeof live !== "string" || !isStarkFieldElement(live.toLowerCase())) {
    throw new WalletError(VESU_VAULT_UNVERIFIED);
  }
  if (BigInt(live) !== BigInt(vault.classHash)) throw new WalletError(VESU_VAULT_CLASS_CHANGED);
};
