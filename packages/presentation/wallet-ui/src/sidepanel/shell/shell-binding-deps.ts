/**
 * The state accessors and services every shell binder closes over, split from
 * `shell-bindings` so the deploy binder in `deploy-bindings` can share them
 * without an import cycle.
 */
import type { WalletStatus } from "../../popup/responses/responses";
import type { WalletView } from "../app/screens/views";
import type { RefreshReason } from "../app/sync/refresh-scheduler";
import type { SidepanelWallet } from "../runtime/runtime";
import type { StageTimers } from "../shared/stage-pacer";

/**
 * Services and state setters the shell bindings close over. State lives in the
 * entrypoint so it survives full re-renders.
 */
export type ShellBindingDeps = {
  readonly app: Element | null;
  /** Captures the account/network whose deployment an async watcher may apply. */
  readonly deploymentScope?: () => DeploymentPollScope | null;
  readonly wallet: SidepanelWallet;
  /**
   * Repaints the shell. `reason` reaches the hydration pass: "action" forces a
   * balance refetch past the one-minute snapshot TTL, which is what a control
   * the user pressed has to do.
   */
  readonly render: (status: WalletStatus, reason?: RefreshReason) => Promise<void>;
  readonly setActiveView: (view: WalletView) => void;
  /** The deploy screen's hold re-check timer; tests inject one to drive time. */
  readonly deployHoldTimers?: StageTimers;
  /** Overrides the confirmation checkpoints; tests pass a single zero delay. */
  readonly confirmationDelaysMs?: readonly number[];
};

/**
 * Account/network identity captured before a deployment is submitted.
 */
export type DeploymentPollScope = {
  readonly accountId: string;
  readonly stillCurrent: () => boolean;
};
