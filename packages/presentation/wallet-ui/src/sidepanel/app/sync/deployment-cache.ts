/**
 * Per-session cache of which accounts are known-deployed, so the Home screen's
 * "deploy now" notice never re-queries the chain for an account already seen
 * deployed. Deployment is monotonic (an account never un-deploys), so a cached
 * "deployed" is safe to trust for the session; an undeployed or unknown result
 * is not cached and re-checked on the next Home paint. Kept out of the
 * entrypoint so the render loop holds no ad-hoc RPC memoisation.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import type { WalletView } from "../screens/views";

/**
 * Deployment-status cache handle bound to one wallet client.
 */
export type DeploymentCache = {
  /**
   * Resolves the active account's on-chain deployment for Home: true when
   * deployed (from cache or a fresh query), false when confirmed undeployed,
   * and null when it does not apply (not Home, locked, or no vault) or is
   * unknown. Only "deployed" is memoised.
   */
  readonly load: (status: WalletStatus, activeView: WalletView) => Promise<boolean | null>;
};

/**
 * Creates a deployment-status cache over the given wallet client.
 */
export const createDeploymentCache = (wallet: SidepanelWallet): DeploymentCache => {
  const deployedAccounts = new Set<string>();
  return {
    async load(status, activeView) {
      if (activeView !== "home" || !status.hasVault || status.locked) {
        return null;
      }
      const known = `${status.networkId}:${status.activeAccountId ?? ""}`;
      if (deployedAccounts.has(known)) {
        return true;
      }
      const result = await wallet.loadDeploymentStatus();
      if (result?.deployed) {
        deployedAccounts.add(`${status.networkId}:${result.accountId}`);
        deployedAccounts.add(known);
      }
      return result ? result.deployed : null;
    },
  };
};
