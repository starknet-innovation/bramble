/**
 * Privileged paired-phone messages: the side panel reads what the background has
 * parked, drives the transport, and calls back with the device's answer. Mirrors
 * the Ledger pair, and fails closed the same way — an unknown queue id, an
 * absent queue, or a malformed payload settles nothing.
 */

import type { WalletOpsDeps } from "../accounts/wallet-ops";
import { readTypeOnlyInput } from "../routing/message-inputs";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { readCompleteMobilePqSignInput } from "./mobile-pq-inputs";

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

const MOBILE_PQ_OPS_HANDLERS: Readonly<Record<string, MobilePqOpsHandler>> = {
  "wallet.completeMobilePqSign": handleCompleteMobilePqSign,
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
