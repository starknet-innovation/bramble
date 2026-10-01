/**
 * Per-session cache of which accounts are known-deployed, so the Home screen's
 * "deploy now" notice never re-queries the chain for an account already seen
 * deployed. Deployment is monotonic, while an undeployed result receives only
 * a short freshness window so external or wallet-driven deployment still
 * appears promptly. Kept out of the entrypoint so the render loop holds no
 * ad-hoc RPC memoisation.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import type { WalletView } from "../screens/views";

const UNDEPLOYED_FRESH_MS = 60_000;

type DeploymentSnapshot = { readonly checkedAt: number; readonly deployed: boolean };

/**
 * Deployment-status cache handle bound to one wallet client.
 */
export type DeploymentCache = {
  /**
   * Resolves the active account's on-chain deployment for Home: true when
   * deployed (from cache or a fresh query), false when confirmed undeployed,
   * and null when it does not apply (not Home, locked, or no vault) or is
   * unknown. A completed action forces a fresh negative result while a positive
   * result remains safe for the session.
   */
  readonly load: (
    status: WalletStatus,
    activeView: WalletView,
    force?: boolean,
  ) => Promise<boolean | null>;
  /**
   * Records that this account is deployed. A poll that just watched deployment
   * land must not leave the 60-second undeployed snapshot in place.
   */
  readonly noteDeployed: (networkId: string, accountId: string) => void;
};

/**
 * Creates a deployment-status cache over the given wallet client.
 */
export const createDeploymentCache = (
  wallet: SidepanelWallet,
  now: () => number = () => performance.now(),
): DeploymentCache => {
  const snapshots = new Map<string, DeploymentSnapshot>();
  return {
    async load(status, activeView, force = false) {
      if (activeView !== "home" || !status.hasVault || status.locked) {
        return null;
      }
      const known = `${status.networkId}:${status.activeAccountId ?? ""}`;
      const cached = snapshots.get(known);
      if (cached?.deployed) {
        return true;
      }
      const checkedAt = now();
      if (
        !force &&
        cached &&
        cached.checkedAt <= checkedAt &&
        checkedAt - cached.checkedAt < UNDEPLOYED_FRESH_MS
      ) {
        return false;
      }
      const result = await wallet.loadDeploymentStatus();
      // The background answers for whichever account is active when it handles
      // the request, so a switch that lands mid-flight returns another
      // account's verdict. Drop it rather than key it under this account: a
      // foreign `true` would hide the deploy notice for the whole session.
      if (!result || result.accountId !== status.activeAccountId) {
        return null;
      }
      snapshots.set(known, { checkedAt, deployed: result.deployed });
      return result.deployed;
    },
    noteDeployed(networkId, accountId) {
      const snapshot = { checkedAt: now(), deployed: true };
      snapshots.set(`${networkId}:${accountId}`, snapshot);
    },
  };
};
