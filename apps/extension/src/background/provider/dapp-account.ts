/**
 * Which account a site is talking to. A selected multisig on the active
 * network replaces the vault's active account for grants, requests, and
 * events. With no selection, the existing single-signer grant is unchanged.
 */

import type { ArgentMultisigRecord, MultisigStore } from "@bramble/multisig/repository";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { DappMultisigAccount } from "@bramble/wallet-protocol/results";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { MultisigOriginGrantStore } from "./multisig-grants";

/**
 * An account a site may be shown: a vault account, or a multisig projection.
 */
export type GrantedDappAccount = AccountRef | DappMultisigAccount;

/** True when the granted account is a multisig projection, not a vault account. */
export const isGrantedMultisig = (account: GrantedDappAccount): account is DappMultisigAccount =>
  account.accountContractType === "argent-multisig";

/**
 * Projects a watched multisig to the public fields a site is allowed to see.
 */
export const toDappMultisigAccount = (record: ArgentMultisigRecord): DappMultisigAccount => ({
  accountContractType: "argent-multisig",
  address: record.address,
  classHash: record.classHash,
  id: record.id,
  networkId: record.networkId,
});

/** Collaborators for resolving which account a site may see. */
export type GrantDeps = {
  readonly multisigGrants?: MultisigOriginGrantStore;
  readonly multisigStore?: Pick<MultisigStore, "listMultisigs">;
  readonly preferencesStore: Pick<WalletPreferencesStore, "read">;
  readonly wallet: Pick<WalletStatusReader, "getGrantedAccounts">;
};

/**
 * Accounts the origin may see right now. One account, matching the single-signer
 * rule: the selected multisig when one is presented and granted, otherwise the
 * vault's active account when that grant covers it.
 */
export const grantedDappAccounts = async (
  deps: GrantDeps,
  origin: string,
  credential: string,
): Promise<readonly GrantedDappAccount[]> => {
  const preferences = await deps.preferencesStore.read();
  const records = (await deps.multisigStore?.listMultisigs().catch(() => [])) ?? [];
  const selectedId = preferences.selectedMultisigId;
  if (selectedId?.startsWith(`${preferences.activeNetworkId}:`)) {
    const selected = records.find((record) => record.id === selectedId);
    if (!selected || !deps.multisigGrants) return [];
    const granted = await deps.multisigGrants.idsFor(origin, credential);
    return granted.includes(selected.id) ? [toDappMultisigAccount(selected)] : [];
  }
  return deps.wallet.getGrantedAccounts(origin, credential);
};

/**
 * A vault account on this network whose key is one of the multisig's signers.
 */
export const multisigMemberAccount = (
  accounts: readonly AccountRef[],
  signerPublicKeys: readonly string[],
  networkId: StarknetNetworkId,
): AccountRef | null => {
  const guids = new Set(signerPublicKeys.map((key) => argentSignerGuid(key)));
  return (
    accounts.find(
      (account) =>
        account.networkId === networkId && guids.has(argentSignerGuid(account.publicKeyX)),
    ) ?? null
  );
};

/**
 * Loads the watched record for an approval pinned to a multisig id.
 */
export const multisigRecordById = async (
  store: Pick<MultisigStore, "listMultisigs">,
  accountId: string | undefined,
): Promise<ArgentMultisigRecord | null> => {
  if (!accountId) return null;
  const records = await store.listMultisigs().catch(() => []);
  return records.find((record) => record.id === accountId) ?? null;
};
