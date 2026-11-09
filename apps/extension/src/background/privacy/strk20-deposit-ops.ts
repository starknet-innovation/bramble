/**
 * The shield (public-to-private deposit) preparation, run as a tracked job.
 *
 * A deposit is the one send route that builds its proof at review, so it is
 * answered through the job registry (./strk20-preparation-jobs): the request
 * returns the job id once the shared pool-route gate has passed, and the panel
 * polls `wallet.strk20PreparationStatus` for the review, each poll carrying the
 * phase the job last reported. The side panel receives review metadata, never
 * the executable batch. Privileged; never enters the dapp bridge.
 */

import { WalletError } from "@bramble/core/errors";
import type { Strk20PhaseSink } from "@bramble/privacy/phases";
import {
  type PreparedStrk20AccountSubmission,
  prepareStrk20AccountActions,
  quoteStrk20Actions,
  readStrk20RegistrationStatus,
  type Strk20AccountPlan,
  summarizeStrk20Plan,
} from "@bramble/privacy/service";
import { summarizeSponsoredShield } from "@bramble/privacy/sponsored-shield";
import { parseTokenAmount } from "@bramble/starknet/rpc";
import { sameFelt } from "@bramble/wallet-model/networks";
import { isStrk20Felt } from "@bramble/wallet-protocol/strk20";
import { runNestedGatewayAnalyticsService } from "../analytics/gateway-analytics";
import { createApprovalContext } from "../approvals/approval-context";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { strk20ServiceForRuntime } from "./strk20-account-context";
import { hasPendingRegistration } from "./strk20-activity";
import { strk20FeeAssetFor } from "./strk20-fee-reference";
import {
  type ActivePrivacyContext,
  assertPrivacyAccountDeployed,
  assertPublicPoolSpendAffordable,
  errorText,
  estimatePublicStrk20Fee,
  reportingPrivacyContext,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";
import { openPoolRoute } from "./strk20-pool-route";
import {
  assertSponsoredDepositAffordable,
  offerSponsoredShield,
  type SponsoredShieldOffer,
  sponsoredDepositCalls,
} from "./strk20-sponsored-shield";
import { strk20WalletPreparationPayload } from "./strk20-wallet-preparations";

const REGISTRATION_CHANGED = "Private balances changed. Review the shield again.";

// Both parties a deposit touches must be in the pool: the depositor to own the
// batch, and the credited account because the note lands in a channel derived
// from its registered viewing key. Re-checked here rather than trusted from the
// side panel's gate, because this message is untrusted like any other. A
// self-credit needs only the one check, and an unregistered depositor crediting
// itself registers in the same transaction (#789): `activate` is then true.
type DepositRegistration = { readonly activate: boolean } | { readonly error: string };

const depositRegistration = async (
  deps: Strk20WalletOpsDeps,
  service: ReturnType<typeof strk20ServiceForRuntime>,
  context: ActivePrivacyContext,
  recipient: string,
): Promise<DepositRegistration> => {
  const status = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    token: context.token.address,
  });
  const toSelf = sameFelt(recipient, context.accountContext.account.address);
  if (status !== "registered") {
    if (!toSelf) {
      return { error: "Activate private balances before shielding an asset" };
    }
    // The indexer lags a broadcast registration; one already on its way must
    // not be sent a second time inside a shield.
    if (await hasPendingRegistration(deps, context)) {
      return { error: "A registration is already on its way for this account" };
    }
    return { activate: true };
  }
  if (toSelf) {
    return { activate: false };
  }
  const recipientStatus = await readStrk20RegistrationStatus(service, {
    ...context.accountContext,
    subject: recipient,
    token: context.token.address,
  });
  return recipientStatus === "registered"
    ? { activate: false }
    : { error: "The recipient has not activated private balances" };
};

// The review lines for a shield. A first shield that registers in the same
// transaction (#789) says so in its headline and states the registration's
// public link, exactly as a registration on its own does.
const depositSummaries = (input: {
  readonly activate: boolean;
  readonly feeLine: string;
  readonly recipient: string;
  readonly toSelf: boolean;
  readonly value: string;
}): string[] => [
  input.activate
    ? `Activate private balances and shield ${input.value}`
    : input.toSelf
      ? `Shield ${input.value}`
      : `Shield ${input.value} into ${input.recipient}'s private balance`,
  ...(input.activate
    ? ["Registration is public and links this wallet address to its viewing key"]
    : []),
  input.feeLine,
  input.toSelf
    ? "The deposit is public; the resulting balance can be spent privately"
    : "The deposit is public: your address and the amount are on chain, and only the recipient stays hidden",
];

// What the frozen route adds to a shield's preparation, and its review line.
// The sponsored route sends the user nothing to estimate: the relay submits,
// and the pool-fee approval is dropped because the relay pays.
const shieldRoute = async (
  deps: Strk20WalletOpsDeps,
  context: ActivePrivacyContext,
  plan: Strk20AccountPlan,
  prepared: PreparedStrk20AccountSubmission,
  sponsored: SponsoredShieldOffer | null,
  report: Strk20PhaseSink,
) => {
  if (sponsored) {
    return {
      allowanceGrants: sponsored.approveCalls,
      calls: sponsoredDepositCalls(sponsored, prepared.calls),
      feeLine: summarizeSponsoredShield(sponsored.plan, plan.poolFeeFri),
      sponsorship: { plan: sponsored.plan, relay: sponsored.relay },
    };
  }
  report({ phase: "estimating the network fee" });
  return {
    feeLine: summarizeStrk20Plan(
      plan,
      strk20FeeAssetFor(context.accountContext.account.networkId, plan),
    ),
    networkFee: await estimatePublicStrk20Fee(deps, context, prepared.calls, prepared.proof),
  };
};

// The proof-building half of a shield, run detached inside a tracked job. The
// route was opened on the request that started the job, so every refusal the
// gate can make has already been answered synchronously; what remains is the
// registration check, the quote, the proof, and the fee estimate — the work
// that can outlive a runtime request. Each step reports its phase through the
// context's sink; the adapter reports the ones inside the proof itself.
const depositPreparationWork = async (
  deps: Strk20WalletOpsDeps,
  input: { readonly amount: string; readonly recipient: string; readonly tokenId: string },
  opened: { readonly context: ActivePrivacyContext; readonly recipient: string },
  report: Strk20PhaseSink,
): Promise<RuntimeResponse> => {
  const context = reportingPrivacyContext(opened.context, report);
  const { recipient } = opened;
  try {
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    const registration = await depositRegistration(deps, service, context, recipient);
    if ("error" in registration) {
      return { error: registration.error };
    }
    const { activate } = registration;
    if (activate) {
      // A registration is an invoke from this account, so it must exist.
      await assertPrivacyAccountDeployed(deps, context);
    }
    const toSelf = sameFelt(recipient, context.accountContext.account.address);
    const amountRaw = parseTokenAmount(input.amount, context.token.decimals);
    if (amountRaw <= 0n) {
      return { error: "Enter an amount to shield" };
    }
    if (!isStrk20Felt(`0x${amountRaw.toString(16)}`)) {
      return { error: "Amount is outside the Starknet field range" };
    }
    const actions = [
      {
        amount: `0x${amountRaw.toString(16)}`,
        // A self-credit is the batch's implicit surplus, so it names no
        // recipient and stays the batch the pool already receives for a shield.
        ...(toSelf ? {} : { recipient }),
        token: context.token.address,
        type: "deposit" as const,
      },
    ];
    report({ phase: "reading the pool fee" });
    const plan = await quoteStrk20Actions(service, { ...context.accountContext, actions });
    if (plan.mode !== "account") {
      return { error: "Shielding route unavailable" };
    }
    // Asked only now, after every refusal the self-paid route would make: a
    // sponsor's no, or silence, leaves exactly that route.
    const sponsored = await offerSponsoredShield(deps, context, actions, recipient);
    report({ phase: "checking the public balance" });
    await (sponsored
      ? assertSponsoredDepositAffordable(deps, context, `0x${amountRaw.toString(16)}`)
      : assertPublicPoolSpendAffordable(
          deps,
          context,
          plan.poolFeeFri,
          `0x${amountRaw.toString(16)}`,
        ));
    const config = context.accountContext.config;
    if (!config) {
      return { error: "Private balances are not configured for this network" };
    }
    const prepared = await prepareStrk20AccountActions(service, {
      ...context.accountContext,
      actions,
      ...(activate ? { activate: true as const } : {}),
      beforeProof: () =>
        runNestedGatewayAnalyticsService(service, async (nestedService) => {
          const current = await depositRegistration(deps, nestedService, context, recipient);
          if ("error" in current) {
            throw new WalletError(current.error);
          }
          if (current.activate !== activate) {
            throw new WalletError(REGISTRATION_CHANGED);
          }
        }),
      poolFeeFri: plan.poolFeeFri,
    });
    const { feeLine, ...route } = await shieldRoute(
      deps,
      context,
      plan,
      prepared,
      sponsored,
      report,
    );
    const unsigned = {
      ...prepared,
      ...route,
      actions,
      amount: input.amount,
      amountRaw: `0x${amountRaw.toString(16)}`,
      kind: "deposit" as const,
      plan,
      poolAddress: config.poolAddress,
      recipient,
      ...(activate ? { activates: true as const } : {}),
      summaries: depositSummaries({
        activate,
        feeLine,
        recipient,
        toSelf,
        value: `${input.amount} ${context.token.symbol}`,
      }),
      token: context.token,
    };
    const approvalContext = await createApprovalContext(
      context.accountContext.account,
      strk20WalletPreparationPayload(unsigned),
    );
    return {
      ok: true,
      strk20Preparation: deps.strk20Preparations.put({
        ...unsigned,
        context: approvalContext,
        id: approvalContext.payloadDigest,
      }),
    };
  } catch (error) {
    return { error: errorText(error, "Shielding preparation failed") };
  }
};

/**
 * Opens the pool route on the request, then starts the proof as a tracked job.
 * Gate refusals answer the request itself; everything after the gate answers
 * through the job's poll.
 */
export const depositPreparation = async (
  deps: Strk20WalletOpsDeps,
  input: { readonly amount: string; readonly recipient: string; readonly tokenId: string },
): Promise<RuntimeResponse> => {
  const opened = await openPoolRoute(deps, input);
  if ("error" in opened) {
    return opened;
  }
  return deps.strk20Jobs.start("deposit", (report) =>
    depositPreparationWork(deps, input, opened, report),
  );
};
