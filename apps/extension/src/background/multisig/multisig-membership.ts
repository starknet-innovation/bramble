/**
 * Fresh Argent signer-GUID authorization shared by scoped read features.
 */
import type { ArgentMultisigRecord, MultisigStore } from "@bramble/multisig/repository";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";

type MembershipDeps = {
  readonly multisigStore?: MultisigStore;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
};

/**
 * Watched multisigs the supplied wallet key currently signs for, plus whether
 * any watched multisig on the network could not be read.
 */
export type ArgentSignerRecords = {
  readonly records: readonly ArgentMultisigRecord[];
  readonly unreadable: boolean;
};

/**
 * Returns watched accounts for which the supplied wallet key is a current
 * signer. Class validation and signer GUID membership are fresh chain reads.
 * Each multisig is read on its own: one that cannot be read (not deployed yet,
 * an unexpected class, every endpoint failing) is left out, so its scope fails
 * closed rather than being granted from stale state, and `unreadable` says so.
 * It no longer fails the whole call, which hid the account's own allowances
 * behind one undeployed multisig (Sherlock 190). A failure to read the
 * preferences or the multisig store still throws.
 */
export const currentArgentSignerRecords = async (
  deps: MembershipDeps,
  account: AccountRef,
  networkId: StarknetNetworkId,
): Promise<ArgentSignerRecords> => {
  const rpc = deps.runtimeRpc.multisig;
  if (!rpc || !deps.multisigStore) {
    return { records: [], unreadable: false };
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[networkId], preferences);
  const guid = argentSignerGuid(account.publicKeyX);
  const records = (await deps.multisigStore.listMultisigs()).filter(
    (record) => record.networkId === networkId && record.id !== account.id,
  );
  const authorized = await Promise.all(
    records.map(async (record) => {
      try {
        const config = await rpc.getConfig({ address: record.address, rpcUrls });
        return { member: config.signerGuids.includes(guid), read: true, record };
      } catch {
        return { member: false, read: false, record };
      }
    }),
  );
  return {
    records: authorized.filter((entry) => entry.member).map((entry) => entry.record),
    unreadable: authorized.some((entry) => !entry.read),
  };
};
