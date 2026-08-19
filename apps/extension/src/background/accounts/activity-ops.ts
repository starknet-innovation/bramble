/** Durable-first account activity loading and background history refresh. */
import type { MultisigStore } from "@mc-wallet/multisig/repository";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import {
  type ActivityEntry,
  type ActivityLog,
  type ActivityScope,
  activityForScope,
  systemClock,
} from "@mc-wallet/transactions/activity";
import { mergeActivity } from "@mc-wallet/transactions/tx-history";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import { currentArgentSignerRecords } from "../multisig/multisig-membership";
import { readActivityInput } from "../routing/message-inputs";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls, observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { UnlockSession } from "../runtime/session";
import { reconcileScope } from "../transactions/tx-reconcile";
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
  const record = (await currentArgentSignerRecords(deps, context.account, context.networkId)).find(
    (stored) => stored.id === requestedAccountId,
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
  const local = await reconcileScope(deps, target.scope, (deps.now ?? systemClock)());
  const history = await accountHistory(deps, target);
  const merged = mergeActivity(local, history.onChain);
  if (!history.unavailable) {
    await deps.activity.replaceScope?.(merged, target.scope).catch(() => undefined);
  }
  return {
    activity: merged,
    ...(history.unavailable ? { historyUnavailable: true } : {}),
    ok: true,
  };
};
