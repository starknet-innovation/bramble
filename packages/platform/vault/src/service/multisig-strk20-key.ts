/**
 * Vault service methods for a multisig's shared STRK20 viewing key (#826).
 * Generation uses Krusty and discards the throwaway phrase. The key is
 * stored here and is not returned to extension messages.
 */

import { WalletError } from "@bramble/core/errors";
import { canonicalFelt, isStarkPrivateKey } from "@bramble/wallet-model/networks";
import {
  acceptMultisigStrk20Key,
  canonicalMultisigStrk20Scope,
  forgetMultisigStrk20Key,
  MULTISIG_STRK20_VIEWING_KEY_SCHEME,
  type MultisigStrk20KeyAccept,
  type MultisigStrk20KeyLedger,
  type MultisigStrk20KeyOffer,
  type MultisigStrk20KeyRequest,
  type MultisigStrk20KeyState,
  multisigStrk20KeyPackageContent,
  multisigStrk20KeyState,
  multisigStrk20ViewingKeyFor,
} from "../accounts/multisig-strk20-key";
import type { EncryptedStore } from "../encrypted-store";
import type { KmsPort } from "../kms-port";
import type { Vault } from "../schema/schema";
import { writeVault } from "./service-creation";
import type { WalletVaultService } from "./service-types";

const INVALID = "Invalid multisig STRK20 key";
const LIMIT = "Multisig STRK20 key limit reached";

const ledgerOf = (vault: Vault): MultisigStrk20KeyLedger => ({
  conflicts: vault.multisigStrk20KeyConflicts,
  keys: vault.multisigStrk20ViewingKeys,
});

const scopeOf = (input: MultisigStrk20KeyRequest) =>
  canonicalMultisigStrk20Scope(input.multisigId, input.chainId, input.poolAddress);

/**
 * A fresh viewing key from Krusty. The throwaway phrase and the intermediate
 * signing key are discarded: the stored key cannot be derived again, which is
 * why co-owners receive the gift wrap instead of re-deriving it. It is not the
 * owner's personal viewing key.
 */
const freshKey = async (kms: KmsPort, chainId: string, poolAddress: string): Promise<string> => {
  const mnemonic = await kms.generateMnemonic(24);
  const { privateKey } = await kms.deriveStarknetKeypair(mnemonic, 0, 0);
  const viewingKey = canonicalFelt(
    await kms.deriveStrk20ViewingKey(privateKey, chainId, poolAddress),
  );
  if (!viewingKey || !isStarkPrivateKey(viewingKey)) {
    throw new WalletError("Krusty KMS returned an invalid STRK20 viewing key");
  }
  return viewingKey;
};

/**
 * Builds the multisig viewing-key methods. Mutations are serialized by the
 * caller. Reads use the snapshot reader so they do not queue behind themselves.
 */
export const multisigStrk20KeyMethods = (
  kms: KmsPort,
  encryptedStore: EncryptedStore,
  readVaultSnapshot: (vaultPassphrase: string) => Promise<Vault>,
): Pick<
  WalletVaultService,
  | "acceptMultisigStrk20Key"
  | "createMultisigStrk20Key"
  | "forgetMultisigStrk20Key"
  | "multisigStrk20KeyStatus"
  | "packageMultisigStrk20Key"
> => ({
  async acceptMultisigStrk20Key(input: MultisigStrk20KeyOffer): Promise<MultisigStrk20KeyAccept> {
    const scope = scopeOf(input);
    const key = canonicalFelt(input.key);
    if (!scope || !key || !isStarkPrivateKey(key)) throw new WalletError(INVALID);
    const vault = await readVaultSnapshot(input.vaultPassphrase);
    const next = acceptMultisigStrk20Key(ledgerOf(vault), {
      ...scope,
      scheme: MULTISIG_STRK20_VIEWING_KEY_SCHEME,
      viewingKey: key,
    });
    if (!next) throw new WalletError(LIMIT);
    if (next.result !== "held") {
      await writeVault(
        encryptedStore,
        {
          ...vault,
          multisigStrk20KeyConflicts: next.ledger.conflicts,
          multisigStrk20ViewingKeys: next.ledger.keys,
        },
        input.vaultPassphrase,
      );
    }
    return next.result;
  },
  async createMultisigStrk20Key(input: MultisigStrk20KeyRequest): Promise<"created" | "held"> {
    const scope = scopeOf(input);
    if (!scope) throw new WalletError(INVALID);
    const vault = await readVaultSnapshot(input.vaultPassphrase);
    if (multisigStrk20ViewingKeyFor(vault.multisigStrk20ViewingKeys, scope)) return "held";
    const viewingKey = await freshKey(kms, scope.chainId, scope.poolAddress);
    const next = acceptMultisigStrk20Key(ledgerOf(vault), {
      ...scope,
      scheme: MULTISIG_STRK20_VIEWING_KEY_SCHEME,
      viewingKey,
    });
    if (next?.result !== "stored") throw new WalletError(LIMIT);
    await writeVault(
      encryptedStore,
      {
        ...vault,
        multisigStrk20KeyConflicts: next.ledger.conflicts,
        multisigStrk20ViewingKeys: next.ledger.keys,
      },
      input.vaultPassphrase,
    );
    return "created";
  },
  async forgetMultisigStrk20Key(input: MultisigStrk20KeyRequest): Promise<boolean> {
    const scope = scopeOf(input);
    if (!scope) throw new WalletError(INVALID);
    const vault = await readVaultSnapshot(input.vaultPassphrase);
    const next = forgetMultisigStrk20Key(ledgerOf(vault), scope);
    if (!next) throw new WalletError(INVALID);
    if (!next.removed) return false;
    await writeVault(
      encryptedStore,
      {
        ...vault,
        multisigStrk20KeyConflicts: next.ledger.conflicts,
        multisigStrk20ViewingKeys: next.ledger.keys,
      },
      input.vaultPassphrase,
    );
    return true;
  },
  async multisigStrk20KeyStatus(input: MultisigStrk20KeyRequest): Promise<MultisigStrk20KeyState> {
    const scope = scopeOf(input);
    if (!scope) throw new WalletError(INVALID);
    const vault = await readVaultSnapshot(input.vaultPassphrase);
    const state = multisigStrk20KeyState(ledgerOf(vault), scope);
    if (!state) throw new WalletError(INVALID);
    return state;
  },
  async packageMultisigStrk20Key(input: MultisigStrk20KeyRequest): Promise<string | null> {
    const scope = scopeOf(input);
    if (!scope) throw new WalletError(INVALID);
    const vault = await readVaultSnapshot(input.vaultPassphrase);
    const viewingKey = multisigStrk20ViewingKeyFor(vault.multisigStrk20ViewingKeys, scope);
    if (!viewingKey) return null;
    return multisigStrk20KeyPackageContent({
      ...scope,
      scheme: MULTISIG_STRK20_VIEWING_KEY_SCHEME,
      viewingKey,
    });
  },
});
