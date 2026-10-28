/**
 * Import a private key's Ready account by its address (issue 779). A Ready
 * account deployed with a guardian, another salt, or since rotated to this key
 * sits at an address no Argent release derives from the key alone, so release
 * discovery (./ready-key-accounts.ts) cannot list it. The user can say where it
 * is; the wallet then proves this key controls it.
 *
 * The proof is #398's, with one key instead of a ladder: the account's live
 * owner is read through the shared two-source proof (account-owner-proof.ts:
 * two SNF sources that must agree, each on the expected chain), its family
 * must be Argent, and its owner key must equal this key's public key, derived
 * through the vault's key-free preview. Braavos accounts are out of scope for
 * private keys and refused. The same proof runs again, bound to the class the
 * lookup recorded, just before an import writes the account.
 *
 * The key never leaves the background; no answer, refusal, or log carries it.
 */
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { type StarknetNetworkId, sameFelt } from "@bramble/wallet-model/networks";
import {
  ADDRESS_IMPORT_REFUSALS,
  KEY_ADDRESS_IMPORT_REFUSALS,
  type KeyAddressCandidate,
} from "@bramble/wallet-model/recovery";
import {
  advisoryRestriction,
  canonicalAddress,
  type OwnerProofDeps,
  type Refusal,
  readOwner,
  recordClassHash,
} from "../onboarding/account-owner-proof";
import type { ReadyKeyInput } from "./ready-key-accounts";
import type { WalletStatusReader } from "./wallet-reader";

type KeyAddressDeps = OwnerProofDeps & {
  readonly wallet: Pick<WalletStatusReader, "previewImportedAccount">;
};

type Proved = {
  readonly address: string;
  readonly classHash: string;
  readonly networkId: StarknetNetworkId;
  readonly publicKeyX: string;
};

// The whole proof, shared by the lookup and the re-proof before the write.
// `recorded` is the class the lookup recorded, when re-proving a pick.
const prove = async (
  deps: KeyAddressDeps,
  input: ReadyKeyInput & { readonly address: string },
  recorded?: string,
): Promise<Proved | Refusal> => {
  const { address: pasted, ...key } = input;
  const address = canonicalAddress(pasted);
  if (address === null) return { error: ADDRESS_IMPORT_REFUSALS.invalid };
  const found = await readOwner(deps, address, key.networkId);
  if ("error" in found) {
    // A Bramble account imports through its own account type, not this one.
    return found.error === ADDRESS_IMPORT_REFUSALS.brambleAccount
      ? { error: KEY_ADDRESS_IMPORT_REFUSALS.brambleAccount }
      : found;
  }
  // Braavos private keys are out of scope (issue 779): refused as the import
  // form refuses them, whatever the key.
  if (found.family !== "argent") return { error: ADDRESS_IMPORT_REFUSALS.unsupportedClass };
  const classHash = recordClassHash(found);
  // The record keeps the class the lookup found; a pick naming another, or an
  // account upgraded since, is no longer the one shown.
  if (recorded !== undefined && !sameFelt(recorded, classHash)) {
    return { error: ADDRESS_IMPORT_REFUSALS.stale };
  }
  const preview = deps.wallet.previewImportedAccount;
  if (!preview) return { error: ADDRESS_IMPORT_REFUSALS.unavailable };
  let publicKeyX: string;
  try {
    ({ publicKeyX } = await preview({ ...key, accountContractType: "argent", classHash }));
  } catch {
    // Only an Argent deployment class reaches here; a preview that still
    // refuses it is a class this wallet cannot record.
    return { error: ADDRESS_IMPORT_REFUSALS.unsupportedClass };
  }
  if (!sameFelt(publicKeyX, found.ownerPublicKey)) {
    return { error: KEY_ADDRESS_IMPORT_REFUSALS.noMatch };
  }
  return { address, classHash, networkId: key.networkId, publicKeyX };
};

/**
 * Finds the Ready account this key controls at `address`, or refuses with one
 * of {@link ADDRESS_IMPORT_REFUSALS} / {@link KEY_ADDRESS_IMPORT_REFUSALS}.
 * Read-only: nothing is written until an import re-proves the pick. The
 * caller holds the session guard (a lock or a vault created meanwhile
 * refuses the answer; see routing/ready-key-handlers.ts).
 */
export const findKeyAccountByAddress = async (
  deps: KeyAddressDeps,
  input: ReadyKeyInput & { readonly address: string },
): Promise<{ readonly candidate: KeyAddressCandidate; readonly ok: true } | Refusal> => {
  const proved = await prove(deps, input);
  if ("error" in proved) return proved;
  const restriction = await advisoryRestriction(
    deps,
    { accountContractType: "argent", address: proved.address, publicKeyX: proved.publicKeyX },
    proved.networkId,
  );
  return {
    candidate: {
      accountId: `${proved.networkId}:${proved.address}`,
      address: proved.address,
      byAddress: true,
      classHash: proved.classHash,
      deployed: true,
      ...(restriction ? { restriction } : {}),
    },
    ok: true,
  };
};

/**
 * Re-proves an address pick just before the import writes it: the account's
 * live owner must still be this key, at the class the lookup recorded.
 * Returns the canonical address and class to write. Refuses with
 * `RefusedBeforeWrite` otherwise, before anything is written and without
 * locking the session.
 */
export const verifyKeyAddressPick = async (
  deps: KeyAddressDeps,
  input: ReadyKeyInput & { readonly address: string; readonly classHash: string },
): Promise<{ readonly address: string; readonly classHash: string }> => {
  const { classHash: recorded, ...key } = input;
  const proved = await prove(deps, key, recorded);
  if ("error" in proved) throw new RefusedBeforeWrite(proved.error);
  return { address: proved.address, classHash: proved.classHash };
};
