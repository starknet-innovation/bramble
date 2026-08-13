/**
 * Frozen-intent signing and exact-hash submission for Argent multisig.
 */
import type { ArgentMultisigConfig } from "@mc-wallet/multisig/chain";
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
import { STARKNET_NETWORKS, sameFelt } from "@mc-wallet/wallet-model/networks";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";
import { signerForContext } from "../accounts/wallet-ops";
import { activeAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { recordSubmittedActivity } from "../transactions/activity-recording";
import { reviewArgentMultisigCalls } from "./multisig-call-review";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-deps";
import {
  argentMultisigIntentPackage,
  readImportIntentInput,
  readImportIntentSignatureInput,
  readPrepareIntentInput,
  readSignIntentInput,
  readSubmitIntentInput,
} from "./multisig-inputs";
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
  const resolved = await currentIntentContext(deps, intent, false);
  if ("error" in resolved) return resolved;
  const review = await reviewArgentMultisigCalls(
    deps,
    resolved.context,
    intent.prepared.calls,
    resolved.config,
  );
  if (review && "error" in review) return review;
  if (review?.summary !== undefined && intent.summary !== review.summary) {
    return { error: "Argent multisig configuration summary does not match the exact self-call" };
  }
  const existing = await deps.multisigStore.getIntent(intent.id);
  return existing && !samePreparedArgentMultisigInvokeV3(existing.prepared, intent.prepared)
    ? { error: "conflicting Argent multisig intent id" }
    : { resolved, review };
};

const contextForIntent = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
): Promise<ArgentMultisigContext | { readonly error: string }> => {
  const active = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (active.error !== undefined) {
    return active;
  }
  const record = (await deps.multisigStore.listMultisigs()).find(
    (candidate) => candidate.id === intent.accountId,
  );
  if (!record) {
    return { error: "Argent multisig not found" };
  }
  if (record.networkId !== active.networkId) {
    return { error: "switch to the multisig network first" };
  }
  const preferences = await deps.preferencesStore.read();
  return {
    active,
    record,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences),
  };
};

const sameConfig = (
  left: ArgentMultisigSigningIntent["configSnapshot"],
  right: ArgentMultisigConfig,
): boolean =>
  left.classHash === right.classHash &&
  left.threshold === right.threshold &&
  left.signerGuids.length === right.signerGuids.length &&
  left.signerGuids.every((guid, index) => guid === right.signerGuids[index]);

const currentIntentContext = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  markStale = true,
): Promise<
  | {
      readonly config: Awaited<ReturnType<typeof currentConfigFor>>;
      readonly context: ArgentMultisigContext;
    }
  | { readonly error: string }
> => {
  const context = await contextForIntent(deps, intent);
  if ("error" in context) {
    return context;
  }
  try {
    const config = await currentConfigFor(deps, context);
    if (!sameConfig(intent.configSnapshot, config.chain)) {
      if (markStale) await deps.multisigStore.upsertIntent({ ...intent, state: "stale" });
      return { error: "Argent multisig intent is stale after a configuration change" };
    }
    const nonce = await multisigRpc(deps).getNonce({
      address: context.record.address,
      rpcUrls: context.rpcUrls,
    });
    if (!sameFelt(nonce, intent.prepared.nonce)) {
      if (markStale) await deps.multisigStore.upsertIntent({ ...intent, state: "stale" });
      return { error: "Argent multisig intent nonce is no longer current" };
    }
    return { config, context };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Argent multisig config unavailable" };
  }
};

const sortedSignatures = (values: readonly StarkSignature[]): readonly StarkSignature[] =>
  [...values].sort((left, right) =>
    BigInt(argentSignerGuid(left.publicKey)) < BigInt(argentSignerGuid(right.publicKey)) ? -1 : 1,
  );

const withSignature = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  signature: StarkSignature,
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
  const stored = await deps.multisigStore.upsertIntent(next);
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
    summary: resolved.review?.summary ?? input.summary,
  };
  const stored = await deps.multisigStore.upsertIntent(intent);
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
  const { intent } = input.package;
  const reviewed = await importedIntentReview(deps, intent);
  if ("error" in reviewed || !authorized.isCurrent()) {
    return "error" in reviewed ? reviewed : { error: "wallet locked" };
  }
  if (!authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  const stored = await deps.multisigStore.upsertIntent(intent);
  return stored === "stored"
    ? {
        feeReview: preparedArgentMultisigFee(intent.prepared),
        intent,
        intentPackage: input.package,
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
  const resolved = await currentIntentContext(deps, intent);
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
  if (!resolved.config.chain.signerGuids.includes(guid)) {
    return { error: "selected account is not a current Argent multisig signer" };
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
  return { intent, operationId, resolved, signer } as const;
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
    const response = await withSignature(deps, signing.intent, signature);
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
  const resolved = await currentIntentContext(deps, intent);
  if ("error" in resolved || !authorized.isCurrent()) {
    return "error" in resolved ? resolved : { error: "wallet locked" };
  }
  return withSignature(deps, intent, input.signature);
};

type ResolvedSubmission =
  | { readonly response: RuntimeResponse }
  | {
      readonly intent: ArgentMultisigSigningIntent;
      readonly operationId: string;
      readonly resolved: Exclude<
        Awaited<ReturnType<typeof currentIntentContext>>,
        { error: string }
      >;
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
    const existing = await deps.multisigStore.getOperation(operationId);
    return {
      response: existing?.transactionHash
        ? { intent, ok: true, transactionHash: existing.transactionHash }
        : { error: "Argent multisig submission outcome is unresolved" },
    };
  }
  if (claim !== "claimed") {
    return { response: { error: `Argent multisig submission claim ${claim}` } };
  }
  const resolved = await currentIntentContext(deps, intent);
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
  return { intent, operationId, resolved };
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
        signerPublicKeys: submission.resolved.config.signerPublicKeys,
        threshold: submission.resolved.config.threshold,
      },
      prepared: submission.intent.prepared,
      rpcUrls: submission.resolved.context.rpcUrls,
      signatures: submission.intent.signatures,
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
