/**
 * Per-session cache of the active account's signability verdict, so the Home
 * read-only flag neither re-probes the chain on every paint nor flickers.
 * Both verdicts age out: a read-only account becomes signable when its
 * restriction is lifted (a guardian removed, a release upgraded, a recovery
 * completed), and a signable one can gain a restriction, so neither answer is
 * monotonic the way deployment is.
 */
import type { SignabilityVerdict, WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import type { WalletView } from "../screens/views";

const VERDICT_FRESH_MS = 300_000;

type SignabilitySnapshot = { readonly checkedAt: number; readonly verdict: SignabilityVerdict };

/**
 * Signability cache handle bound to one wallet client.
 */
export type SignabilityCache = {
  /**
   * Resolves the active account's signability for Home: a verdict from cache
   * or a fresh probe, or null when it does not apply (not Home, locked, no
   * vault, no account) or the background could not answer. A completed action
   * forces a fresh probe, since the action may have been the recovery step
   * that changes the answer.
   */
  readonly load: (
    status: WalletStatus,
    activeView: WalletView,
    force?: boolean,
  ) => Promise<SignabilityVerdict | null>;
};

/**
 * Creates a signability cache over the given wallet client.
 */
export const createSignabilityCache = (
  wallet: SidepanelWallet,
  now: () => number = () => performance.now(),
): SignabilityCache => {
  const snapshots = new Map<string, SignabilitySnapshot>();
  return {
    async load(status, activeView, force = false) {
      if (activeView !== "home" || !status.hasVault || status.locked) {
        return null;
      }
      const accountId = status.activeAccountId;
      if (accountId === null) {
        return null;
      }
      const key = `${status.networkId}:${accountId}`;
      const cached = snapshots.get(key);
      const checkedAt = now();
      if (!force && cached && checkedAt - cached.checkedAt < VERDICT_FRESH_MS) {
        return cached.verdict;
      }
      const response = await wallet.loadAccountSignability();
      // The background answers for whichever account is active when it handles
      // the request; a switch that lands mid-flight returns another account's
      // verdict. Drop it rather than key it under this account.
      if (!response || response.accountId !== accountId) {
        return cached?.verdict ?? null;
      }
      const verdict: SignabilityVerdict =
        response.readOnly && response.reason !== undefined
          ? { readOnly: true, reason: response.reason }
          : { readOnly: false };
      snapshots.set(key, { checkedAt, verdict });
      return verdict;
    },
  };
};
