/**
 * Side-panel client for the background's read-only lookups: the active
 * account's deployment status and signability, its class-hash verification,
 * and a typed Starknet name's resolution. Split from the main runtime by the
 * file-size budget. Each returns `null` on a malformed reply, so a caller shows
 * a plain absence rather than reading a half-formed envelope.
 */
import {
  type AccountSignabilityResponse,
  type ClassHashVerificationResponse,
  type DeploymentStatusResponse,
  isAccountSignabilityResponse,
  isClassHashVerificationResponse,
  isDeploymentStatusResponse,
  isStarkNameResolutionResponse,
  type StarkNameResolutionResponse,
} from "../../popup/responses/responses";

/** Creates the lookup client over chrome.runtime messaging. */
export const createLookupRuntimeClient = (sendMessage: (message: unknown) => Promise<unknown>) => ({
  async loadDeploymentStatus(): Promise<DeploymentStatusResponse | null> {
    const response = await sendMessage({ type: "wallet.deploymentStatus" });
    return isDeploymentStatusResponse(response) ? response : null;
  },
  /** Active-account signability for the Home read-only flag; null on a malformed reply. */
  async loadAccountSignability(): Promise<AccountSignabilityResponse | null> {
    const response = await sendMessage({ type: "wallet.accountSignability" });
    return isAccountSignabilityResponse(response) ? response : null;
  },
  async loadClassHashVerification(): Promise<ClassHashVerificationResponse | null> {
    // Return the whole response (with its `accountId`), not just the verdict,
    // so the caller can drop a verification that resolved for an account the
    // user has since switched away from — a stale/foreign verdict must never
    // be shown under a different account's class hash.
    const response = await sendMessage({ type: "wallet.verifyClassHash" });
    return isClassHashVerificationResponse(response) ? response : null;
  },
  async resolveStarkName(
    name: string,
    networkId: string,
  ): Promise<StarkNameResolutionResponse | null> {
    // Returns null for any reply that is not a well-formed resolution, so the
    // caller shows a plain failure rather than reading a malformed envelope.
    // The panel sends the network it is showing; the answer names the network
    // it was read on, so a read that crossed a network switch is dropped.
    const response = await sendMessage({ name, networkId, type: "wallet.resolveStarkName" });
    return isStarkNameResolutionResponse(response) ? response : null;
  },
});
