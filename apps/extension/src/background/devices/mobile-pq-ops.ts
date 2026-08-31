/**
 * Privileged paired-phone messages: the side panel reads what the background has
 * parked, drives the transport, and calls back with the device's answer. Mirrors
 * the Ledger pair, and fails closed the same way — an unknown queue id, an
 * absent queue, or a malformed payload settles nothing.
 */

import { verifyMlDsa65Signature } from "@mc-wallet/starknet/ml-dsa-core";
import type { WalletOpsDeps } from "../accounts/wallet-ops";
import { readTypeOnlyInput } from "../routing/message-inputs";
import { runUnlockedNetworkMutation } from "../runtime/active-network-mutation";
import { runActiveStateMutation } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { readAddMobilePqAccountInput, readCompleteMobilePqSignInput } from "./mobile-pq-inputs";

type MobilePqOpsHandler = (deps: WalletOpsDeps, message: unknown) => Promise<RuntimeResponse>;

const handleMobilePqSignPending: MobilePqOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.mobilePqSignPending")) {
    return { error: "invalid mobile sign pending request" };
  }
  // Each entry carries the account's 1952-byte enrolled public key, so the panel
  // can reject a re-installed or wrong device before the biometric prompt. It is
  // public material and the response is panel-only.
  return { ok: true, pending: deps.mobilePqSignQueue?.pending() ?? [] };
};

const handleCompleteMobilePqSign: MobilePqOpsHandler = async (deps, message) => {
  const input = readCompleteMobilePqSignInput(message);
  if (!input) {
    return { error: "invalid complete mobile sign request" };
  }
  const queue = deps.mobilePqSignQueue;
  if (!queue) {
    return { error: "mobile signing unavailable" };
  }
  const settled =
    "error" in input
      ? queue.reject(input.id, input.error)
      : queue.settle(input.id, { signature: input.signature });
  return settled ? { ok: true } : { error: "no pending mobile sign for id" };
};

const handleMobilePqEnrollChallenge: MobilePqOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.mobilePqEnrollChallenge")) {
    return { error: "invalid enrollment challenge request" };
  }
  const enrollment = deps.mobilePqEnrollment;
  if (!enrollment) {
    return { error: "mobile enrollment unavailable" };
  }
  // Public material: 32 random bytes the device signs to prove it holds the key
  // it is about to be enrolled with.
  return { challenge: enrollment.issue(), ok: true };
};

const handleAddMobilePqAccount: MobilePqOpsHandler = async (deps, message) => {
  const input = readAddMobilePqAccountInput(message);
  if (!input) {
    return { error: "invalid add mobile account request" };
  }
  const enrollment = deps.mobilePqEnrollment;
  if (!enrollment) {
    return { error: "mobile enrollment unavailable" };
  }
  // Single-use: consume before verifying, so a failed attempt cannot be retried
  // against the same challenge with a different key.
  if (!enrollment.consume(input.challenge)) {
    return { error: "enrollment challenge expired" };
  }
  // The gate that stops a stranded account. Without it the wallet would derive
  // an address from a key the device cannot sign for, and anything the user
  // funded there would be unrecoverable.
  if (
    !verifyMlDsa65Signature({
      hash: input.challenge,
      publicKey: input.publicKey,
      signature: input.signature,
    })
  ) {
    return { error: "device did not prove it holds this key" };
  }
  const store = deps.wallet.addMobilePqAccount;
  if (!store) {
    return { error: "mobile enrollment unavailable" };
  }
  // Serialized behind the active-state coordinator and the unlock session, the
  // same way a Ledger account is stored: the vault write needs a live passphrase
  // and must not race another account mutation.
  return runActiveStateMutation(deps.activeStateCoordinator, async () => {
    const account = await runUnlockedNetworkMutation(
      deps.session,
      deps.preferencesStore,
      input.networkId,
      (vaultPassphrase) =>
        store({
          classHash: input.classHash,
          deviceId: input.deviceId,
          networkId: input.networkId,
          publicKey: input.publicKey,
          vaultPassphrase,
        }),
    );
    return account ? { account, ok: true } : { error: "wallet locked" };
  });
};

const MOBILE_PQ_OPS_HANDLERS: Readonly<Record<string, MobilePqOpsHandler>> = {
  "wallet.addMobilePqAccount": handleAddMobilePqAccount,
  "wallet.completeMobilePqSign": handleCompleteMobilePqSign,
  "wallet.mobilePqEnrollChallenge": handleMobilePqEnrollChallenge,
  "wallet.mobilePqSignPending": handleMobilePqSignPending,
};

/**
 * Handles the privileged paired-phone messages; returns null for other types.
 */
export const handleMobilePqOps = async (
  deps: WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(MOBILE_PQ_OPS_HANDLERS, messageType)
    ? MOBILE_PQ_OPS_HANDLERS[messageType]
    : undefined;
  return handler ? handler(deps, message) : null;
};
