/** Wallet-level Nostr operations kept inside the encrypted-vault boundary. */
import { WalletError } from "@mc-wallet/core/errors";
import { MAX_NOSTR_BATCH_ITEMS } from "@mc-wallet/wallet-model/nostr";
import type { KmsPort, NostrApplicationData } from "../kms-port";
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

const requireAuthorization = (isAuthorized: () => boolean): void => {
  if (!isAuthorized()) throw new WalletError("wallet locked");
};

const requireBatch = (items: readonly unknown[]): void => {
  if (items.length === 0 || items.length > MAX_NOSTR_BATCH_ITEMS) {
    throw new WalletError("Invalid Nostr application-data batch");
  }
};

/** Builds Nostr methods without letting mnemonic material leave the vault service. */
export const nostrWalletMethods = (
  kms: KmsPort,
  readVault: ReadVault,
): Pick<
  WalletVaultService,
  | "nostrPublicKey"
  | "openNostrApplicationData"
  | "openNostrApplicationDataBatch"
  | "wrapNostrApplicationData"
  | "wrapNostrApplicationDataBatch"
> => ({
  async nostrPublicKey(vaultPassphrase) {
    return kms.deriveNostrPublicKey(await requireMnemonic(readVault, vaultPassphrase), 0, 0);
  },
  async openNostrApplicationData(input) {
    const mnemonic = await requireMnemonic(readVault, input.vaultPassphrase);
    return kms.openNostrApplicationData(mnemonic, 0, 0, input.eventJson);
  },
  async openNostrApplicationDataBatch(input) {
    requireBatch(input.eventJsons);
    requireAuthorization(input.isAuthorized);
    const mnemonic = await requireMnemonic(readVault, input.vaultPassphrase);
    const opened: Array<NostrApplicationData | null> = [];
    for (const eventJson of input.eventJsons) {
      requireAuthorization(input.isAuthorized);
      try {
        opened.push(await kms.openNostrApplicationData(mnemonic, 0, 0, eventJson));
      } catch {
        opened.push(null);
      }
    }
    requireAuthorization(input.isAuthorized);
    return opened;
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
  async wrapNostrApplicationDataBatch(input) {
    requireBatch(input.items);
    requireAuthorization(input.isAuthorized);
    const mnemonic = await requireMnemonic(readVault, input.vaultPassphrase);
    const wrapped: Array<string | null> = [];
    for (const item of input.items) {
      requireAuthorization(input.isAuthorized);
      try {
        wrapped.push(
          await kms.wrapNostrApplicationData(
            mnemonic,
            0,
            0,
            item.recipientPublicKey,
            item.identifier,
            item.content,
          ),
        );
      } catch {
        wrapped.push(null);
      }
    }
    requireAuthorization(input.isAuthorized);
    return wrapped;
  },
});
