/** Removal and balance operations for one resolved Argent multisig account. */
import type { TokenBalance } from "@bramble/starknet/rpc";
import { systemClock } from "@bramble/transactions/activity";
import { sameFelt } from "@bramble/wallet-model/networks";
import { cachedBalances } from "../portfolio/balance-snapshots";
import { readPortfolioBalances } from "../portfolio/portfolio-balances";
import { activeAccountContext, observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { contextFor } from "./multisig-context";
import type { MultisigOpsDeps } from "./multisig-deps";
import {
  readMultisigBalancesInput,
  readRemoveIntentInput,
  readRemoveMultisigInput,
} from "./multisig-inputs";

const removeIntent = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const input = readRemoveIntentInput(message);
  if (!input) return { error: "invalid Argent multisig intent removal request" };
  const authorized = captureSessionAuthorization(deps.session);
  // Recorded first: a record for an intent that is still stored changes
  // nothing, while a removal with no record lets relay sync bring it back.
  const intent = await deps.multisigStore.getIntent(input.intentId);
  if (intent) {
    await deps.nostrCoordinationStore.recordRemovedIntent(
      intent.accountId,
      intent.id,
      authorized.isCurrent,
    );
  }
  const result = await deps.multisigStore.removeIntent(input.intentId, authorized.isCurrent);
  return result === "removed"
    ? { ok: true }
    : { error: result === "missing" ? "Argent multisig intent not found" : "wallet locked" };
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
  const operations = (await deps.multisigStore.listOperations()).filter(
    (operation) => operation.accountId === context.record.id,
  );
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
  if ((intents.length > 0 || operations.length > 0) && !input.confirmHistoryRemoval) {
    return { error: "confirm removal of terminal Argent multisig history" };
  }
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
