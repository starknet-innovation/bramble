/**
 * Privileged review and submit handlers for the phrase-driven recovery flows
 * (Braavos 2FA removal, Ready guardian escape). Both remove a second factor,
 * so a submission is bound to exactly what its confirmation showed: the
 * account it was reviewed for, the step, the maximum fee, and (Ready) an
 * explicit acknowledgement before a pending owner escape is cancelled. The
 * phrase key signs only inside the background; Ledger accounts are refused
 * before any signer is built. Every accepted or possibly-landed submission is
 * journaled to activity with a deterministic summary.
 */
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import type { ActivityLog } from "@bramble/transactions/activity";
import { isKeylessAccount } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import { accountHashSigner } from "../ledger/account-hash-signer";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import { readTypeOnlyInput } from "../routing/message-inputs";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { activeAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type UnlockSession } from "../runtime/session";
import { recordSubmittedActivity } from "../transactions/activity-recording";
import { type RecoveryInput, readRecoveryInput } from "./recovery-inputs";
import type { WalletStatusReader } from "./wallet-reader";

// The slice of the wallet-ops dependency set these handlers read. Structural
// on purpose so this module never imports wallet-ops.
type AccountRecoveryDeps = {
  readonly activity: ActivityLog;
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/** Activity summaries for recovery submissions. Deterministic; do not reword casually. */
const RECOVERY_ACTIVITY_SUMMARIES = {
  "argent-complete": "Complete guardian removal",
  "argent-start": "Start guardian removal",
  braavos: "Start 2FA removal",
} as const;

type RecoveryFlow = "argent" | "braavos";

// Resolves the unlocked active account the flow may act on, refusing an
// account switch since the review, a non-vendor shape, and Ledger accounts
// (the device could only blind-sign the removal of a second factor).
const recoveryContext = async (deps: AccountRecoveryDeps, expectedAccountId?: string) => {
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) return { error: context.error } as const;
  const { account } = context;
  if (expectedAccountId !== undefined && account.id !== expectedAccountId) {
    return { error: "The active account changed. Review the recovery again." } as const;
  }
  if (!("publicKeyX" in account)) return { error: "second factor removal unavailable" } as const;
  if (isKeylessAccount(account)) {
    return { error: "Account recovery is not available for Ledger accounts" } as const;
  }
  const rpcUrls = networkRpcUrls(
    STARKNET_NETWORKS[context.networkId],
    await deps.preferencesStore.read(),
  );
  return {
    account,
    networkId: context.networkId,
    rpcUrls,
    signHash: accountHashSigner(deps, account, context.vaultPassphrase),
  } as const;
};

/**
 * Quotes the Braavos 2FA-removal request for its confirmation: the maximum
 * fee and the moment the removal takes effect if sent now. The phrase key
 * signs only a query-version estimate, which can never be submitted.
 */
export const handleReviewBraavosRecovery = async (
  deps: AccountRecoveryDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  if (!readTypeOnlyInput(message, "wallet.reviewBraavosRecovery")) {
    return { error: "invalid recovery review request" };
  }
  const context = await recoveryContext(deps);
  if ("error" in context) return { error: context.error };
  if (!deps.runtimeRpc.reviewBraavosRecovery) return { error: "second factor removal unavailable" };
  const review = await deps.runtimeRpc.reviewBraavosRecovery(context);
  return {
    accountId: context.account.id,
    expiresAt: null,
    fee: review.fee,
    ok: true,
    readyAt: review.effectiveAfter,
    replaces: null,
    step: "start",
  };
};

/**
 * Quotes the Ready recovery's next escape step for its confirmation: the
 * step, the maximum fee, the completion window, and whether starting cancels
 * a pending owner escape. The estimate uses the account's query signer, so no
 * key signs anything here.
 */
export const handleReviewArgentRecovery = async (
  deps: AccountRecoveryDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  if (!readTypeOnlyInput(message, "wallet.reviewArgentRecovery")) {
    return { error: "invalid recovery review request" };
  }
  const context = await recoveryContext(deps);
  if ("error" in context) return { error: context.error };
  if (!deps.runtimeRpc.reviewArgentRecovery) return { error: "second factor removal unavailable" };
  const review = await deps.runtimeRpc.reviewArgentRecovery(context);
  return {
    accountId: context.account.id,
    expiresAt: review.expiresAt,
    fee: review.fee,
    ok: true,
    readyAt: review.readyAt,
    replaces: review.replaces,
    step: review.step,
  };
};

// Submits through `run`, journaling the accepted hash — or, when the reply was
// lost or mismatched, the signed hash — so Activity and the reconciler can
// follow a removal that may already be on chain.
const submitRecovery = async (
  deps: AccountRecoveryDeps,
  flow: RecoveryFlow,
  input: RecoveryInput,
  run: (
    context: Exclude<Awaited<ReturnType<typeof recoveryContext>>, { readonly error: string }>,
    extras: { readonly isAuthorized: () => boolean; readonly onSigned: (hash: string) => void },
  ) => Promise<{ readonly pendingUntil: number | null; readonly transactionHash: string }>,
): Promise<RuntimeResponse> => {
  const context = await recoveryContext(deps, input.accountId);
  if ("error" in context) return { error: context.error };
  const summary =
    flow === "braavos"
      ? RECOVERY_ACTIVITY_SUMMARIES.braavos
      : RECOVERY_ACTIVITY_SUMMARIES[input.step === "complete" ? "argent-complete" : "argent-start"];
  const record = (hash: string) =>
    recordSubmittedActivity(deps.activity, {
      accountId: context.account.id,
      hash,
      kind: "invoke",
      networkId: context.networkId,
      summary,
    });
  let signedHash: string | undefined;
  const authorized = captureSessionAuthorization(deps.session);
  try {
    const submitted = await run(context, {
      isAuthorized: authorized.isCurrent,
      onSigned: (hash) => {
        signedHash = hash;
      },
    });
    await record(submitted.transactionHash);
    return {
      accountId: context.account.id,
      ok: true,
      pendingUntil: submitted.pendingUntil,
      transactionHash: submitted.transactionHash,
    };
  } catch (error) {
    if (!(error instanceof IndeterminateRpcWriteError)) throw error;
    if (signedHash !== undefined) await record(signedHash);
    return submissionUnknownResponse(error.message, signedHash);
  }
};

/**
 * Submits the confirmed Braavos 2FA-removal request for the account it was
 * reviewed for, held to the confirmed maximum fee.
 */
export const handleRecoverBraavosAccount = async (
  deps: AccountRecoveryDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readRecoveryInput(message, "wallet.recoverBraavosAccount");
  if (!input) return { error: "invalid account recovery request" };
  const submit = deps.runtimeRpc.submitBraavosRecovery;
  if (!submit) return { error: "second factor removal unavailable" };
  return submitRecovery(deps, "braavos", input, (context, extras) =>
    submit({ ...context, ...extras, reviewedFee: input.reviewedFee }),
  );
};

/**
 * Submits the confirmed Ready escape step for the account it was reviewed
 * for: the platform refuses a step other than the confirmed one, a pending
 * owner escape the user did not acknowledge, and a fee above the confirmed
 * maximum.
 */
export const handleRecoverArgentAccount = async (
  deps: AccountRecoveryDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readRecoveryInput(message, "wallet.recoverArgentAccount");
  if (!input?.step) return { error: "invalid account recovery request" };
  const submit = deps.runtimeRpc.submitArgentRecovery;
  if (!submit) return { error: "second factor removal unavailable" };
  const step = input.step;
  return submitRecovery(deps, "argent", input, async (context, extras) => {
    const submitted = await submit({
      ...context,
      ...extras,
      expectedStep: step,
      ...(input.replaceEscape !== undefined ? { replaceEscape: input.replaceEscape } : {}),
      reviewedFee: input.reviewedFee,
    });
    return { pendingUntil: submitted.readyAt, transactionHash: submitted.transactionHash };
  });
};
