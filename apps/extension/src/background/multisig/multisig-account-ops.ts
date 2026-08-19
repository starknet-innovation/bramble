/** Removal and balance operations for one resolved Argent multisig account. */
import type { TokenBalance } from "@mc-wallet/starknet/rpc";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import { activeAccountContext, observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { contextFor } from "./multisig-context";
import type { MultisigOpsDeps } from "./multisig-deps";
import { readMultisigBalancesInput, readRemoveMultisigInput } from "./multisig-inputs";

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
  if (input.cached) {
    const balances = await deps.balanceSnapshots
      ?.read(context.record.id, context.record.networkId)
      .catch(() => null);
    if (!balances) return { error: "multisig balance snapshot unavailable" };
    return {
      accountId: context.record.id,
      balances,
      networkId: context.record.networkId,
      ok: true,
    };
  }
  const balances: readonly TokenBalance[] = await deps.runtimeRpc.getTokenBalances({
    accountAddress: context.record.address,
    rpcUrls: context.rpcUrls,
    tokens: (await deps.preferencesStore.read()).tokens.filter(
      (token) => token.networkId === context.record.networkId,
    ),
  });
  await deps.balanceSnapshots
    ?.write({ accountId: context.record.id, balances, networkId: context.record.networkId })
    .catch(() => undefined);
  return {
    accountId: context.record.id,
    balances,
    networkId: context.record.networkId,
    ok: true,
  };
};

type AccountHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;
const HANDLERS: Readonly<Record<string, AccountHandler>> = {
  "wallet.multisigBalances": multisigBalances,
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
