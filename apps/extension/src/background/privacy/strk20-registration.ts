/**
 * Wallet-API 0.10.5 register action: the shared "already registered" refusal
 * and the post-approval builder for `wallet_strk20PrepareInvoke` register
 * requests. Registration status is read straight from the pool (public chain
 * state, via `subject`), so the pre-approval check never derives the viewing
 * key.
 */
import { readStrk20RegistrationStatus, STRK20_SERVICE_UNAVAILABLE } from "@bramble/privacy/service";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
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

type Strk20RegistrationContext = Omit<
  Parameters<typeof readStrk20RegistrationStatus>[1],
  "subject" | "token"
>;

/**
 * Reads whether the resolved account is registered in the configured pool,
 * using the pool's public registry (`subject`) rather than SDK discovery.
 * Throws the service's mapped error when the pool cannot be read.
 */
export const isStrk20AccountRegistered = async (
  runtimeRpc: RuntimeRpc,
  context: Strk20RegistrationContext,
): Promise<boolean> =>
  (await readStrk20RegistrationStatus(strk20ServiceForRuntime(runtimeRpc), {
    ...context,
    subject: context.account.address,
    // The registry read keyed by `subject` does not consult a token; the
    // field is required by the shared input type only.
    token: STRK_TOKEN_ADDRESS,
  })) === "registered";

/**
 * After user approval, re-checks that the account, pool, and registration
 * state still match the reviewed request and that the account is deployed (a
 * registration proof needs the account class at the proving block, so an
 * undeployed account is refused instead of stalling in the maturity wait),
 * then builds the registration call
 * and proof (empty when simulating) for the site to submit. Nothing is signed
 * or broadcast; the pool-fee approve is left to the submitter. A service
 * without registration-call support fails closed.
 */
export const executeApprovedStrk20RegistrationCall = async (
  runtimeRpc: RuntimeRpc,
  resolved: {
    readonly account: AccountRef;
    readonly preferences: Awaited<ReturnType<WalletPreferencesStore["read"]>>;
  },
  context: Strk20RegistrationContext,
  request: Extract<Strk20DisclosureRequest, { readonly type: "prepare-register" }>,
): Promise<RuntimeResponse> => {
  if (
    resolved.account.derivation.kind === "ledger" ||
    !context.config ||
    !sameFelt(context.config.poolAddress, request.poolAddress)
  ) {
    return { error: "approval context changed" };
  }
  if (await isStrk20AccountRegistered(runtimeRpc, context)) {
    return { error: STRK20_ALREADY_REGISTERED };
  }
  if (
    !(await runtimeRpc.getDeploymentStatus({
      accountAddress: resolved.account.address,
      rpcUrls: context.rpcUrls,
    }))
  ) {
    return { error: "Deploy this account before activating private balances" };
  }
  const service = strk20ServiceForRuntime(runtimeRpc);
  if (!service.prepareRegistrationCall) {
    return { error: STRK20_SERVICE_UNAVAILABLE };
  }
  const callAndProof = await service.prepareRegistrationCall({
    ...context,
    simulate: request.simulate,
  });
  return { callAndProof, ok: true };
};
