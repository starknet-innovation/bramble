/**
 * Neutral dependency seam shared by Argent multisig background modules.
 */
import type { NostrCoordinationStore } from "@mc-wallet/multisig/coordination";
import type { MultisigStore } from "@mc-wallet/multisig/repository";
import type { WalletOpsDeps } from "../accounts/wallet-ops";
import type { ArgentMultisigDeploymentReviews } from "./multisig-deployment-reviews";
import type { NostrRelayTransport } from "./nostr-relay";

/**
 * Dependencies for all Argent multisig background operations.
 */
export type MultisigOpsDeps = WalletOpsDeps & {
  readonly multisigDeploymentReviews: ArgentMultisigDeploymentReviews;
  readonly multisigStore: MultisigStore;
  readonly nostrCoordinationStore: NostrCoordinationStore;
  /** Injectable encrypted-event transport; production reuses short-lived native WebSockets. */
  readonly nostrRelayTransport?: NostrRelayTransport;
  readonly now: () => number;
};

/**
 * Requires the complete production Argent RPC surface.
 */
export const multisigRpc = (deps: MultisigOpsDeps) => {
  const rpc = deps.runtimeRpc.multisig;
  if (!rpc) throw new Error("Argent multisig operations unavailable");
  return rpc;
};
