/**
 * Transaction-submitting multisig operations: propose, confirm, revoke,
 * execute, deploy a new multisig through the Universal Deployer Contract,
 * and declare the pinned multisig class when a network lacks it. Every
 * submission goes through the shared verified invoke path with the active
 * account's session signer; the multisig contract re-checks signer
 * membership and quorum on-chain, so these handlers can never bypass it.
 */
import {
  buildMultisigConfirmCall,
  buildMultisigExecuteCall,
  buildMultisigRevokeCall,
  buildMultisigSubmitCall,
  type MultisigCallInput,
  type MultisigProposalStatus,
} from "../starknet/multisig";
import {
  buildMultisigDeployCall,
  MULTISIG_CLASS_HASH,
  MULTISIG_COMPILED_CLASS_HASH,
  predictMultisigAddress,
  requireMultisigContractClass,
} from "../starknet/multisig-deploy";
import { STARKNET_NETWORKS } from "../starknet/networks";
import { verifyCalls } from "../starknet/verify";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  multisigProposalId,
} from "../storage/multisig-store";
import { readTypeOnlyInput } from "./message-inputs";
import {
  readDeployMultisigInput,
  readMultisigProposalActionInput,
  readProposeMultisigInput,
} from "./multisig-inputs";
import {
  type MultisigOpsDeps,
  multisigContext,
  multisigRpc,
  refreshSignerMembership,
} from "./multisig-ops";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { signerForContext, verificationContext } from "./wallet-ops";

const shortAddress = (address: string): string => `${address.slice(0, 8)}…${address.slice(-4)}`;

// Submits one call through the shared invoke path and records activity.
const submitAndRecord = async (
  deps: MultisigOpsDeps,
  resolved: Exclude<Awaited<ReturnType<typeof multisigContext>>, { readonly error: string }>,
  call: ReturnType<typeof buildMultisigConfirmCall>,
  summary: string,
): Promise<string> => {
  const preferences = await deps.preferencesStore.read();
  const report = verifyCalls([call], verificationContext(resolved.account.account, preferences));
  const result = await deps.runtimeRpc.submitInvokeTransaction({
    account: resolved.account.account,
    calls: [call],
    rpcUrls: resolved.rpcUrls,
    signHash: signerForContext(deps, resolved.account),
  });
  await deps.activity.record({
    accountId: resolved.account.account.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: resolved.account.networkId,
    summary: report.calls[0]?.summary ?? summary,
  });
  return result.transactionHash;
};

const proposalById = async (
  deps: MultisigOpsDeps,
  proposalId: string,
): Promise<
  | { readonly error: string }
  | {
      readonly proposal: MultisigProposalRecord;
      readonly resolved: Exclude<
        Awaited<ReturnType<typeof multisigContext>>,
        { readonly error: string }
      >;
    }
> => {
  const proposal = (await deps.multisigStore.listProposals()).find(
    (stored) => stored.id === proposalId,
  );
  if (!proposal) {
    return { error: "proposal not found" };
  }
  const resolved = await multisigContext(deps, proposal.multisigId);
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  const refreshed = await refreshSignerMembership(deps, resolved);
  if ("error" in refreshed) {
    return { error: refreshed.error };
  }
  return { proposal, resolved: refreshed };
};

const requireUntrackedVerification = (
  proposal: MultisigProposalRecord,
  untrackedVerified: boolean | undefined,
): string | null =>
  proposal.call === null && untrackedVerified !== true
    ? "verify this proposal on a block explorer or with the proposer, then acknowledge before confirming"
    : null;

const refreshAfterAction = async (
  deps: MultisigOpsDeps,
  record: MultisigRecord,
  proposal: MultisigProposalRecord,
  signer: string,
  rpcUrls: readonly string[],
): Promise<void> => {
  const status = await multisigRpc(deps)
    .getProposalStatus({ address: record.address, rpcUrls, signer, txId: proposal.txId })
    .catch(() => null);
  if (status) {
    await deps.multisigStore.upsertProposal({
      ...proposal,
      confirmations: status.confirmations,
      state: status.state,
    });
  }
};

type ResolvedProposal = {
  readonly proposal: MultisigProposalRecord;
  readonly resolved: Exclude<
    Awaited<ReturnType<typeof multisigContext>>,
    { readonly error: string }
  >;
};

const freshProposalStatus = async (
  deps: MultisigOpsDeps,
  found: ResolvedProposal,
): Promise<{ readonly error: string } | MultisigProposalStatus> => {
  let status: MultisigProposalStatus;
  try {
    status = await multisigRpc(deps).getProposalStatus({
      address: found.resolved.record.address,
      rpcUrls: found.resolved.rpcUrls,
      signer: found.resolved.account.account.address,
      txId: found.proposal.txId,
    });
  } catch {
    return { error: "could not refresh proposal status — try again" };
  }
  await deps.multisigStore.upsertProposal({
    ...found.proposal,
    confirmations: status.confirmations,
    state: status.state,
  });
  return status;
};

/**
 * Handles transaction-submitting multisig messages; returns null for other
 * message types.
 */
export const handleMultisigTxOps = async (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.proposeMultisigTx") {
    const input = readProposeMultisigInput(message);
    if (!input) {
      return { error: "invalid propose request" };
    }
    const resolved = await multisigContext(deps, input.multisigId);
    if ("error" in resolved) {
      return { error: resolved.error };
    }
    const refreshed = await refreshSignerMembership(deps, resolved);
    if ("error" in refreshed) {
      return { error: refreshed.error };
    }
    const call: MultisigCallInput = {
      calldata: input.calldata,
      contractAddress: input.to,
      entrypoint: input.entrypoint,
    };
    const txId = await multisigRpc(deps).computeTransactionId({
      address: refreshed.record.address,
      call,
      rpcUrls: refreshed.rpcUrls,
      salt: input.salt,
    });
    const id = multisigProposalId(refreshed.record.id, txId);
    if (!id) {
      return { error: "invalid propose request" };
    }
    const summary = input.summary ?? `${input.entrypoint} on ${shortAddress(input.to)}`;
    const transactionHash = await submitAndRecord(
      deps,
      refreshed,
      buildMultisigSubmitCall(refreshed.record.address, call, input.salt),
      `Propose: ${summary}`,
    );
    const proposal: MultisigProposalRecord = {
      call: {
        calldata: input.calldata,
        contractAddress: input.to,
        entrypoint: input.entrypoint,
        salt: input.salt,
      },
      confirmations: 0,
      id,
      multisigId: refreshed.record.id,
      state: "pending",
      summary,
      txId,
    };
    await deps.multisigStore.upsertProposal(proposal);
    const stored = (await deps.multisigStore.listProposals()).find((p) => p.id === proposal.id);
    if (!stored) {
      return { error: "could not store proposal — the multisig may have been removed" };
    }
    await refreshAfterAction(
      deps,
      refreshed.record,
      proposal,
      refreshed.account.account.address,
      refreshed.rpcUrls,
    );
    return { ok: true, proposal, transactionHash };
  }

  if (messageType === "wallet.confirmMultisigProposal") {
    const input = readMultisigProposalActionInput(message, "wallet.confirmMultisigProposal");
    if (!input) {
      return { error: "invalid confirm request" };
    }
    const found = await proposalById(deps, input.proposalId);
    if ("error" in found) {
      return { error: found.error };
    }
    const verifyError = requireUntrackedVerification(found.proposal, input.untrackedVerified);
    if (verifyError) {
      return { error: verifyError };
    }
    const status = await freshProposalStatus(deps, found);
    if ("error" in status) {
      return status;
    }
    if (status.state === "executed" || status.state === "not-found") {
      return { error: `cannot confirm a proposal that is ${status.state}` };
    }
    if (status.state === "confirmed") {
      return {
        error: "proposal already has quorum — execute it instead of adding more confirmations",
      };
    }
    if (status.confirmedBySigner) {
      return { error: "this account has already confirmed this proposal" };
    }
    const transactionHash = await submitAndRecord(
      deps,
      found.resolved,
      buildMultisigConfirmCall(found.resolved.record.address, found.proposal.txId),
      `Confirm: ${found.proposal.summary}`,
    );
    await refreshAfterAction(
      deps,
      found.resolved.record,
      found.proposal,
      found.resolved.account.account.address,
      found.resolved.rpcUrls,
    );
    return { ok: true, transactionHash };
  }

  if (messageType === "wallet.revokeMultisigConfirmation") {
    const input = readMultisigProposalActionInput(message, "wallet.revokeMultisigConfirmation");
    if (!input) {
      return { error: "invalid revoke request" };
    }
    const found = await proposalById(deps, input.proposalId);
    if ("error" in found) {
      return { error: found.error };
    }
    const verifyError = requireUntrackedVerification(found.proposal, input.untrackedVerified);
    if (verifyError) {
      return { error: verifyError };
    }
    const status = await freshProposalStatus(deps, found);
    if ("error" in status) {
      return status;
    }
    if (status.state === "executed" || status.state === "not-found") {
      return { error: `cannot revoke a proposal that is ${status.state}` };
    }
    if (!status.confirmedBySigner) {
      return { error: "this account has not confirmed this proposal" };
    }
    const transactionHash = await submitAndRecord(
      deps,
      found.resolved,
      buildMultisigRevokeCall(found.resolved.record.address, found.proposal.txId),
      `Revoke confirmation: ${found.proposal.summary}`,
    );
    await refreshAfterAction(
      deps,
      found.resolved.record,
      found.proposal,
      found.resolved.account.account.address,
      found.resolved.rpcUrls,
    );
    return { ok: true, transactionHash };
  }

  if (messageType === "wallet.executeMultisigProposal") {
    const input = readMultisigProposalActionInput(message, "wallet.executeMultisigProposal");
    if (!input) {
      return { error: "invalid execute request" };
    }
    const found = await proposalById(deps, input.proposalId);
    if ("error" in found) {
      return { error: found.error };
    }
    if (!found.proposal.call) {
      return {
        error:
          "this proposal was tracked by id only; executing needs the original call, so execute it from the wallet that proposed it",
      };
    }
    const status = await freshProposalStatus(deps, found);
    if ("error" in status) {
      return status;
    }
    if (status.state !== "confirmed") {
      return { error: `cannot execute a proposal that is ${status.state}` };
    }
    const transactionHash = await submitAndRecord(
      deps,
      found.resolved,
      buildMultisigExecuteCall(
        found.resolved.record.address,
        {
          calldata: found.proposal.call.calldata,
          contractAddress: found.proposal.call.contractAddress,
          entrypoint: found.proposal.call.entrypoint,
        },
        found.proposal.call.salt,
      ),
      `Execute: ${found.proposal.summary}`,
    );
    await refreshAfterAction(
      deps,
      found.resolved.record,
      found.proposal,
      found.resolved.account.account.address,
      found.resolved.rpcUrls,
    );
    return { ok: true, transactionHash };
  }

  if (messageType === "wallet.multisigClassStatus") {
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
    return { declared, ok: true };
  }

  if (messageType === "wallet.declareMultisigClass") {
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
    const preferences = await deps.preferencesStore.read();
    const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
    if (await multisigRpc(deps).isClassDeclared({ rpcUrls })) {
      return { error: "multisig class is already declared on this network" };
    }
    const activities = await deps.activity.list();
    const hasPendingDeclare = activities.some(
      (entry) =>
        entry.accountId === context.account.id &&
        entry.networkId === context.networkId &&
        entry.summary === "Declare multisig class" &&
        entry.status === "pending",
    );
    if (hasPendingDeclare) {
      return { error: "a declare transaction is already pending — wait for it to complete" };
    }
    const contractClass = requireMultisigContractClass(await deps.loadMultisigClass());
    const result = await deps.runtimeRpc.submitDeclareTransaction({
      account: context.account,
      classHash: MULTISIG_CLASS_HASH,
      compiledClassHash: MULTISIG_COMPILED_CLASS_HASH,
      contractClass,
      rpcUrls,
      signHash: signerForContext(deps, context),
    });
    await deps.activity.record({
      accountId: context.account.id,
      hash: result.transactionHash,
      kind: "invoke",
      networkId: context.networkId,
      summary: "Declare multisig class",
    });
    return { ok: true, transactionHash: result.transactionHash };
  }

  if (messageType === "wallet.deployMultisig") {
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
    let occupied: boolean;
    try {
      occupied = await deps.runtimeRpc.getDeploymentStatus({ accountAddress: address, rpcUrls });
    } catch {
      return {
        error: "could not verify whether this multisig address is free — try again",
      };
    }
    if (occupied) {
      return { error: "a multisig with these signers and salt already exists — watch it instead" };
    }
    const activities = await deps.activity.list();
    const addressSuffix = address.slice(-12);
    const hasPendingDeploy = activities.some(
      (entry) =>
        entry.accountId === context.account.id &&
        entry.networkId === context.networkId &&
        entry.summary.includes(addressSuffix) &&
        entry.status === "pending",
    );
    if (hasPendingDeploy) {
      return {
        error:
          "a deploy transaction for this multisig configuration is already pending — wait for it to complete",
      };
    }
    const call = buildMultisigDeployCall(config);
    const report = verifyCalls([call], verificationContext(context.account, preferences));
    const result = await deps.runtimeRpc.submitInvokeTransaction({
      account: context.account,
      calls: [call],
      rpcUrls,
      signHash: signerForContext(deps, context),
    });
    await deps.activity.record({
      accountId: context.account.id,
      hash: result.transactionHash,
      kind: "invoke",
      networkId: context.networkId,
      summary:
        report.calls[0]?.summary ??
        `Deploy multisig (${input.quorum} of ${input.signers.length}) at ${shortAddress(address)}`,
    });
    return { address, ok: true, transactionHash: result.transactionHash };
  }

  return null;
};
