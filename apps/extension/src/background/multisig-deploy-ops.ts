/**
 * Multisig class declaration and UDC deployment handlers. Both operations
 * persist an atomic claim before broadcast, then retain the returned hash
 * independently of capped activity history so duplicate fee-paying requests
 * fail closed across panels and service-worker restarts.
 */

import { canonicalFelt, STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import {
  buildMultisigDeployCall,
  MULTISIG_CLASS_HASH,
  MULTISIG_COMPILED_CLASS_HASH,
  predictMultisigAddress,
  requireMultisigContractClass,
} from "@mc-wallet/multisig/deploy";
import { isUnresolvedActivityStatus } from "@mc-wallet/transactions/activity";
import { type MultisigRecord, multisigId, multisigOperationId } from "@mc-wallet/multisig/repository";
import { readTypeOnlyInput } from "./message-inputs";
import { readDeployMultisigInput } from "./multisig-inputs";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-ops";
import {
  claimMultisigOperation,
  clearCompletedMultisigOperation,
  recordClaimedMultisigSubmission,
  releaseMultisigOperation,
} from "./multisig-submission";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { signerForContext } from "./wallet-ops";

type MultisigDeployHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;

const multisigClassStatus: MultisigDeployHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.multisigClassStatus")) {
    return { error: "invalid class status request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const preferences = await deps.preferencesStore.read();
  const declared = await multisigRpc(deps).isClassDeclared({
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
  });
  const operationId = multisigOperationId(
    "declare",
    context.networkId,
    context.account.id,
    MULTISIG_CLASS_HASH,
  );
  if (declared) {
    if (operationId) {
      await releaseMultisigOperation(deps, operationId);
    }
    return { declarationPending: false, declared: true, ok: true };
  }
  const operation = operationId ? await deps.multisigStore.getOperation(operationId) : null;
  if (operation?.transactionHash) {
    const activity = (await deps.activity.list().catch(() => [])).find(
      (entry) =>
        entry.accountId === context.account.id &&
        entry.networkId === context.networkId &&
        entry.hash === operation.transactionHash,
    );
    if (activity?.status === "rejected" || activity?.status === "reverted") {
      await releaseMultisigOperation(deps, operation.id);
      return { declarationPending: false, declared: false, ok: true };
    }
  }
  return {
    declarationPending: operation !== null,
    declared: false,
    ok: true,
    ...(operation?.transactionHash ? { transactionHash: operation.transactionHash } : {}),
  };
};

const declareMultisigClass: MultisigDeployHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.declareMultisigClass")) {
    return { error: "invalid declare request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  if (!deps.loadMultisigClass) {
    return { error: "multisig class artifact unavailable" };
  }
  const operationKey = {
    accountId: context.account.id,
    kind: "declare" as const,
    networkId: context.networkId,
    target: MULTISIG_CLASS_HASH,
  };
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  if (await multisigRpc(deps).isClassDeclared({ rpcUrls })) {
    await clearCompletedMultisigOperation(deps, operationKey);
    return { error: "multisig class is already declared on this network" };
  }
  const activities = await deps.activity.list();
  if (
    activities.some(
      (entry) =>
        entry.accountId === context.account.id &&
        entry.networkId === context.networkId &&
        entry.summary === "Declare multisig class" &&
        isUnresolvedActivityStatus(entry.status),
    )
  ) {
    return { error: "a declare transaction is already pending — wait for it to complete" };
  }
  const contractClass = requireMultisigContractClass(await deps.loadMultisigClass());
  const claim = await claimMultisigOperation(deps, {
    ...operationKey,
    pendingError: "a declare transaction is already unresolved — wait for it to settle",
  });
  if ("error" in claim) {
    return claim;
  }
  let result: { readonly transactionHash: string };
  try {
    result = await deps.runtimeRpc.submitDeclareTransaction({
      account: context.account,
      classHash: MULTISIG_CLASS_HASH,
      compiledClassHash: MULTISIG_COMPILED_CLASS_HASH,
      contractClass,
      rpcUrls,
      signHash: signerForContext(deps, context),
    });
  } catch (error) {
    await releaseMultisigOperation(deps, claim.operationId);
    throw error;
  }
  await recordClaimedMultisigSubmission(deps, claim.operationId, {
    accountId: context.account.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: context.networkId,
    summary: "Declare multisig class",
  });
  return { ok: true, transactionHash: result.transactionHash };
};

const deployMultisig: MultisigDeployHandler = async (deps, message) => {
  const input = readDeployMultisigInput(message);
  if (!input) {
    return { error: "invalid deploy multisig request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  if (!(await multisigRpc(deps).isClassDeclared({ rpcUrls }))) {
    return { error: "multisig class not declared on this network — declare it first" };
  }
  const config = { quorum: input.quorum, salt: input.salt, signers: input.signers };
  const address = predictMultisigAddress(config);
  const canonicalAddress = canonicalFelt(address);
  const id = multisigId(context.networkId, address);
  if (!canonicalAddress || !id) {
    return { error: "could not derive a valid multisig address" };
  }
  const record: MultisigRecord = {
    address: canonicalAddress,
    id,
    networkId: context.networkId,
    quorum: input.quorum,
    signers: input.signers.map((signer) => canonicalFelt(signer) ?? signer),
  };
  const operationKey = {
    accountId: context.account.id,
    kind: "deploy" as const,
    networkId: context.networkId,
    target: address,
  };
  let occupied: boolean;
  try {
    occupied = await deps.runtimeRpc.getDeploymentStatus({ accountAddress: address, rpcUrls });
  } catch {
    return { error: "could not verify whether this multisig address is free — try again" };
  }
  if (occupied) {
    await clearCompletedMultisigOperation(deps, operationKey);
    return { error: "a multisig with these signers and salt already exists — watch it instead" };
  }
  const deployMarker = ` at ${address}`;
  const activities = await deps.activity.list();
  if (
    activities.some(
      (entry) =>
        entry.accountId === context.account.id &&
        entry.networkId === context.networkId &&
        entry.summary.includes(deployMarker) &&
        isUnresolvedActivityStatus(entry.status),
    )
  ) {
    return {
      error:
        "a deploy transaction for this multisig configuration is already pending — wait for it to complete",
    };
  }
  const claim = await claimMultisigOperation(deps, {
    ...operationKey,
    pendingError:
      "a deploy transaction for this multisig configuration is already unresolved — wait for it to settle",
  });
  if ("error" in claim) {
    return claim;
  }
  let result: { readonly transactionHash: string };
  try {
    result = await deps.runtimeRpc.submitInvokeTransaction({
      account: context.account,
      calls: [buildMultisigDeployCall(config)],
      rpcUrls,
      signHash: signerForContext(deps, context),
    });
  } catch (error) {
    await releaseMultisigOperation(deps, claim.operationId);
    throw error;
  }
  await recordClaimedMultisigSubmission(deps, claim.operationId, {
    accountId: context.account.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: context.networkId,
    summary: `Deploy multisig (${input.quorum} of ${input.signers.length})${deployMarker}`,
  });
  // The predicted address and constructor configuration are deterministic, so
  // the wallet can watch the submitted deployment immediately. This is local
  // bookkeeping only: every signer-gated action still re-reads the contract
  // on-chain and fails closed until deployment is actually available.
  const tracked = await deps.multisigStore.upsertMultisig(record).then(
    () => true,
    () => false,
  );
  return { address: canonicalAddress, ok: true, tracked, transactionHash: result.transactionHash };
};

const DEPLOY_HANDLERS: Readonly<Record<string, MultisigDeployHandler>> = {
  "wallet.declareMultisigClass": declareMultisigClass,
  "wallet.deployMultisig": deployMultisig,
  "wallet.multisigClassStatus": multisigClassStatus,
};

/**
 * Handles declaration/deployment messages and returns null for other types.
 */
export const handleMultisigDeployOps = async (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = DEPLOY_HANDLERS[messageType];
  return handler ? handler(deps, message) : null;
};
