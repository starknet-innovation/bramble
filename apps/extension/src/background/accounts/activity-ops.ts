/** Durable-first account activity loading and background history refresh. */
import type { MultisigStore } from "@bramble/multisig/repository";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import {
  type ActivityEntry,
  type ActivityHistoryState,
  type ActivityLog,
  type ActivityScope,
  activityForScope,
  systemClock,
} from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import { readActivityInput } from "../routing/message-inputs";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls, observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { UnlockSession } from "../runtime/session";
import { mergeReconciledHistory, reconcileScope } from "../transactions/tx-reconcile";
import type { WalletStatusReader } from "./wallet-reader";

type ActivityOpsDeps = {
  readonly activity: ActivityLog;
  readonly multisigStore?: MultisigStore;
  readonly now?: () => number;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

type ActivityTarget = {
  readonly accountId: string;
  readonly address: string;
  readonly networkId: StarknetNetworkId;
  readonly scope: ActivityScope;
};

const HISTORY_FRESH_MS = 5 * 60_000;
const HISTORY_RETRY_MS = 60_000;

const historyRefreshDue = (sync: ActivityHistoryState | null, now: number): boolean =>
  sync === null ||
  sync.syncedAt > now ||
  now - sync.syncedAt >= (sync.unavailable ? HISTORY_RETRY_MS : HISTORY_FRESH_MS);

// A transaction recorded since the last scan means the chain moved because of
// something this wallet did, so the cached scan is stale no matter how recently
// it ran. Without this, a user who acts and then opens Activity sees the feed as
// it was before their own transaction until the freshness window expires or they
// press refresh — which is exactly the case they notice.
//
// Entries dated after `now` are ignored rather than trusted: a scan stamps
// `syncedAt` with the same clock, so a future-dated row would otherwise stay
// "newer than the last scan" forever and rescan on every read.
const recordedSinceSync = (
  local: readonly ActivityEntry[],
  sync: ActivityHistoryState | null,
  now: number,
): boolean =>
  sync !== null &&
  local.some((entry) => entry.submittedAt > sync.syncedAt && entry.submittedAt <= now);

const shouldScanHistory = (
  input: { readonly forceHistory: boolean; readonly refreshHistory: boolean },
  sync: ActivityHistoryState | null,
  now: number,
  local: readonly ActivityEntry[],
): boolean =>
  input.refreshHistory &&
  (input.forceHistory || historyRefreshDue(sync, now) || recordedSinceSync(local, sync, now));

const activityTarget = async (
  deps: ActivityOpsDeps,
  context: { readonly account: AccountRef; readonly networkId: StarknetNetworkId },
  requestedAccountId: string | undefined,
): Promise<ActivityTarget | null> => {
  if (requestedAccountId === undefined || requestedAccountId === context.account.id) {
    return {
      accountId: context.account.id,
      address: context.account.address,
      networkId: context.networkId,
      scope: { accountId: context.account.id, networkId: context.networkId },
    };
  }
  // Activity is public address history. Authorize the requested address from
  // the local registry; signer authority is re-read only at signing boundaries.
  const record = (await deps.multisigStore?.listMultisigs())?.find(
    (stored) => stored.id === requestedAccountId && stored.networkId === context.networkId,
  );
  return record
    ? {
        accountId: record.id,
        address: record.address,
        networkId: record.networkId,
        scope: { accountId: record.id, networkId: record.networkId },
      }
    : null;
};

const accountHistory = async (
  deps: ActivityOpsDeps,
  target: ActivityTarget,
): Promise<{ readonly onChain: readonly ActivityEntry[]; readonly unavailable: boolean }> => {
  const scan = deps.runtimeRpc.getTransactionHistory;
  if (!scan) return { onChain: [], unavailable: false };
  const preferences = await deps.preferencesStore.read();
  const tokens = preferences.tokens.filter((token) => token.networkId === target.networkId);
  if (tokens.length === 0) return { onChain: [], unavailable: false };
  try {
    return {
      onChain: await scan({
        account: target.address,
        accountId: target.accountId,
        networkId: target.networkId,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[target.networkId], preferences),
        tokens,
      }),
      unavailable: false,
    };
  } catch {
    return { onChain: [], unavailable: true };
  }
};

/**
 * Returns the cached scope immediately when requested, otherwise refreshes it.
 */
export const handleActivity = async (
  deps: ActivityOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readActivityInput(message);
  if (!input) return { error: "invalid activity request" };
  const context = await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) return { activity: [], ok: true };
  const target = await activityTarget(deps, context, input.accountId);
  if (!target) return { error: "activity scope unavailable" };
  if (input.cached) {
    return { activity: activityForScope(await deps.activity.list(), target.scope), ok: true };
  }
  const now = (deps.now ?? systemClock)();
  // Ambient panel reads cover only unresolved transactions. L2-accepted rows
  // stay on the monitor's 15-minute lane unless the user opens or refreshes
  // Activity, avoiding a duplicate finality poll on every visible-panel tick.
  const local = await reconcileScope(deps, target.scope, now, input.refreshHistory);
  const previousSync = await deps.activity.historySync?.(target.scope).catch(() => null);
  // History discovery is intentionally screen-driven. Ambient Home refreshes
  // reconcile only transactions still under observation; entering Activity or
  // pressing its refresh control opts into the larger event scan explicitly.
  const scanHistory = shouldScanHistory(input, previousSync ?? null, now, local);
  const history = scanHistory
    ? await accountHistory(deps, target)
    : { onChain: [], unavailable: previousSync?.unavailable ?? false };
  const merged =
    scanHistory && !history.unavailable
      ? await mergeReconciledHistory(deps, target.scope, history.onChain)
      : local;
  if (scanHistory) {
    await deps.activity
      .markHistorySynced?.(target.scope, now, history.unavailable)
      .catch(() => undefined);
  }
  return {
    activity: merged,
    ...(history.unavailable ? { historyUnavailable: true } : {}),
    ok: true,
  };
};
