/** Active-network resolution for one watched Argent multisig account. */
import type { ArgentMultisigRecord } from "@mc-wallet/multisig/repository";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import { type ActiveAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import type { MultisigOpsDeps } from "./multisig-deps";

/**
 * Resolved watched account and active-network RPC scope. Construction fails on
 * locked, missing, or cross-network state and exposes no signer secret.
 */
export type ArgentMultisigContext = {
  readonly active: ActiveAccountContext & { readonly error?: never };
  readonly record: ArgentMultisigRecord;
  readonly rpcUrls: readonly string[];
};

/**
 * Resolves one stored multisig on the active network. Missing records, locked
 * state, and network mismatches fail without returning an executable context.
 */
export const contextFor = async (
  deps: MultisigOpsDeps,
  active: ActiveAccountContext,
  multisigId: string,
): Promise<ArgentMultisigContext | { readonly error: string }> => {
  if (active.error !== undefined) return { error: active.error };
  const record = (await deps.multisigStore.listMultisigs()).find(
    (candidate) => candidate.id === multisigId,
  );
  if (!record) return { error: "Argent multisig not found" };
  if (record.networkId !== active.networkId) {
    return { error: "switch to the multisig network first" };
  }
  const preferences = await deps.preferencesStore.read();
  return {
    active,
    record,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences),
  };
};
