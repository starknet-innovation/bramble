/**
 * Applying a user-approved dapp chain switch. Split from chain-ops.ts, which
 * queues the switch card, to keep both files within the size budget.
 */

import type { Vault } from "@bramble/vault/schema";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { ApprovalQueue } from "../approvals/approvals";
import { promptReconnectForStaleGrant } from "../approvals/reconnect-prompt";
import { grantedDappAccounts } from "../provider/dapp-account";
import { runActiveStateMutation, switchActiveNetwork } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type UnlockSession } from "../runtime/session";
import type { ChainOpsDeps } from "./chain-ops";

// The id of a vault account on `networkId` that `origin`'s stored grant
// covers, or undefined when the grant holds none there.
const heldAccountOn = (
  vault: Pick<Vault, "accounts" | "originGrants">,
  origin: string,
  networkId: StarknetNetworkId,
): string | undefined => {
  const grantIds = vault.originGrants.find((grant) => grant.origin === origin)?.accountIds ?? [];
  return vault.accounts.find(
    (account) => account.networkId === networkId && grantIds.includes(account.id),
  )?.id;
};

// A partial approval stub omits the preferences store. Production always has
// one, so a multisig grant is visible; the stub still rechecks the vault grant.
const grantedForSwitch = (
  deps: Pick<ChainOpsDeps, "multisigGrants" | "multisigStore" | "preferencesStore" | "wallet">,
  origin: string,
  passphrase: string,
) =>
  deps.preferencesStore
    ? grantedDappAccounts(deps, origin, passphrase)
    : deps.wallet.getGrantedAccounts(origin, passphrase);

// Queues the reconnect prompt only when the account the switch landed on is
// really outside the origin's grant, never for a dapp still connected after it.
const promptWhenLandedOutsideGrant = async (
  deps: Pick<ChainOpsDeps, "multisigGrants" | "multisigStore" | "preferencesStore" | "wallet"> & {
    readonly approvals?: Pick<ApprovalQueue, "request">;
  },
  origin: string,
  passphrase: string,
  connected: readonly unknown[],
): Promise<void> => {
  if (!deps.approvals) {
    return;
  }
  const landed = await grantedForSwitch(deps, origin, passphrase);
  if (landed.length === 0) {
    promptReconnectForStaleGrant(deps.approvals, connected, origin);
  }
};

/**
 * Applies a user-approved chain switch: sets the active network and returns the
 * new chain id for the dapp. Refuses with `origin not connected` when the origin
 * is not connected at approval time, so an approved card can never reconnect a
 * disconnected site. The switch never grants an account: the card names none,
 * so the origin keeps exactly the accounts it was granted. When it holds one on
 * the target network the switch lands there; when it holds none, the standard
 * reconnect (connect) prompt is queued instead, which names the account to share.
 */
export const executeSwitchChainApproval = async (
  deps: Pick<
    ChainOpsDeps,
    "activeStateCoordinator" | "multisigGrants" | "multisigStore" | "preferencesStore" | "wallet"
  > & {
    /** Queue for the reconnect prompt; unset (partial test stubs) queues nothing. */
    readonly approvals?: Pick<ApprovalQueue, "request">;
    /**
     * The full session: applying the approval switches the active network, and
     * that cross-store mutation locks its own generation when it cannot be
     * completed. The grant re-check below still only observes the session.
     */
    readonly session: UnlockSession;
  },
  input: { readonly networkId: StarknetNetworkId; readonly origin: string },
): Promise<RuntimeResponse> => {
  const { preferencesStore, session, wallet } = deps;
  return runActiveStateMutation(deps.activeStateCoordinator, async () => {
    const passphrase = session.peekPassphrase();
    const authorized = captureSessionAuthorization(session);
    if (!passphrase || !authorized.isCurrent()) {
      return { error: "wallet locked" };
    }
    // A switch-chain approval carries no account context, so the shared claim
    // validator skips it and this is the only place the grant is re-checked.
    // Read it BEFORE switching: a revoked or disconnected origin is refused
    // rather than having the approved card switch the network on its behalf.
    const connected = await grantedForSwitch(deps, input.origin, passphrase);
    if (connected.length === 0) {
      return { error: "origin not connected" };
    }
    // `connected` is at most the active account (the page-visible view), so the
    // account the origin holds on the target network comes from its stored
    // grant, which keeps every account the user ever approved for it.
    const held = heldAccountOn(await wallet.readVault(passphrase), input.origin, input.networkId);
    if (!authorized.isCurrent()) {
      return { error: "wallet locked" };
    }
    await switchActiveNetwork(
      wallet,
      session,
      preferencesStore,
      input.networkId,
      undefined,
      held ? { preferredAccountId: held } : {},
    );
    if (!authorized.isCurrent()) {
      return { error: "wallet locked" };
    }
    // Exposure only narrows (audit 124): an account the user never connected
    // is not shared because they approved a network change.
    await promptWhenLandedOutsideGrant(deps, input.origin, passphrase, connected);
    return { chainId: STARKNET_NETWORKS[input.networkId].chainId, ok: true };
  });
};
