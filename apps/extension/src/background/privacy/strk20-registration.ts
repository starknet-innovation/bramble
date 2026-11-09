/**
 * Wallet-API 0.10.5 register action: the shared "already registered" refusal
 * and the post-approval builder for `wallet_strk20PrepareInvoke` register
 * requests. Registration status is read straight from the pool (public chain
 * state), so the pre-approval check never derives the viewing key.
 */
import {
  prepareStrk20RegistrationCall,
  readStrk20RegistrationStatus,
} from "@mc-wallet/privacy/service";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { strk20ServiceForRuntime } from "./strk20-account-context";
import type { Strk20DisclosureRequest } from "./strk20-approval-types";

/**
 * Refusal for a register action on an already registered account. The leading
 * "invalid" maps it to INVALID_REQUEST_PAYLOAD (114) on the dapp wire, as the
 * Wallet API requires.
 */
export const STRK20_ALREADY_REGISTERED =
  "invalid strk20 registration request: account already registered";

type Strk20RegistrationContext = Parameters<typeof readStrk20RegistrationStatus>[1];

/**
 * Reads whether the resolved account is registered in the configured pool,
 * using the pool's public registry (`subject`) rather than SDK discovery.
 * Throws the service's mapped error when the pool cannot be read.
 */
export const isStrk20AccountRegistered = async (
  runtimeRpc: RuntimeRpc,
  context: Omit<Strk20RegistrationContext, "subject" | "token">,
  token: string,
): Promise<boolean> =>
  (await readStrk20RegistrationStatus(strk20ServiceForRuntime(runtimeRpc), {
    ...context,
    subject: context.account.address,
    token,
  })) === "registered";

/**
 * After user approval, re-checks that the account, pool, and registration
 * state still match the reviewed request, then builds the registration call
 * and proof (empty when simulating) for the site to submit. Nothing is signed
 * or broadcast; the pool-fee approve is left to the submitter.
 */
export const executeApprovedStrk20RegistrationCall = async (
  runtimeRpc: RuntimeRpc,
  resolved: {
    readonly account: AccountRef;
    readonly preferences: Awaited<ReturnType<WalletPreferencesStore["read"]>>;
  },
  context: Omit<Strk20RegistrationContext, "subject" | "token">,
  request: Extract<Strk20DisclosureRequest, { readonly type: "prepare-register" }>,
): Promise<RuntimeResponse> => {
  const token = resolved.preferences.tokens.find(
    (candidate) => candidate.networkId === resolved.account.networkId,
  );
  if (
    resolved.account.derivation.kind === "ledger" ||
    !context.config ||
    !sameFelt(context.config.poolAddress, request.poolAddress) ||
    !token
  ) {
    return { error: "approval context changed" };
  }
  if (await isStrk20AccountRegistered(runtimeRpc, context, token.address)) {
    return { error: STRK20_ALREADY_REGISTERED };
  }
  const callAndProof = await prepareStrk20RegistrationCall(strk20ServiceForRuntime(runtimeRpc), {
    ...context,
    simulate: request.simulate,
  });
  return { callAndProof, ok: true };
};
