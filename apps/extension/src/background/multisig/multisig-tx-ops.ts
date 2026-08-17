/**
 * Frozen-intent signing and exact-hash submission for Argent multisig.
 */
import {
  type ArgentMultisigSigningIntent,
  argentMultisigIntentId,
  argentMultisigOperationId,
} from "@mc-wallet/multisig/repository";
import { argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import {
  preparedArgentMultisigFee,
  samePreparedArgentMultisigInvokeV3,
} from "@mc-wallet/starknet/multisig-invoke";
import { IndeterminateRpcWriteError } from "@mc-wallet/starknet/provider";
import { verifyStarkSignature } from "@mc-wallet/starknet/signature-verify";
import { verificationContext } from "@mc-wallet/transactions/verify";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";
import { signerForContext } from "../accounts/wallet-ops";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { activeAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { recordSubmittedActivity } from "../transactions/activity-recording";
import { reviewArgentMultisigCalls } from "./multisig-call-review";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-deps";
import {
  argentMultisigIntentPackage,
  locallyDerivedImportedIntent,
  normalizedArgentMultisigCalls,
  readImportIntentInput,
  readImportIntentSignatureInput,
  readPrepareIntentInput,
  readSignIntentInput,
  readSubmitIntentInput,
} from "./multisig-inputs";
import { currentArgentIntentContext } from "./multisig-intent-context";
import { recoverSubmittedArgentIntent } from "./multisig-operation-recovery";
import {
  type ArgentMultisigContext,
  configSnapshot,
  currentConfigFor,
  signerAccountFor,
} from "./multisig-ops";

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
    : { resolved, review };
};

const sortedSignatures = (values: readonly StarkSignature[]): readonly StarkSignature[] =>
  [...values].sort((left, right) =>
    BigInt(argentSignerGuid(left.publicKey)) < BigInt(argentSignerGuid(right.publicKey)) ? -1 : 1,
  );

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
  const signatures = sortedSignatures([...intent.signatures, signature]);
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
  const intent = { ...remoteIntent, summary: reviewed.review.summary };
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
): Promise<RuntimeResponse> => {
  const existing = await deps.multisigStore.getOperation(operationId);
  const recovered = existing?.transactionHash
    ? null
    : await recoverSubmittedArgentIntent(deps, intent, operationId);
  const transactionHash = existing?.transactionHash ?? recovered?.prepared.transactionHash;
  return transactionHash
    ? { intent: recovered ?? intent, ok: true, transactionHash }
    : { error: "Argent multisig submission outcome is unresolved" };
};

const resolveSubmission = async (
  deps: MultisigOpsDeps,
  input: NonNullable<ReturnType<typeof readSubmitIntentInput>>,
): Promise<ResolvedSubmission> => {
  const authorized = captureSessionAuthorization(deps.session);
  const intent = await deps.multisigStore.getIntent(input.intentId);
  if (intent?.state !== "ready" && intent?.state !== "submitted") {
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
  const claim = await deps.multisigStore.claimOperation({
    accountId: intent.accountId,
    id: operationId,
    kind: "submit",
    target: intent.prepared.transactionHash,
  });
  if (claim === "exists") {
    return { response: await existingSubmissionResponse(deps, intent, operationId) };
  }
  if (claim !== "claimed") {
    return { response: { error: `Argent multisig submission claim ${claim}` } };
  }
  const resolved = await currentArgentIntentContext(deps, intent);
  if ("error" in resolved) {
    await deps.multisigStore.releaseOperation(operationId);
    return { response: resolved };
  }
  if (!authorized.isCurrent()) {
    await deps.multisigStore.releaseOperation(operationId);
    return { response: { error: "wallet locked" } };
  }
  if (intent.signatures.length !== intent.configSnapshot.threshold) {
    await deps.multisigStore.releaseOperation(operationId);
    return { response: { error: "Argent multisig threshold is not satisfied" } };
  }
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
    if (!(error instanceof IndeterminateRpcWriteError)) {
      await deps.multisigStore.releaseOperation(submission.operationId);
    }
    throw error;
  }
  const submitted: ArgentMultisigSigningIntent = {
    ...submission.intent,
    broadcastTransactionHash: transactionHash,
    state: "submitted",
  };
  // Once broadcast returns a hash the claim must never be released: a failed
  // journal write is unresolved persistence, not permission to broadcast again.
  await deps.multisigStore
    .setOperationHash(submission.operationId, transactionHash)
    .catch(() => {});
  await deps.multisigStore.upsertIntent(submitted).catch(() => "invalid" as const);
  await deps.preferencesStore
    .read()
    .then((preferences) =>
      recordApproveAllowances({
        assets: verificationContext(submission.resolved.context.record, preferences),
        calls: normalizedArgentMultisigCalls(submission.intent.prepared.calls),
        owner: allowanceOwner(submission.resolved.context.record),
        store: deps.allowanceStore,
      }),
    )
    .catch(() => {});
  await recordSubmittedActivity(deps.activity, {
    accountId: submission.intent.accountId,
    hash: transactionHash,
    kind: "invoke",
    networkId: submission.resolved.context.record.networkId,
    summary: submission.intent.summary,
  });
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
