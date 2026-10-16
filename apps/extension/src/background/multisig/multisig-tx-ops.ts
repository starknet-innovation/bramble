/**
 * Frozen-intent signing and exact-hash submission for Argent multisig.
 */
import {
  type ArgentMultisigSigningIntent,
  argentMultisigIntentId,
  argentMultisigOperationId,
} from "@bramble/multisig/repository";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import {
  ArgentMultisigFeeExpiredError,
  preparedArgentMultisigFee,
  samePreparedArgentMultisigInvokeV3,
} from "@bramble/starknet/multisig-invoke";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { verifyStarkSignature } from "@bramble/starknet/signature-verify";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import { signerForContext } from "../accounts/wallet-ops";
import { activeAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { afterBroadcast } from "../transactions/activity-recording";
import { reviewArgentMultisigCalls } from "./multisig-call-review";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-deps";
import {
  argentMultisigIntentPackage,
  locallyDerivedImportedIntent,
  mergeImportedArgentMultisigIntent,
  readImportIntentInput,
  readImportIntentSignatureInput,
  readPrepareIntentInput,
  readSignIntentInput,
  readSubmitIntentInput,
  sortedArgentMultisigSignatures,
} from "./multisig-inputs";
import { currentArgentIntentContext } from "./multisig-intent-context";
import { recordBroadcastIntent, recoverSubmittedArgentIntent } from "./multisig-operation-recovery";
import {
  type ArgentMultisigContext,
  configSnapshot,
  currentConfigFor,
  signerAccountFor,
} from "./multisig-ops";
import { refuseResend } from "./multisig-stale-intents";

const preparationContext = async (
  deps: MultisigOpsDeps,
  input: NonNullable<ReturnType<typeof readPrepareIntentInput>>,
) => {
  const authorized = captureSessionAuthorization(deps.session);
  const active = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (active.error !== undefined || !authorized.isCurrent()) {
    return { error: active.error ?? "wallet locked" } as const;
  }
  const record = (await deps.multisigStore.listMultisigs()).find(
    (candidate) => candidate.id === input.multisigId,
  );
  if (!record || record.networkId !== active.networkId) {
    return {
      error: record ? "switch to the multisig network first" : "Argent multisig not found",
    } as const;
  }
  const preferences = await deps.preferencesStore.read();
  const context: ArgentMultisigContext = {
    active,
    record,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences),
  };
  const config = await currentConfigFor(deps, context);
  const review = await reviewArgentMultisigCalls(deps, context, input.calls, config);
  return review && "error" in review ? review : { authorized, config, context, record, review };
};

const importedIntentReview = async (deps: MultisigOpsDeps, intent: ArgentMultisigSigningIntent) => {
  const resolved = await currentArgentIntentContext(deps, intent, false);
  if ("error" in resolved) return resolved;
  const review = await reviewArgentMultisigCalls(
    deps,
    resolved.context,
    intent.prepared.calls,
    resolved.publicConfig,
  );
  if (review && "error" in review) return review;
  const existing = await deps.multisigStore.getIntent(intent.id);
  return existing && !samePreparedArgentMultisigInvokeV3(existing.prepared, intent.prepared)
    ? { error: "conflicting Argent multisig intent id" }
    : { existing, resolved, review };
};
const persistSignature = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  signature: StarkSignature,
  isAuthorized: () => boolean,
): Promise<RuntimeResponse> => {
  const guid = argentSignerGuid(signature.publicKey);
  if (
    !intent.configSnapshot.signerGuids.includes(guid) ||
    !verifyStarkSignature({
      hash: intent.prepared.transactionHash,
      publicKeyX: signature.publicKey,
      signature,
    })
  ) {
    return { error: "signature is not valid for this exact Argent multisig intent" };
  }
  if (intent.signatures.some((existing) => argentSignerGuid(existing.publicKey) === guid)) {
    return { error: "this Argent multisig signer already signed the intent" };
  }
  if (intent.signatures.length >= intent.configSnapshot.threshold) {
    return { error: "Argent multisig intent already has its threshold signatures" };
  }
  const signatures = sortedArgentMultisigSignatures([...intent.signatures, signature]);
  const next: ArgentMultisigSigningIntent = {
    ...intent,
    signatures,
    state: signatures.length === intent.configSnapshot.threshold ? "ready" : "collecting",
  };
  const stored = await deps.multisigStore.upsertIntent(next, isAuthorized);
  if (stored === "unauthorized") return { error: "wallet locked" };
  return stored === "stored"
    ? { intent: next, intentPackage: argentMultisigIntentPackage(next), ok: true }
    : { error: `Argent multisig intent ${stored}` };
};

const prepareIntent = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const input = readPrepareIntentInput(message);
  if (!input) {
    return { error: "invalid Argent multisig intent preparation request" };
  }
  const resolved = await preparationContext(deps, input);
  if ("error" in resolved) return resolved;
  const prepared = await multisigRpc(deps).prepareInvoke({
    account: resolved.record,
    calls: input.calls,
    config: {
      signerPublicKeys: resolved.config.signerPublicKeys,
      threshold: resolved.config.threshold,
    },
    rpcUrls: resolved.context.rpcUrls,
  });
  const resent = await refuseResend(deps, resolved.record.id, prepared, input.confirmResend);
  if (resent) return resent;
  if (!resolved.authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  const id = argentMultisigIntentId(resolved.record.id, prepared.transactionHash);
  if (!id) {
    return { error: "invalid Argent multisig prepared transaction" };
  }
  const intent: ArgentMultisigSigningIntent = {
    accountId: resolved.record.id,
    configSnapshot: configSnapshot(resolved.config.chain),
    id,
    prepared,
    signatures: [],
    state: "collecting",
    summary: resolved.review.summary,
  };
  const stored = await deps.multisigStore.upsertIntent(intent, resolved.authorized.isCurrent);
  if (stored === "unauthorized") return { error: "wallet locked" };
  return stored === "stored"
    ? {
        feeReview: preparedArgentMultisigFee(prepared),
        intent,
        intentPackage: argentMultisigIntentPackage(intent),
        ok: true,
      }
    : { error: `Argent multisig intent ${stored}` };
};

const importIntent = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const input = readImportIntentInput(message);
  if (!input) {
    return { error: "invalid Argent multisig intent package" };
  }
  const authorized = captureSessionAuthorization(deps.session);
  const remoteIntent = locallyDerivedImportedIntent(input.package.intent);
  const reviewed = await importedIntentReview(deps, remoteIntent);
  if ("error" in reviewed || !authorized.isCurrent()) {
    return "error" in reviewed ? reviewed : { error: "wallet locked" };
  }
  const incoming = { ...remoteIntent, summary: reviewed.review.summary };
  const intent = reviewed.existing
    ? mergeImportedArgentMultisigIntent(reviewed.existing, incoming)
    : incoming;
  if (!authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  const stored = await deps.multisigStore.upsertIntent(intent, authorized.isCurrent);
  if (stored === "unauthorized") return { error: "wallet locked" };
  return stored === "stored"
    ? {
        feeReview: preparedArgentMultisigFee(intent.prepared),
        intent,
        intentPackage: argentMultisigIntentPackage(intent),
        ok: true,
      }
    : { error: `Argent multisig intent ${stored}` };
};

const resolveLocalSigning = async (
  deps: MultisigOpsDeps,
  input: NonNullable<ReturnType<typeof readSignIntentInput>>,
) => {
  const authorized = captureSessionAuthorization(deps.session);
  const intent = await deps.multisigStore.getIntent(input.intentId);
  if (intent?.state !== "collecting") {
    return {
      error: intent ? "Argent multisig intent is not collecting signatures" : "intent not found",
    } as const;
  }
  const resolved = await currentArgentIntentContext(deps, intent);
  if ("error" in resolved) {
    return resolved;
  }
  if (!authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  const signer = signerAccountFor(resolved.context, input.signerAccountId);
  if (!signer) {
    return { error: "selected signer account is unavailable on this network" };
  }
  const guid = argentSignerGuid(signer.publicKeyX);
  if (!resolved.config.signerGuids.includes(guid)) {
    return { error: "selected account is not a current Argent multisig signer" };
  }
  if (intent.signatures.some((existing) => argentSignerGuid(existing.publicKey) === guid)) {
    return { error: "this Argent multisig signer already signed the intent" };
  }
  const operationId = argentMultisigOperationId(
    "sign",
    intent.accountId,
    intent.prepared.transactionHash,
    guid,
  );
  if (!operationId) {
    return { error: "invalid Argent multisig signing claim" };
  }
  const claim = await deps.multisigStore.claimOperation({
    accountId: intent.accountId,
    id: operationId,
    kind: "sign",
    signerGuid: guid,
    target: intent.prepared.transactionHash,
  });
  if (claim !== "claimed") {
    return {
      error:
        claim === "exists"
          ? "this signer already signed or is signing the intent"
          : `signing claim ${claim}`,
    } as const;
  }
  return { authorized, intent, operationId, resolved, signer } as const;
};

const signIntent = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const input = readSignIntentInput(message);
  if (!input) {
    return { error: "invalid Argent multisig signing request" };
  }
  const signing = await resolveLocalSigning(deps, input);
  if ("error" in signing) {
    return signing;
  }
  try {
    const signature = await signerForContext(deps, {
      account: signing.signer,
      vaultPassphrase: signing.resolved.context.active.vaultPassphrase,
    })(signing.intent.prepared.transactionHash);
    const response = await persistSignature(
      deps,
      signing.intent,
      signature,
      signing.authorized.isCurrent,
    );
    if ("error" in response) {
      await deps.multisigStore.releaseOperation(signing.operationId);
    }
    return response;
  } catch (error) {
    await deps.multisigStore.releaseOperation(signing.operationId);
    throw error;
  }
};

const importSignature = async (
  deps: MultisigOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readImportIntentSignatureInput(message);
  if (!input) {
    return { error: "invalid Argent multisig signature import" };
  }
  const authorized = captureSessionAuthorization(deps.session);
  const intent = await deps.multisigStore.getIntent(input.intentId);
  if (intent?.state !== "collecting") {
    return {
      error: intent ? "Argent multisig intent is not collecting signatures" : "intent not found",
    };
  }
  const resolved = await currentArgentIntentContext(deps, intent);
  if ("error" in resolved || !authorized.isCurrent()) {
    return "error" in resolved ? resolved : { error: "wallet locked" };
  }
  return persistSignature(deps, intent, input.signature, authorized.isCurrent);
};

type ResolvedSubmission =
  | { readonly response: RuntimeResponse }
  | {
      readonly intent: ArgentMultisigSigningIntent;
      readonly authorized: ReturnType<typeof captureSessionAuthorization>;
      readonly operationId: string;
      readonly resolved: Exclude<
        Awaited<ReturnType<typeof currentArgentIntentContext>>,
        { error: string }
      >;
    };

const existingSubmissionResponse = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  operationId: string,
): Promise<RuntimeResponse | null> => {
  const existing = await deps.multisigStore.getOperation(operationId);
  const transactionHash = existing?.transactionHash ?? intent.broadcastTransactionHash;
  if (transactionHash) return { intent, ok: true, transactionHash };
  const recovered = await recoverSubmittedArgentIntent(deps, intent, operationId);
  if (recovered.kind === "submitted") {
    return {
      intent: recovered.intent,
      ok: true,
      transactionHash: recovered.intent.prepared.transactionHash,
    };
  }
  if (recovered.kind === "unknown") {
    return { error: "Argent multisig submission outcome is unresolved" };
  }
  await deps.multisigStore.releaseOperation(operationId);
  const reclaimed = await deps.multisigStore.claimOperation({
    accountId: intent.accountId,
    id: operationId,
    kind: "submit",
    target: intent.prepared.transactionHash,
  });
  return reclaimed === "claimed"
    ? null
    : { error: "The previous submission did not reach Starknet. Try again." };
};

const claimSubmission = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  operationId: string,
): Promise<RuntimeResponse | null> => {
  const claim = await deps.multisigStore.claimOperation({
    accountId: intent.accountId,
    id: operationId,
    kind: "submit",
    target: intent.prepared.transactionHash,
  });
  if (claim === "exists") return existingSubmissionResponse(deps, intent, operationId);
  return claim === "claimed" ? null : { error: `Argent multisig submission claim ${claim}` };
};

const knownSubmissionResponse = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  operationId: string,
): Promise<RuntimeResponse | null> => {
  const transactionHash =
    intent.broadcastTransactionHash ??
    (await deps.multisigStore.getOperation(operationId))?.transactionHash;
  if (!transactionHash) return null;
  const submitted: ArgentMultisigSigningIntent = {
    ...intent,
    broadcastTransactionHash: transactionHash,
    state: intent.state === "accepted" || intent.state === "rejected" ? intent.state : "submitted",
  };
  await deps.multisigStore.upsertIntent(submitted).catch(() => "invalid" as const);
  return { intent: submitted, ok: true, transactionHash };
};

const resolveSubmission = async (
  deps: MultisigOpsDeps,
  input: NonNullable<ReturnType<typeof readSubmitIntentInput>>,
): Promise<ResolvedSubmission> => {
  const authorized = captureSessionAuthorization(deps.session);
  const intent = await deps.multisigStore.getIntent(input.intentId);
  if (intent?.state !== "ready" && intent?.state !== "stale" && intent?.state !== "submitted") {
    return {
      response: { error: intent ? "Argent multisig intent is not ready" : "intent not found" },
    };
  }
  const operationId = argentMultisigOperationId(
    "submit",
    intent.accountId,
    intent.prepared.transactionHash,
  );
  if (!operationId) {
    return { response: { error: "invalid Argent multisig submission claim" } };
  }
  const known = await knownSubmissionResponse(deps, intent, operationId);
  if (known) return { response: known };
  const resolved = await currentArgentIntentContext(deps, intent);
  if ("error" in resolved || !authorized.isCurrent()) {
    return { response: "error" in resolved ? resolved : { error: "wallet locked" } };
  }
  if (intent.signatures.length !== intent.configSnapshot.threshold) {
    return { response: { error: "Argent multisig threshold is not satisfied" } };
  }
  const response = await claimSubmission(deps, intent, operationId);
  if (response) return { response };
  return { authorized, intent, operationId, resolved };
};

const submitIntent = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const input = readSubmitIntentInput(message);
  if (!input) {
    return { error: "invalid Argent multisig submission request" };
  }
  const submission = await resolveSubmission(deps, input);
  if ("response" in submission) {
    return submission.response;
  }
  let transactionHash: string;
  try {
    transactionHash = await multisigRpc(deps).submitPreparedInvoke({
      config: {
        signerPublicKeys: submission.intent.signatures.map((signature) => signature.publicKey),
        threshold: submission.resolved.config.threshold,
      },
      prepared: submission.intent.prepared,
      rpcUrls: submission.resolved.context.rpcUrls,
      signatures: submission.intent.signatures,
      isAuthorized: submission.authorized.isCurrent,
    });
  } catch (error) {
    if (error instanceof IndeterminateRpcWriteError) {
      // The reply was lost, so the signed package may be on chain under the
      // hash every signer holds. Keep the claim, journal it as pending, and say
      // the outcome is unknown; a resend reuses that hash and nonce (#681).
      const pending = submission.intent.prepared.transactionHash;
      await afterBroadcast(() =>
        recordBroadcastIntent(deps, submission.intent, submission.resolved.context.record, pending),
      );
      return submissionUnknownResponse(error.message, pending);
    }
    await deps.multisigStore.releaseOperation(submission.operationId);
    if (error instanceof ArgentMultisigFeeExpiredError) {
      await deps.multisigStore.upsertIntent({ ...submission.intent, state: "stale" });
      return { error: error.details };
    }
    throw error;
  }
  const submitted: ArgentMultisigSigningIntent = {
    ...submission.intent,
    broadcastTransactionHash: transactionHash,
    state: "submitted",
  };
  // Once broadcast returns a hash the claim is never released: a failed write is no cue to resend.
  await deps.multisigStore
    .setOperationHash(submission.operationId, transactionHash)
    .catch(() => {});
  await deps.multisigStore.upsertIntent(submitted).catch(() => "invalid" as const);
  await recordBroadcastIntent(
    deps,
    submission.intent,
    submission.resolved.context.record,
    transactionHash,
  );
  return { intent: submitted, ok: true, transactionHash };
};

type IntentHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;
const HANDLERS: Readonly<Record<string, IntentHandler>> = {
  "wallet.importArgentMultisigIntent": importIntent,
  "wallet.importArgentMultisigSignature": importSignature,
  "wallet.prepareArgentMultisigIntent": prepareIntent,
  "wallet.signArgentMultisigIntent": signIntent,
  "wallet.submitArgentMultisigIntent": submitIntent,
};
/**
 * Dispatches privileged exact-intent Argent messages.
 */
export const handleMultisigTxOps = async (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(HANDLERS, messageType) ? HANDLERS[messageType] : undefined;
  return handler ? handler(deps, message) : null;
};
