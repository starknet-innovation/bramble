/**
 * Fresh Argent signer-GUID authorization shared by scoped read features.
 */
import type { MultisigStore } from "@bramble/multisig/repository";
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
 * Returns watched accounts for which the supplied wallet key is a current
 * signer. Class validation and signer GUID membership are fresh chain reads;
 * missing RPC wiring or a read failure throws and therefore fails the caller
 * closed rather than granting a stale shared-account scope.
 */
export const currentArgentSignerRecords = async (
  deps: MembershipDeps,
  account: AccountRef,
  networkId: StarknetNetworkId,
) => {
  const rpc = deps.runtimeRpc.multisig;
  if (!rpc || !deps.multisigStore) {
    return [];
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[networkId], preferences);
  const guid = argentSignerGuid(account.publicKeyX);
  const records = (await deps.multisigStore.listMultisigs()).filter(
    (record) => record.networkId === networkId && record.id !== account.id,
  );
  const authorized = await Promise.all(
    records.map(async (record) => ({
      member: (await rpc.getConfig({ address: record.address, rpcUrls })).signerGuids.includes(
        guid,
      ),
      record,
    })),
  );
  return authorized.filter((entry) => entry.member).map((entry) => entry.record);
};
