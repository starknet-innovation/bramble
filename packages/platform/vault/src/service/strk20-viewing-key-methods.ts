/**
 * The vault's two STRK20 viewing-key methods, composed in one place.
 *
 * Grouped like {@link nostrWalletMethods} so the service body stays readable and
 * within its size budget. Both are vault-internal: the software form derives on
 * demand and returns the key to the privileged caller, while the Ledger ceremony
 * returns nothing at all — it folds the device signature and writes the result
 * inside the vault boundary, so no caller can observe the key.
 */

import {
  deriveVaultStrk20ViewingKey,
  runLedgerStrk20ViewingKeyCeremony,
} from "../accounts/strk20-viewing-key";
import type { KmsPort } from "../kms-port";
import type { Vault } from "../schema/schema";
import type { WalletVaultService } from "./service-types";

/**
 * Builds the vault's two STRK20 viewing-key methods over the caller's vault IO.
 *
 * The software form derives on demand and returns the key to the privileged
 * caller; the Ledger ceremony returns nothing, folding the device signature and
 * writing the result inside the vault boundary so no caller can observe it.
 */
export const strk20ViewingKeyMethods = (
  kms: KmsPort,
  io: {
    readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
    readonly readVaultSnapshot: (vaultPassphrase: string) => Promise<Vault>;
    readonly serialized: <T>(work: () => Promise<T>) => Promise<T>;
    readonly writeVault: (vault: Vault, vaultPassphrase: string) => Promise<void>;
  },
): Pick<WalletVaultService, "deriveLedgerStrk20ViewingKey" | "deriveStrk20ViewingKey"> => ({
  deriveLedgerStrk20ViewingKey: (input) =>
    runLedgerStrk20ViewingKeyCeremony(kms, input, {
      readVault: () => io.readVaultSnapshot(input.vaultPassphrase),
      serialized: io.serialized,
      writeVault: (vault) => io.writeVault(vault, input.vaultPassphrase),
    }),
  async deriveStrk20ViewingKey(input) {
    const vault = await io.readVault(input.vaultPassphrase);
    return deriveVaultStrk20ViewingKey(
      kms,
      vault,
      input.accountId,
      input.chainId,
      input.poolAddress,
    );
  },
});
