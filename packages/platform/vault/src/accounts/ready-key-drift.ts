/**
 * Finds Ready-scheme accounts whose stored key came from Krusty's pre-3.0
 * Argent legacy derivation.
 *
 * Krusty <= 2.0 re-seeded Ready's second BIP-32 tree with all 32 bytes of the
 * intermediate ETH key; Argent X (and Krusty 3.0+) drops its leading zero
 * bytes first. For roughly 1 in 256 phrases the two disagree, so an account
 * restored with an older Bramble holds a key Argent X would never derive. The
 * vault still signs for it with the stored key, but restoring the same phrase
 * elsewhere will not find it again. Comparing public keys is enough to tell:
 * the stored x-coordinate is the old derivation's, and a fresh 3.x derivation
 * of the same coordinate is Argent X's.
 */

import { sameFelt } from "@bramble/wallet-model/networks";
import type { KmsPort } from "../kms-port";
import type { Vault } from "../schema/schema";

/**
 * The ids of stored `argentx-bip44` accounts whose stored public key differs
 * from what the current Krusty derives at the same coordinate. Only public
 * keys are compared; no private key is derived or read. An account whose
 * phrase is no longer in the vault is skipped, since nothing can re-derive it.
 * Throws when Krusty fails, so callers treat a failure as "unknown", never as
 * "no affected accounts".
 */
export const findPreFixReadyAccountIds = async (
  kms: Pick<KmsPort, "deriveArgentLegacyPublicKey">,
  vault: Pick<Vault, "accounts" | "importedSeeds" | "mnemonic">,
): Promise<readonly string[]> => {
  const affected: string[] = [];
  for (const account of vault.accounts) {
    if (account.derivation.kind !== "argentx-bip44") {
      continue;
    }
    const { seedId } = account.derivation;
    const mnemonic =
      seedId === undefined
        ? vault.mnemonic
        : (vault.importedSeeds.find((seed) => seed.id === seedId)?.mnemonic ?? null);
    if (mnemonic === null) {
      continue;
    }
    const current = await kms.deriveArgentLegacyPublicKey(
      mnemonic,
      account.derivation.addressIndex,
    );
    if (!sameFelt(current, account.publicKeyX)) {
      affected.push(account.id);
    }
  }
  return affected;
};
