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
 * that family's ladders, within the recovery scan's own index bound. Nothing
 * else is trusted. An unreadable chain answer refuses rather than guesses, and
 * the same check runs again, at the selected coordinate, before any restore or
 * import writes the account.
 */

import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { accountClassEntry, BRAAVOS_BASE_CLASS_HASH } from "@bramble/wallet-model/account-families";
import {
  isRecoverableAccountRef,
  type RecoverableAccountRef,
} from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
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
import { networkRpcUrls } from "../runtime/runtime-state";

type AddressImportDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly wallet: WalletStatusReader;
};

type Refusal = { readonly error: string };

type OwnerFound = {
  readonly classHash: string;
  readonly family: "argent" | "braavos";
  readonly ownerPublicKey: string;
};

// The ladders a family's keys walk: Argent on this wallet's own and on Ready's
// ETH-seeded tree (issue 505), Braavos on its BIP-44 address axis (the vault
// maps the family there).
const LADDERS: Record<"argent" | "braavos", readonly (RecoveryDerivationKind | undefined)[]> = {
  argent: ["starknet-bip44", "argentx-bip44"],
  braavos: [undefined],
};

// The class an account record keeps is the one its address was deployed with,
// which the chain does not say. Every Argent release in the table is a
// deployment class, so the live one stands in; a Braavos account runs an
// implementation class it was never deployed at, so its record keeps the base
// class Braavos deploys from. The account is already deployed, so the record's
// class and salt are never used to deploy it, and deployment refuses any
// record whose fields do not reproduce its address.
const recordClassHash = (found: OwnerFound): string => {
  const entry = accountClassEntry(found.classHash);
  return entry?.roles.includes("deployment") && entry.family === found.family
    ? (canonicalFelt(found.classHash) ?? found.classHash)
    : BRAAVOS_BASE_CLASS_HASH;
};

const readOwner = async (
  deps: AddressImportDeps,
  address: string,
  rpcUrls: readonly string[],
): Promise<OwnerFound | Refusal> => {
  const read = deps.runtimeRpc.getAccountOwner;
  if (!read) return { error: ADDRESS_IMPORT_REFUSALS.unavailable };
  try {
    const reading = await read({ accountAddress: address, rpcUrls });
    if (reading.kind === "not-deployed") return { error: ADDRESS_IMPORT_REFUSALS.notDeployed };
    if (reading.kind === "unsupported-class") {
      return { error: ADDRESS_IMPORT_REFUSALS.unsupportedClass };
    }
    if (reading.kind === "non-stark-owner") return { error: ADDRESS_IMPORT_REFUSALS.nonStarkOwner };
    return {
      classHash: reading.classHash,
      family: reading.family,
      ownerPublicKey: reading.ownerPublicKey,
    };
  } catch {
    return { error: ADDRESS_IMPORT_REFUSALS.unavailable };
  }
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
): Promise<RecoverableAccountRef | Refusal | null> => {
  for (const derivation of LADDERS[found.family]) {
    const preview = await previewAt(deps, input, {
      accountContractType: found.family,
      accountIndex,
      classHash: recordClassHash(found),
      ...(derivation === undefined ? {} : { derivation }),
    });
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
      index === RESERVED_AGENT_ACCOUNT_INDEX ? null : await matchAtIndex(deps, input, found, index);
    if (match !== null) return match;
  }
  return null;
};

const advisoryRestriction = async (
  deps: AddressImportDeps,
  account: RecoverableAccountRef,
  rpcUrls: readonly string[],
): Promise<RecoveryAccountCandidate["restriction"] | null> => {
  const probe =
    account.accountContractType === "argent"
      ? deps.runtimeRpc.getArgentSigningRestriction
      : deps.runtimeRpc.getBraavosSigningRestriction;
  return (
    (await probe?.({ accountAddress: account.address, publicKeyX: account.publicKeyX, rpcUrls })
      // Advisory, as in the recovery scan: no verdict lists the row unlabelled,
      // and every transaction path re-checks the live signer before signing.
      .catch(() => null)) ?? null
  );
};

const canonicalAddress = (value: string): string | null => {
  const address = canonicalFelt(value);
  return address !== null && isNonZeroStarkFieldElement(address) ? address : null;
};

const rpcUrlsFor = async (deps: AddressImportDeps, networkId: StarknetNetworkId) =>
  networkRpcUrls(STARKNET_NETWORKS[networkId], await deps.preferencesStore.read());

/**
 * Finds which key of `mnemonic` controls the account at `address`, and returns
 * it as a recovery candidate that keeps the address. Refuses with one of
 * {@link ADDRESS_IMPORT_REFUSALS} otherwise. `stillAuthorized` is re-checked
 * between indices when the phrase came from the unlocked vault.
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
  const rpcUrls = await rpcUrlsFor(deps, input.networkId);
  const found = await readOwner(deps, address, rpcUrls);
  if ("error" in found) return found;
  const matched = await findOwnerKey(deps, input, found, stillAuthorized);
  if (matched === null) return { error: ADDRESS_IMPORT_REFUSALS.noMatch };
  if ("error" in matched) return matched;
  const account = { ...matched, address, id: `${matched.networkId}:${address}` };
  const restriction = await advisoryRestriction(deps, account, rpcUrls);
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
  if (byAddress.length === 0) return null;
  const rpcUrls = await rpcUrlsFor(deps, input.networkId);
  for (const selection of byAddress) {
    const found = await readOwner(deps, selection.address as string, rpcUrls);
    if ("error" in found) return found;
    if (found.family !== selection.accountContractType) {
      return { error: ADDRESS_IMPORT_REFUSALS.noMatch };
    }
    const preview = await previewAt(deps, input, selection);
    if (!preview) return { error: "account discovery is unavailable" };
    if (!sameFelt(preview.publicKeyX, found.ownerPublicKey)) {
      return { error: ADDRESS_IMPORT_REFUSALS.noMatch };
    }
  }
  return null;
};
