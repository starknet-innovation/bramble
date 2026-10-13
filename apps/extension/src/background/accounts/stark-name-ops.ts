/**
 * Starknet name lookup: the panel-only `wallet.resolveStarkName` message.
 *
 * The read uses the non-renewing session, like the other side-panel reads, and
 * runs on the network the panel says it is showing. A request naming another
 * network fails closed, and the answer carries the network it was read on, so
 * an address resolved on one chain is never committed as a recipient on
 * another. The resolver's outcome is returned as is; it carries no secret.
 */

import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { readStarkNameInput } from "../routing/message-inputs";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls, observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { PassiveUnlockSession } from "../runtime/session";
import type { WalletStatusReader } from "./wallet-reader";

/**
 * Dependencies of the name-lookup handler: the same wallet, session and
 * preferences collaborators the other account reads use, plus the resolver.
 */
export type StarkNameOpsDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: Pick<RuntimeRpc, "resolveStarkName">;
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Resolves a typed Starknet name on the active network. Refuses a malformed
 * request, a runtime without a resolver, and a request for a network the
 * wallet is no longer on; never throws for those.
 */
export const handleResolveStarkName = async (
  deps: StarkNameOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readStarkNameInput(message);
  if (!input) {
    return { error: "invalid stark name request" };
  }
  if (!deps.runtimeRpc.resolveStarkName) {
    return { error: "name resolution unavailable" };
  }
  const context = await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  // The panel names the network it is showing. The read must happen on that
  // same network, or an address resolved elsewhere could be committed as if it
  // belonged here, so a mismatch fails closed instead of resolving anyway.
  if (input.networkId !== context.networkId) {
    return { error: "name resolution network changed" };
  }
  const resolution = await deps.runtimeRpc.resolveStarkName({
    name: input.name,
    rpcUrls: networkRpcUrls(
      STARKNET_NETWORKS[context.networkId],
      await deps.preferencesStore.read(),
    ),
  });
  // The answer carries the network its address belongs to, so the panel can
  // drop a resolution whose network changed while the read was in flight.
  return { networkId: context.networkId, ok: true, resolution };
};
