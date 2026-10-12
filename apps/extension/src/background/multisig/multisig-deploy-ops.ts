/**
 * Reviewed DEPLOY_ACCOUNT orchestration for stable Argent Multisig 0.2.
 */
import { type ArgentMultisigRecord, argentMultisigOperationId } from "@bramble/multisig/repository";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@bramble/starknet/account-contracts";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { resolveFeeAffordability } from "@bramble/transactions/fee-funds";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import { signerForContext } from "../accounts/wallet-ops";
import { readTypeOnlyInput } from "../routing/message-inputs";
import {
  activeAccountContext,
  networkRpcUrls,
  observedAccountContext,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { recordSubmittedActivity } from "../transactions/activity-recording";
import { readStrkBalance } from "../transactions/fee-guard";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-deps";
import {
  type ArgentMultisigDeploymentReview,
  readDeployMultisigInput,
  readReviewDeploymentInput,
} from "./multisig-inputs";
import { resolveArgentDeployment } from "./multisig-operation-recovery";
import { storedMultisigView } from "./multisig-view-state";

type DeployableArgentRecord = ArgentMultisigRecord & {
  readonly deployment: NonNullable<ArgentMultisigRecord["deployment"]>;
};

const ALREADY_DEPLOYED_ERROR = "Argent multisig is already deployed";

const isAlreadyDeployedError = (error: unknown): boolean =>
  /already deployed/i.test(error instanceof Error ? error.message : String(error));

const recordForReview = (review: ArgentMultisigDeploymentReview): DeployableArgentRecord => ({
  accountContractType: "argent-multisig",
  address: review.address,
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  deployment: {
    salt: review.salt,
    signerPublicKeys: review.signerPublicKeys,
    threshold: review.threshold,
  },
  id: `${review.networkId}:${review.address}`,
  ...(review.name === undefined ? {} : { name: review.name }),
  networkId: review.networkId,
});

const checkedDeploymentRecord = async (
  review: ArgentMultisigDeploymentReview,
): Promise<DeployableArgentRecord | null> => {
  const { predictArgentMultisigAddress } = await import("@bramble/multisig/deploy");
  const address = predictArgentMultisigAddress(review);
  return sameFelt(address, review.address) && address === review.address
    ? recordForReview(review)
    : null;
};

// A recorded deployment the chain refused or reverted frees its address once
// the chain also reports nothing deployed there. Without this the stored hash
// answered every retry with "submitted" for a deployment that never happened
// (Sherlock 197). A pending, accepted or unknown entry, or a failed read,
// keeps the hash: a not-yet-visible deployment must never be sent twice.
const hashedDeploymentFailed = async (
  deps: MultisigOpsDeps,
  record: DeployableArgentRecord,
  transactionHash: string,
): Promise<boolean> => {
  const entry = (await deps.activity.list()).find(
    (candidate) =>
      candidate.accountId === record.id &&
      candidate.networkId === record.networkId &&
      sameFelt(candidate.hash, transactionHash),
  );
  if (entry?.status !== "rejected" && entry?.status !== "reverted") return false;
  const preferences = await deps.preferencesStore.read();
  const deployed = await deps.runtimeRpc
    .getDeploymentStatus({
      accountAddress: record.address,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences),
    })
    .catch(() => null);
  return deployed === false;
};

const claimDeployment = async (
  deps: MultisigOpsDeps,
  record: DeployableArgentRecord,
  isAuthorized: () => boolean,
): Promise<RuntimeResponse | string> => {
  const stored = await deps.multisigStore.upsertMultisig(record, isAuthorized);
  if (stored === "unauthorized") return { error: "wallet locked" };
  if (stored !== "stored") {
    return { error: `Argent multisig registry ${stored}` };
  }
  const operationId = argentMultisigOperationId("deploy", record.id, record.address);
  if (!operationId) {
    return { error: "invalid Argent multisig deployment operation" };
  }
  const claim = await deps.multisigStore.claimOperation({
    accountId: record.id,
    id: operationId,
    kind: "deploy",
    target: record.address,
  });
  if (claim !== "exists") {
    return claim === "claimed"
      ? operationId
      : { error: `Argent multisig deployment claim ${claim}` };
  }
  const existing = await deps.multisigStore.getOperation(operationId);
  if (existing?.transactionHash) {
    if (await hashedDeploymentFailed(deps, record, existing.transactionHash)) {
      return reclaimDeployment(deps, record, operationId);
    }
    return {
      address: record.address,
      multisig: storedMultisigView(record, true),
      ok: true,
      transactionHash: existing.transactionHash,
    };
  }
  return resolveClaimedDeployment(deps, record, operationId);
};

/**
 * Settles a deployment whose claim already exists but carries no hash — the
 * state a lost submit response leaves behind. Returns the operation id when the
 * caller may broadcast, or a terminal response.
 */
const resolveClaimedDeployment = async (
  deps: MultisigOpsDeps,
  record: DeployableArgentRecord,
  operationId: string,
): Promise<RuntimeResponse | string> => {
  const resolution = await resolveArgentDeployment(deps, record, operationId);
  if (resolution.kind === "unknown") {
    return { error: "Argent multisig deployment outcome is unresolved" };
  }
  if (resolution.kind === "deployed") {
    // Deployed with no hash to record: the claim guards nothing any more, and
    // left in place it would block removing this multisig (Sherlock 197).
    if (resolution.transactionHash === null) {
      await deps.multisigStore.releaseOperation(operationId).catch(() => {});
    }
    return {
      address: record.address,
      multisig: storedMultisigView(record, true),
      ok: true,
      ...(resolution.transactionHash === null
        ? {}
        : { transactionHash: resolution.transactionHash }),
    };
  }
  // The chain is certain nothing was deployed at this deterministic address, so
  // the claim guards nothing: release it and take a fresh one so THIS attempt
  // broadcasts. Without it a single lost response burned the address
  // permanently, because a deploy's hash is only ever recovered from local
  // evidence that a lost response never produced.
  return reclaimDeployment(deps, record, operationId);
};

// Releases a claim that guards nothing and retakes it for this attempt.
// Re-claiming keeps the guard intact for the new attempt; if it cannot be
// retaken, nothing is sent.
const reclaimDeployment = async (
  deps: MultisigOpsDeps,
  record: DeployableArgentRecord,
  operationId: string,
): Promise<RuntimeResponse | string> => {
  await deps.multisigStore.releaseOperation(operationId).catch(() => {});
  const reclaimed = await deps.multisigStore.claimOperation({
    accountId: record.id,
    id: operationId,
    kind: "deploy",
    target: record.address,
  });
  return reclaimed === "claimed"
    ? operationId
    : { error: "Argent multisig deployment did not reach the network. Try again." };
};

const deploymentContext = async (
  deps: MultisigOpsDeps,
  input: Omit<ArgentMultisigDeploymentReview, "address" | "fee" | "feeAffordability">,
) => {
  const authorized = captureSessionAuthorization(deps.session);
  const active = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (active.error !== undefined || !authorized.isCurrent()) {
    return { error: active.error ?? "wallet locked" } as const;
  }
  if (active.networkId !== input.networkId) {
    return { error: "switch to the deployment network first" } as const;
  }
  const signer = active.accounts.find(
    (account) => account.id === input.signerAccountId && account.networkId === input.networkId,
  );
  if (!signer) {
    return { error: "selected signer account is unavailable on this network" } as const;
  }
  const signerGuid = argentSignerGuid(signer.publicKeyX);
  if (!input.signerPublicKeys.map(argentSignerGuid).includes(signerGuid)) {
    return { error: "selected signer is not a member of the reviewed constructor" } as const;
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[input.networkId], preferences);
  if (!(await multisigRpc(deps).isClassDeclared({ rpcUrls }))) {
    return { error: "stable Argent Multisig 0.2 class is not declared on this network" } as const;
  }
  return { active, authorized, preferences, rpcUrls, signer } as const;
};

type DeploymentEstimate = NonNullable<
  MultisigOpsDeps["runtimeRpc"]["estimateAccountDeploymentFee"]
>;

const deploymentFeeForReview = async (
  deps: MultisigOpsDeps,
  input: Parameters<DeploymentEstimate>[0],
  isCurrent: () => boolean,
): Promise<
  { readonly error: string } | { readonly fee: Awaited<ReturnType<DeploymentEstimate>> }
> => {
  const estimate = deps.runtimeRpc.estimateAccountDeploymentFee;
  if (!estimate) return { error: "Argent multisig deployment review unavailable" };
  const deployed = await deps.runtimeRpc
    .getDeploymentStatus({ accountAddress: input.account.address, rpcUrls: input.rpcUrls })
    .catch(() => false);
  if (!isCurrent()) return { error: "wallet locked" };
  if (deployed) return { error: ALREADY_DEPLOYED_ERROR };
  try {
    return { fee: await estimate(input) };
  } catch (error) {
    if (isAlreadyDeployedError(error)) return { error: ALREADY_DEPLOYED_ERROR };
    throw error;
  }
};

const reviewDeployment = async (
  deps: MultisigOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readReviewDeploymentInput(message);
  if (!input) {
    return { error: "invalid Argent multisig deployment review request" };
  }
  const { expectedAddress, ...setup } = input;
  const address = (await import("@bramble/multisig/deploy")).predictArgentMultisigAddress(setup);
  if (expectedAddress !== undefined && !sameFelt(address, expectedAddress)) {
    return {
      error: "Signer set, threshold, and salt do not reproduce the watched multisig address",
    };
  }
  const context = await deploymentContext(deps, setup);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const reviewBase = { ...setup, address };
  const account = recordForReview({
    ...reviewBase,
    fee: { overallFee: "0", unit: "FRI" },
    feeAffordability: "unknown",
  });
  const estimated = await deploymentFeeForReview(
    deps,
    {
      account,
      rpcUrls: context.rpcUrls,
      signHash: signerForContext(deps, {
        account: context.signer,
        vaultPassphrase: context.active.vaultPassphrase,
      }),
    },
    context.authorized.isCurrent,
  );
  if ("error" in estimated) return estimated;
  const { fee } = estimated;
  if (!context.authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  const feeAffordability = resolveFeeAffordability({
    balance: await readStrkBalance(
      deps,
      { address, networkId: setup.networkId },
      context.preferences,
    ),
    fee,
  });
  if (!context.authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  const deploymentReview = { ...reviewBase, fee, feeAffordability };
  const stored = await deps.multisigStore.upsertMultisig(
    recordForReview(deploymentReview),
    context.authorized.isCurrent,
  );
  if (stored === "unauthorized") {
    return { error: "wallet locked" };
  }
  if (stored !== "stored") {
    return { error: `Argent multisig registry ${stored}` };
  }
  if (feeAffordability !== "insufficient") {
    try {
      await deps.multisigDeploymentReviews.put(deploymentReview);
    } catch {
      return { error: "Argent multisig deployment review unavailable" };
    }
  }
  return { deploymentReview, ok: true };
};

const submitDeployment = async (
  deps: MultisigOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readDeployMultisigInput(message);
  if (!input) {
    return { error: "invalid Argent multisig deployment request" };
  }
  const { review } = input;
  if (review.feeAffordability === "insufficient") {
    return { error: "Argent multisig deployment address needs STRK before deployment" };
  }
  const record = await checkedDeploymentRecord(review);
  if (!record) {
    return { error: "Argent multisig deployment review address mismatch" };
  }
  const context = await deploymentContext(deps, review);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  let reviewAvailable = false;
  try {
    reviewAvailable = await deps.multisigDeploymentReviews.take(review);
  } catch {
    return { error: "Argent multisig deployment review unavailable" };
  }
  if (!reviewAvailable) {
    return { error: "Argent multisig deployment must exactly match a fresh fee review" };
  }
  const claimed = await claimDeployment(deps, record, context.authorized.isCurrent);
  if (typeof claimed !== "string") {
    return claimed;
  }
  if (!context.authorized.isCurrent()) {
    await deps.multisigStore.releaseOperation(claimed);
    return { error: "wallet locked" };
  }
  let transactionHash: string;
  try {
    const submitted = await deps.runtimeRpc.submitAccountDeployment({
      account: record,
      reviewedFee: review.fee,
      rpcUrls: context.rpcUrls,
      signHash: signerForContext(deps, {
        account: context.signer,
        vaultPassphrase: context.active.vaultPassphrase,
      }),
      isAuthorized: context.authorized.isCurrent,
    });
    transactionHash = submitted.transactionHash;
  } catch (error) {
    if (!(error instanceof IndeterminateRpcWriteError)) {
      await deps.multisigStore.releaseOperation(claimed);
    }
    throw error;
  }
  // The durable pre-write claim prevents a second deployment even if this
  // post-broadcast journal write fails; the known hash is still returned.
  await deps.multisigStore.setOperationHash(claimed, transactionHash).catch(() => {});
  await recordSubmittedActivity(deps.activity, {
    accountId: record.id,
    hash: transactionHash,
    kind: "deploy",
    networkId: record.networkId,
    summary: `Deploy Argent multisig ${record.name ?? record.address}`,
  });
  return {
    address: record.address,
    multisig: storedMultisigView(record, true),
    ok: true,
    transactionHash,
  };
};

const classStatus = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  if (!readTypeOnlyInput(message, "wallet.argentMultisigClassStatus")) {
    return { error: "invalid Argent multisig class-status request" };
  }
  const active = await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (active.error !== undefined) {
    return active;
  }
  const preferences = await deps.preferencesStore.read();
  const declared = await multisigRpc(deps).isClassDeclared({
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[active.networkId], preferences),
  });
  return { declared, ok: true };
};

type DeployHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;
const HANDLERS: Readonly<Record<string, DeployHandler>> = {
  "wallet.argentMultisigClassStatus": classStatus,
  "wallet.deployArgentMultisig": submitDeployment,
  "wallet.reviewArgentMultisigDeployment": reviewDeployment,
};

/**
 * Dispatches deployment-only Argent multisig messages.
 */
export const handleMultisigDeployOps = async (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(HANDLERS, messageType) ? HANDLERS[messageType] : undefined;
  return handler ? handler(deps, message) : null;
};
