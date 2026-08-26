/** Wallet-level Nostr operations kept inside the encrypted-vault boundary. */
import { WalletError } from "@mc-wallet/core/errors";
import type { KmsPort } from "../kms-port";
import type { Vault } from "../schema/schema";
import type { WalletVaultService } from "./service-types";

type ReadVault = (vaultPassphrase: string) => Promise<Vault>;

const requireMnemonic = async (readVault: ReadVault, vaultPassphrase: string): Promise<string> => {
  const vault = await readVault(vaultPassphrase);
  if (!vault.mnemonic) {
    throw new WalletError("Nostr coordination requires a recovery-phrase wallet");
  }
  return vault.mnemonic;
};

/** Builds the three Nostr methods without letting mnemonic material leave the vault service. */
export const nostrWalletMethods = (
  kms: KmsPort,
  readVault: ReadVault,
): Pick<
  WalletVaultService,
  "nostrPublicKey" | "openNostrApplicationData" | "wrapNostrApplicationData"
> => ({
  async nostrPublicKey(vaultPassphrase) {
    return kms.deriveNostrPublicKey(await requireMnemonic(readVault, vaultPassphrase), 0, 0);
  },
  async openNostrApplicationData(input) {
    const mnemonic = await requireMnemonic(readVault, input.vaultPassphrase);
    return kms.openNostrApplicationData(mnemonic, 0, 0, input.eventJson);
  },
  async wrapNostrApplicationData(input) {
    const mnemonic = await requireMnemonic(readVault, input.vaultPassphrase);
    return kms.wrapNostrApplicationData(
      mnemonic,
      0,
      0,
      input.recipientPublicKey,
      input.identifier,
      input.content,
    );
  },
});
