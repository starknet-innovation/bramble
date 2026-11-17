/**
 * The relayed halves the official-SDK service shares between its relay routes:
 * the account's SNIP-9 typed-data signer, and the sponsored first shield
 * (#789), which relays a deposit batch prepared and reviewed on the public
 * route. Split from ./official-sdk-service to keep that adapter's routes on
 * one screen each.
 */

import { WalletError } from "@bramble/core/errors";
import { isJson } from "@bramble/core/json";
import { serializeAccountSignature } from "@bramble/starknet/account-contracts";
import { requireLiveAuthorizableClass } from "@bramble/starknet/deployment";
import { withRpcFallback } from "@bramble/starknet/provider";
import type { PaymasterHttp } from "@bramble/transactions/paymaster-http";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { RpcProvider, TypedData } from "starknet";
import { typedData } from "starknet";
import {
  type Strk20SponsoredShieldSubmissionInput,
  submitSponsoredShield,
} from "../paymaster/sponsored-shield";
import type { Strk20MaturityScope, Strk20SubmissionRoute } from "../policy/maturity";
import { reportStrk20Phase } from "../policy/phases";
import { relayClaimSlots } from "../policy/relay-claim-slots";
import {
  STRK20_PRIVACY_LEAK,
  STRK20_SUBMISSION_UNAVAILABLE,
  type Strk20AccountContext,
} from "../service";
import type { Strk20MaturityRuntime } from "./official-sdk-maturity";
import { requireStrk20Config } from "./official-sdk-values";

/**
 * Signs relay typed data as the active account. Refuses anything that is not
 * plain JSON, and (outside OpenZeppelin, whose class has no upgrade path the
 * wallet tracks) re-reads the account's live class first, so an account
 * upgraded since review is never asked to authorize an outside execution.
 */
export const accountTypedDataSigner =
  (input: Strk20AccountContext, providerFor: (nodeUrl: string) => RpcProvider) =>
  async (value: unknown): Promise<readonly string[]> => {
    if (!isJson(value)) {
      throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
    }
    const messageHash = typedData.getMessageHash(
      value as unknown as TypedData,
      input.account.address,
    );
    if (input.account.accountContractType !== "openzeppelin") {
      await withRpcFallback(
        input.rpcUrls,
        (provider) => requireLiveAuthorizableClass(provider, input.account),
        providerFor,
      );
    }
    const signature = await input.signHash(messageHash);
    return serializeAccountSignature(input.account.accountContractType, signature);
  };

type Submission = <P, T extends { readonly transactionHash: string }>(
  input: Strk20AccountContext,
  route: Strk20SubmissionRoute,
  prepare: (provider: RpcProvider, scope: Strk20MaturityScope) => Promise<P>,
  broadcast: (prepared: P) => Promise<T>,
  relaySlots?: (prepared: P) => readonly string[] | null,
) => Promise<T>;

/**
 * Relays a reviewed sponsored shield. The batch must be what the public route
 * would have sent minus the pool-fee approval: deposit approvals only, then
 * the configured pool's `apply_actions` last. The approvals travel inside the
 * frozen typed data; the pool call and proof travel to the relay, which pays
 * the pool fee and gas. Waits for the proof's block to mature exactly as the
 * public route does, and claims the scope as a relay write, so a lost answer
 * keeps it closed and nothing is ever re-sent.
 */
export const sponsoredShieldSubmitter =
  (deps: {
    readonly http?: PaymasterHttp;
    readonly maturity: Strk20MaturityRuntime;
    readonly nowSeconds?: () => number;
    readonly providerFor: (nodeUrl: string) => RpcProvider;
    readonly submission: Submission;
  }) =>
  async (
    input: Strk20SponsoredShieldSubmissionInput,
  ): Promise<{ readonly transactionHash: string }> => {
    const config = requireStrk20Config(input);
    const calls = input.calls ?? [];
    const applyActions = calls.at(-1);
    if (!deps.nowSeconds) {
      throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
    }
    if (
      input.proof.data.length === 0 ||
      input.proof.proof_facts.length === 0 ||
      !applyActions ||
      applyActions.entrypoint !== "apply_actions" ||
      !sameFelt(applyActions.contractAddress, config.poolAddress) ||
      calls.length < 2 ||
      calls.slice(0, -1).some((call) => call.entrypoint !== "approve")
    ) {
      throw new WalletError(STRK20_PRIVACY_LEAK);
    }
    return deps.submission(
      input,
      "relay",
      async (provider, scope) => {
        reportStrk20Phase(input.onPhase, "waiting for pool maturity");
        await deps.maturity.provingBlock(provider, scope);
        return applyActions;
      },
      async (call) => {
        reportStrk20Phase(input.onPhase, "relaying privately");
        return submitSponsoredShield({
          accountAddress: input.account.address,
          call,
          config: input.relay,
          ...(deps.http ? { http: deps.http } : {}),
          isAuthorized: input.isAuthorized,
          // Read at send time, so the authorization is checked against now.
          nowSeconds: deps.nowSeconds?.() ?? 0,
          plan: input.plan,
          proof: input.proof,
          signTypedData: accountTypedDataSigner(input, deps.providerFor),
        });
      },
      (call) => relayClaimSlots(call.calldata as readonly string[]),
    );
  };
