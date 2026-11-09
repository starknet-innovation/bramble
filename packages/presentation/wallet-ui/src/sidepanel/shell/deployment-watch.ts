/**
 * The post-deploy watchers, split from `deploy-bindings` by the file budget and
 * re-exported from `shell-bindings`: a bounded poll of the active account's
 * deployment status after a deploy is submitted.
 */
import type { WalletStatus } from "../../popup/responses/responses";
import type { SidepanelWallet } from "../runtime/runtime";
import type { DeploymentPollScope, ShellBindingDeps } from "./shell-binding-deps";

const DEPLOY_WATCH_ATTEMPTS = 12;
const DEPLOY_WATCH_INTERVAL_MS = 5_000;

/**
 * The slice of the shell deps the post-deploy watcher touches: the deployment
 * and status loaders plus the shell re-render. Kept narrower than
 * `ShellBindingDeps` so both this file and the transfer bindings (which have no
 * `setActiveView`) can drive it, and so tests can supply a minimal double.
 */
export type DeploymentWatchDeps = {
  readonly render: ShellBindingDeps["render"];
  readonly wallet: Pick<SidepanelWallet, "loadDeploymentStatus" | "loadStatus">;
};

/**
 * Captures an active deployment scope and a live predicate for later polling.
 */
export const deploymentPollScope = (
  status: Pick<WalletStatus, "activeAccountId" | "networkId">,
  current: () => Pick<WalletStatus, "activeAccountId" | "networkId">,
): DeploymentPollScope | null => {
  const accountId = status.activeAccountId;
  const networkId = status.networkId;
  return accountId === null
    ? null
    : {
        accountId,
        stillCurrent: () => {
          const latest = current();
          return latest.activeAccountId === accountId && latest.networkId === networkId;
        },
      };
};

/**
 * Polls deployment status a bounded number of times after a deploy is
 * submitted, re-rendering once the account reports deployed so the home
 * "deploy now" banner clears on its own — the design has no background tx
 * poller, and submitting a deploy triggers no render by itself. Stops silently
 * once the attempt budget is spent (a manual refresh stays the fallback) and
 * treats a failed status load as "not yet deployed". Fire-and-forget: callers
 * `void` it.
 */
export const watchDeployment = async (
  deps: DeploymentWatchDeps,
  scope: DeploymentPollScope,
  options: { readonly attempts?: number; readonly intervalMs?: number } = {},
): Promise<void> => {
  if (await awaitDeployment(deps.wallet, scope, options)) {
    const status = await deps.wallet.loadStatus();
    if (scope.stillCurrent() && status.activeAccountId === scope.accountId) {
      await deps.render(status, "action");
    }
  }
};

/**
 * Waits for a submitted deployment to report deployed, answering whether it
 * did within the attempt budget. THE deployment poll — `watchDeployment` adds a
 * re-render on top, and a caller that must sequence work after deployment (the
 * deploy-then-register journey) needs the answer rather than a repaint. A failed
 * status load counts as "not yet".
 */
export const awaitDeployment = async (
  wallet: Pick<SidepanelWallet, "loadDeploymentStatus">,
  scope: DeploymentPollScope,
  options: { readonly attempts?: number; readonly intervalMs?: number } = {},
): Promise<boolean> => {
  const attempts = options.attempts ?? DEPLOY_WATCH_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEPLOY_WATCH_INTERVAL_MS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!scope.stillCurrent()) return false;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, intervalMs);
    });
    if (!scope.stillCurrent()) return false;
    const deployment = await wallet.loadDeploymentStatus().catch(() => null);
    if (deployment && deployment.accountId !== scope.accountId) {
      // The background always resolves the active account. A different id
      // proves the user switched while this poll was in flight, so stop rather
      // than observing or applying the new account's deployment.
      return false;
    }
    if (deployment?.deployed && scope.stillCurrent()) {
      return true;
    }
  }
  return false;
};
