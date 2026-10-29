/**
 * Import an account by its address when no derivation reproduces it (issue
 * 398). About half of real Ready and Braavos accounts sit at an address the
 * phrase alone never yields: a guardian is part of an Argent address, a Braavos
 * account may use another salt, and an owner key may have been rotated. The
 * user can always say where the account is; the wallet then proves the phrase
 * controls it before listing it.
 *
 * The proof is an exact key match: the account's live owner key (read per
 * family, see `getAccountOwner`) must equal a key this phrase derives on one of
 * that family's ladders, within the recovery scan's own index bound. The owner
 * is read through the shared two-source proof (./account-owner-proof.ts, which
 * also states its trust assumption), and the same check runs again, at the
 * selected coordinate, before any restore or import writes the account.
 */

import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import {
  isRecoverableAccountRef,
  type RecoverableAccountRef,
} from "@bramble/wallet-model/accounts";
import { type StarknetNetworkId, sameFelt } from "@bramble/wallet-model/networks";
import {
  ADDRESS_IMPORT_REFUSALS,
  RECOVERY_SCAN_LIMITS,
  RESERVED_AGENT_ACCOUNT_INDEX,
  type RecoveryAccountCandidate,
  type RecoveryAccountSelection,
  type RecoveryDerivationKind,
  selectionDerivation,
} from "@bramble/wallet-model/recovery";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import {
  advisoryRestriction,
  canonicalAddress,
  type OwnerFound,
  type Refusal,
  readOwner,
  recordClassHash,
} from "./account-owner-proof";

type AddressImportDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly wallet: WalletStatusReader;
};

// The ladders a family's keys walk: Argent on this wallet's own and on Ready's
// ETH-seeded tree (issue 505), Braavos on its BIP-44 address axis (the vault
// maps the family there).
const LADDERS: Record<"argent" | "braavos", readonly (RecoveryDerivationKind | undefined)[]> = {
  argent: ["starknet-bip44", "argentx-bip44"],
  braavos: [undefined],
};

// The public account this phrase derives at one coordinate, or null when the
// wallet cannot derive (no vault surface, or a result that is not a phrase
// account). Never a signing key: preview derives public metadata only.
const previewAt = async (
  deps: AddressImportDeps,
  input: { readonly mnemonic: string; readonly networkId: StarknetNetworkId },
  selection: RecoveryAccountSelection,
): Promise<RecoverableAccountRef | null> => {
  const account = await deps.wallet.previewAccount?.({
    accountContractType: selection.accountContractType,
    accountIndex: selection.accountIndex,
    ...(selection.classHash === undefined ? {} : { classHash: selection.classHash }),
    derivation: selectionDerivation(selection),
    mnemonic: input.mnemonic,
    networkId: input.networkId,
  });
  return isRecoverableAccountRef(account) ? account : null;
};

// The phrase's key on each of the family's ladders at one index, or the first
// whose public key is the owner's.
const matchAtIndex = async (
  deps: AddressImportDeps,
  input: { readonly mnemonic: string; readonly networkId: StarknetNetworkId },
  found: OwnerFound,
  accountIndex: number,
  stillAuthorized: () => boolean,
): Promise<RecoverableAccountRef | Refusal | null> => {
  for (const derivation of LADDERS[found.family]) {
    const preview = await previewAt(deps, input, {
      accountContractType: found.family,
      accountIndex,
      classHash: recordClassHash(found),
      ...(derivation === undefined ? {} : { derivation }),
    });
    // A lock while the key was derived ends the search here, between ladders.
    if (!stillAuthorized()) return { error: "wallet locked" };
    if (!preview) return { error: "account discovery is unavailable" };
    if (sameFelt(preview.publicKeyX, found.ownerPublicKey)) return preview;
  }
  return null;
};

// Walks the family's ladders index by index, both ladders at each index, so a
// low index on either is found first. Bounded by the recovery scan's ceiling,
// which sits far below strkd's reserved agent index; that index is skipped all
// the same, in case the ceiling ever moves.
const findOwnerKey = async (
  deps: AddressImportDeps,
  input: { readonly mnemonic: string; readonly networkId: StarknetNetworkId },
  found: OwnerFound,
  stillAuthorized: () => boolean,
): Promise<RecoverableAccountRef | Refusal | null> => {
  for (let index = 0; index < RECOVERY_SCAN_LIMITS.maxScannedIndexes; index += 1) {
    if (!stillAuthorized()) return { error: "wallet locked" };
    const match =
      index === RESERVED_AGENT_ACCOUNT_INDEX
        ? null
        : await matchAtIndex(deps, input, found, index, stillAuthorized);
    if (match !== null) return match;
  }
  return null;
};

/**
 * Finds which key of `mnemonic` controls the account at `address`, and returns
 * it as a recovery candidate that keeps the address. Refuses with one of
 * {@link ADDRESS_IMPORT_REFUSALS} otherwise. When the phrase came from the
 * unlocked vault, `stillAuthorized` is re-checked after every derivation and
 * once more after the last chain read, so a lock mid-search returns nothing.
 */
export const findAccountByAddress = async (
  deps: AddressImportDeps,
  input: {
    readonly address: string;
    readonly mnemonic: string;
    readonly networkId: StarknetNetworkId;
  },
  stillAuthorized: () => boolean = () => true,
): Promise<{ readonly candidate: RecoveryAccountCandidate; readonly ok: true } | Refusal> => {
  const address = canonicalAddress(input.address);
  if (address === null) return { error: ADDRESS_IMPORT_REFUSALS.invalid };
  const found = await readOwner(deps, address, input.networkId);
  if ("error" in found) return found;
  const matched = await findOwnerKey(deps, input, found, stillAuthorized);
  if (matched === null) return { error: ADDRESS_IMPORT_REFUSALS.noMatch };
  if ("error" in matched) return matched;
  const account = { ...matched, address, id: `${matched.networkId}:${address}` };
  const restriction = await advisoryRestriction(deps, account, input.networkId);
  if (!stillAuthorized()) return { error: "wallet locked" };
  return {
    candidate: {
      account,
      byAddress: true,
      deployed: true,
      funded: false,
      ...(restriction ? { restriction } : {}),
    },
    ok: true,
  };
};

/**
 * Re-proves, just before a restore or import writes them, every selection that
 * carries an address: the account's live owner must still be the key this
 * phrase derives at that exact coordinate. Runs before the guarded write, so a
 * refusal changes nothing and never locks the session. Returns the first
 * refusal, or null when every such selection still checks out.
 */
export const verifyAddressSelections = async (
  deps: AddressImportDeps,
  input: {
    readonly mnemonic: string;
    readonly networkId: StarknetNetworkId;
    readonly selections: readonly RecoveryAccountSelection[];
  },
): Promise<Refusal | null> => {
  const byAddress = input.selections.filter((selection) => selection.address !== undefined);
  for (const selection of byAddress) {
    const found = await readOwner(deps, selection.address as string, input.networkId);
    if ("error" in found) return found;
    if (found.family !== selection.accountContractType) {
      return { error: ADDRESS_IMPORT_REFUSALS.noMatch };
    }
    // The record keeps the class the lookup found; a pick naming another (or
    // none), or an account upgraded since, is no longer the one shown.
    if (
      selection.classHash === undefined ||
      !sameFelt(selection.classHash, recordClassHash(found))
    ) {
      return { error: ADDRESS_IMPORT_REFUSALS.stale };
    }
    const preview = await previewAt(deps, input, selection);
    if (!preview) return { error: "account discovery is unavailable" };
    if (!sameFelt(preview.publicKeyX, found.ownerPublicKey)) {
      return { error: ADDRESS_IMPORT_REFUSALS.noMatch };
    }
  }
  return null;
};
