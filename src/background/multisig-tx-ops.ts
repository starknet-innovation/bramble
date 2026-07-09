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
  multisigId,
  multisigProposalId,
} from "../storage/multisig-store";
import { readTypeOnlyInput } from "./message-inputs";
import {
  readDeployMultisigInput,
  readMultisigProposalActionInput,
  readProposeMultisigInput,
} from "./multisig-inputs";
import { type MultisigOpsDeps, multisigContext, multisigRpc, sameFelt } from "./multisig-ops";
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

const requireSigner = (
  resolved: Exclude<Awaited<ReturnType<typeof multisigContext>>, { readonly error: string }>,
): string | null =>
  resolved.record.signers.some((signer) => sameFelt(signer, resolved.account.account.address))
    ? null
    : "the active account is not a signer of this multisig";

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
  const notSigner = requireSigner(resolved);
  if (notSigner) {
    return { error: notSigner };
  }
  return { proposal, resolved };
};

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
    const notSigner = requireSigner(resolved);
    if (notSigner) {
      return { error: notSigner };
    }
    const call: MultisigCallInput = {
      calldata: input.calldata,
      contractAddress: input.to,
      entrypoint: input.entrypoint,
    };
    const txId = await multisigRpc(deps).computeTransactionId({
      address: resolved.record.address,
      call,
      rpcUrls: resolved.rpcUrls,
      salt: input.salt,
    });
    const summary = input.summary ?? `${input.entrypoint} on ${shortAddress(input.to)}`;
    const transactionHash = await submitAndRecord(
      deps,
      resolved,
      buildMultisigSubmitCall(resolved.record.address, call, input.salt),
      `Propose: ${summary}`,
    );
    const id = multisigProposalId(resolved.record.id, txId);
    if (!id) {
      return { error: "invalid propose request" };
    }
    const proposal: MultisigProposalRecord = {
      call: {
        calldata: input.calldata,
        contractAddress: input.to,
        entrypoint: input.entrypoint,
        salt: input.salt,
      },
      confirmations: 0,
      id,
      multisigId: resolved.record.id,
      state: "pending",
      summary,
      txId,
    };
    await deps.multisigStore.upsertProposal(proposal);
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
    const contractClass = requireMultisigContractClass(await deps.loadMultisigClass());
    const preferences = await deps.preferencesStore.read();
    const result = await deps.runtimeRpc.submitDeclareTransaction({
      account: context.account,
      classHash: MULTISIG_CLASS_HASH,
      compiledClassHash: MULTISIG_COMPILED_CLASS_HASH,
      contractClass,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
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
    const occupied = await deps.runtimeRpc
      .getDeploymentStatus({ accountAddress: address, rpcUrls })
      .catch(() => false);
    if (occupied) {
      return { error: "a multisig with these signers and salt already exists — watch it instead" };
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
        report.calls[0]?.summary ?? `Deploy multisig (${input.quorum} of ${input.signers.length})`,
    });
    const id = multisigId(context.networkId, address);
    if (id) {
      const record: MultisigRecord = {
        address: `0x${BigInt(address).toString(16)}`,
        id,
        ...(input.name === undefined ? {} : { name: input.name }),
        networkId: context.networkId,
        quorum: input.quorum,
        signers: input.signers.map((signer) => `0x${BigInt(signer).toString(16)}`),
      };
      await deps.multisigStore.upsertMultisig(record);
    }
    return { address, ok: true, transactionHash: result.transactionHash };
  }

  return null;
};
