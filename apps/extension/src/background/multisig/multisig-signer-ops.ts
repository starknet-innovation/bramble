/** Privileged participant-account signer discovery. */
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { activeAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-deps";
import { readResolveMultisigSignerInput } from "./multisig-inputs";

const resolveSigner = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const input = readResolveMultisigSignerInput(message);
  if (!input) return { error: "invalid multisig signer account request" };
  const authorized = captureSessionAuthorization(deps.session);
  const active = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (active.error !== undefined || !authorized.isCurrent()) {
    return { error: active.error ?? "wallet locked" };
  }
  if (active.networkId !== input.networkId) {
    return { error: "switch to the participant account network first" };
  }
  const resolveSignerAccount = multisigRpc(deps).resolveSignerAccount;
  if (!resolveSignerAccount) return { error: "signer account lookup unavailable" };
  const preferences = await deps.preferencesStore.read();
  const signer = await resolveSignerAccount({
    address: input.address,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[input.networkId], preferences),
  });
  return authorized.isCurrent() ? { ok: true, signer } : { error: "wallet locked" };
};

/**
 * Handles the wallet-only signer lookup; invalid, locked, cross-network, and
 * unsupported requests return errors without exposing any secret material.
 */
export const handleMultisigSignerOps = (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse> | null =>
  messageType === "wallet.resolveMultisigSigner" ? resolveSigner(deps, message) : null;
