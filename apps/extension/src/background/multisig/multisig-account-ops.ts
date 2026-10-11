/** Removal and balance operations for one resolved Argent multisig account. */
import type {
  ArgentMultisigOperationRecord,
  ArgentMultisigRecord,
} from "@bramble/multisig/repository";
import type { TokenBalance } from "@bramble/starknet/rpc";
import { systemClock } from "@bramble/transactions/activity";
import { sameFelt } from "@bramble/wallet-model/networks";
import { cachedBalances } from "../portfolio/balance-snapshots";
import { readPortfolioBalances } from "../portfolio/portfolio-balances";
import { activeAccountContext, observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { type ArgentMultisigContext, contextFor } from "./multisig-context";
import type { MultisigOpsDeps } from "./multisig-deps";
import {
  readMultisigBalancesInput,
  readRemoveIntentInput,
  readRemoveMultisigInput,
} from "./multisig-inputs";
import { resolveArgentDeployment } from "./multisig-operation-recovery";

const removeIntent = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const input = readRemoveIntentInput(message);
  if (!input) return { error: "invalid Argent multisig intent removal request" };
  const authorized = captureSessionAuthorization(deps.session);
  const result = await deps.multisigStore.removeIntent(input.intentId, authorized.isCurrent);
  return result === "removed"
    ? { ok: true }
    : { error: result === "missing" ? "Argent multisig intent not found" : "wallet locked" };
};

/**
 * Refusal when removing a multisig whose deployment this record alone can
 * reproduce. Answered until the caller confirms with `confirmHistoryRemoval`.
 */
export const UNDEPLOYED_REMOVAL_UNCONFIRMED = "confirm removal of an undeployed Argent multisig";

// A record that carries a deployment commitment and is not deployed holds the
// only copy of the salt, signer set and threshold behind its counterfactual
// address: the chain has no record of it yet. Removing it then needs the same
// confirmation as deleting history (Sherlock 214). A failed read counts as not
// deployed, which costs one extra press rather than a silent loss.
const holdsUndeployedCommitment = async (
  deps: MultisigOpsDeps,
  context: ArgentMultisigContext,
): Promise<boolean> => {
  if (context.record.deployment === undefined) return false;
  const deployed = await deps.runtimeRpc
    .getDeploymentStatus({ accountAddress: context.record.address, rpcUrls: context.rpcUrls })
    .catch(() => false);
  return !deployed;
};

// Why an unconfirmed removal must wait for a second press, if it must.
const unconfirmedRemoval = async (
  deps: MultisigOpsDeps,
  context: ArgentMultisigContext,
  hasHistory: boolean,
): Promise<string | null> => {
  if (await holdsUndeployedCommitment(deps, context)) return UNDEPLOYED_REMOVAL_UNCONFIRMED;
  return hasHistory ? "confirm removal of terminal Argent multisig history" : null;
};

// A deployment claim a lost reply left without a hash blocks removal until it
// is settled. It is settled here as a retried deployment would settle it: a
// hash found locally is recorded, and a claim the chain shows to guard nothing
// (nothing deployed, or deployed with no hash to keep) is released. Only an
// unreadable chain leaves it unresolved (Sherlock 197).
const settledOperations = async (
  deps: MultisigOpsDeps,
  record: ArgentMultisigRecord,
): Promise<readonly ArgentMultisigOperationRecord[]> => {
  const ownOperations = async () =>
    (await deps.multisigStore.listOperations()).filter(
      (operation) => operation.accountId === record.id,
    );
  for (const operation of await ownOperations()) {
    if (operation.kind !== "deploy" || operation.transactionHash !== undefined) continue;
    const resolution = await resolveArgentDeployment(deps, record, operation.id);
    if (
      resolution.kind === "absent" ||
      (resolution.kind === "deployed" && resolution.transactionHash === null)
    ) {
      await deps.multisigStore.releaseOperation(operation.id).catch(() => {});
    }
  }
  return ownOperations();
};

const removeMultisig = async (
  deps: MultisigOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readRemoveMultisigInput(message);
  if (!input) return { error: "invalid Argent multisig removal request" };
  const authorized = captureSessionAuthorization(deps.session);
  const context = await contextFor(
    deps,
    await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    input.multisigId,
  );
  if ("error" in context || !authorized.isCurrent()) {
    return "error" in context ? context : { error: "wallet locked" };
  }
  const intents = (await deps.multisigStore.listIntents()).filter(
    (intent) => intent.accountId === context.record.id,
  );
  const operations = await settledOperations(deps, context.record);
  const terminalIntentHashes = intents
    .filter(
      (intent) =>
        !(
          "collecting" === intent.state ||
          "ready" === intent.state ||
          "submitted" === intent.state
        ),
    )
    .map((intent) => intent.prepared.transactionHash);
  const pendingIntent = intents.some(
    (intent) =>
      intent.state === "collecting" || intent.state === "ready" || intent.state === "submitted",
  );
  const unresolvedOperation = operations.some(
    (operation) =>
      operation.transactionHash === undefined &&
      !(
        operation.kind === "sign" &&
        terminalIntentHashes.some((hash) => sameFelt(hash, operation.target))
      ),
  );
  if (pendingIntent || unresolvedOperation) {
    return { error: "Argent multisig has a pending or unresolved operation" };
  }
  const unconfirmed = input.confirmHistoryRemoval
    ? null
    : await unconfirmedRemoval(deps, context, intents.length > 0 || operations.length > 0);
  if (unconfirmed) return { error: unconfirmed };
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  return (await deps.multisigStore.removeMultisig(context.record.id, authorized.isCurrent)) ===
    "removed"
    ? { ok: true }
    : { error: "wallet locked" };
};

const multisigBalances = async (
  deps: MultisigOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readMultisigBalancesInput(message);
  if (!input) return { error: "invalid Argent multisig balances request" };
  const context = await contextFor(
    deps,
    await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    input.multisigId,
  );
  if ("error" in context) return context;
  const snapshot = await cachedBalances(
    deps.balanceSnapshots,
    {
      accountId: context.record.id,
      cachedOnly: input.cached,
      force: input.refresh,
      networkId: context.record.networkId,
      now: (deps.now ?? systemClock)(),
    },
    async (previous): Promise<readonly TokenBalance[]> =>
      readPortfolioBalances(
        deps.runtimeRpc,
        {
          accountAddress: context.record.address,
          rpcUrls: context.rpcUrls,
          tokens: (await deps.preferencesStore.read()).tokens.filter(
            (token) => token.networkId === context.record.networkId,
          ),
        },
        previous,
      ),
  );
  if (!snapshot) return { error: "multisig balance snapshot unavailable" };
  return {
    accountId: context.record.id,
    asOf: snapshot.fetchedAt > 0 ? snapshot.fetchedAt : null,
    balances: snapshot.balances,
    networkId: context.record.networkId,
    ok: true,
    stale: snapshot.stale,
  };
};

type AccountHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;
const HANDLERS: Readonly<Record<string, AccountHandler>> = {
  "wallet.multisigBalances": multisigBalances,
  "wallet.removeArgentMultisigIntent": removeIntent,
  "wallet.removeMultisig": removeMultisig,
};

/**
 * Dispatches account-scoped multisig reads and removal. Invalid inputs fail
 * closed; unrelated message types return null for the parent dispatcher.
 */
export const handleMultisigAccountOps = (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse> | null => {
  const handler = Object.hasOwn(HANDLERS, messageType) ? HANDLERS[messageType] : undefined;
  return handler ? handler(deps, message) : null;
};
