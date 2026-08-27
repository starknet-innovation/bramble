/**
 * Panel-side message wrappers for the privileged paired-phone operations. Each
 * method sends a typed request over the injected send function and parses the
 * reply through its `isX` guard, failing closed on an unrecognised shape. No
 * secret material crosses: a phone request carries a queue id, a hash, a device
 * id, and a public ML-DSA-65 key.
 */

import {
  isErrorResponse,
  isMobilePqSignPendingResponse,
  isOkResponse,
  type MobilePqSignRequestSummary,
} from "../../../popup/responses/responses";
import type { MobilePqSignOutcome } from "./sign-session";

/**
 * The paired-phone slice of the side-panel wallet client.
 */
export type MobilePqRuntimeClient = {
  readonly completeMobilePqSign: (outcome: MobilePqSignOutcome) => Promise<void>;
  readonly loadMobilePqSignPending: () => Promise<readonly MobilePqSignRequestSummary[]>;
};

const failure = (response: unknown, fallback: string): Error =>
  new Error(isErrorResponse(response) ? response.error : fallback);

/**
 * Builds the paired-phone wrappers over a runtime send function. Spread into the
 * main side-panel runtime client so callers see one flat wallet surface.
 */
export const createMobilePqRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
): MobilePqRuntimeClient => ({
  async completeMobilePqSign(outcome) {
    const response = await sendMessage({ ...outcome, type: "wallet.completeMobilePqSign" });
    if (isOkResponse(response)) {
      return;
    }
    // The reason matters here: the controller shows it to the user, and the
    // background distinguishes a stale id from a signature that did not verify.
    throw failure(response, "complete phone sign failed");
  },
  async loadMobilePqSignPending() {
    const response = await sendMessage({ type: "wallet.mobilePqSignPending" });
    return isMobilePqSignPendingResponse(response) ? response.pending : [];
  },
});
