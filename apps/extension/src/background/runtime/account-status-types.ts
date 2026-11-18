/**
 * Per-account status verdicts the side panel polls for the active account.
 * Split from runtime-types by the size budget. None carries secret material.
 */
import type { ReadOnlyReason } from "@bramble/wallet-model/recovery";
import type { AccountRecoveryState } from "./recovery-types";

/**
 * Account contract deployment status returned to extension pages.
 */
export type DeploymentStatusResponse = {
  readonly accountId: string;
  readonly deployed: boolean;
  readonly ok: true;
};

/**
 * Active-account signability verdict for the Home read-only flag; `reason`
 * accompanies `readOnly: true` and never carries secret material.
 */
export type AccountSignabilityResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly readOnly: boolean;
  readonly reason?: ReadOnlyReason;
  readonly recovery?: AccountRecoveryState;
};

/**
 * Whether the active Ready account holds a key from Krusty's pre-3.0 Argent
 * legacy derivation. A boolean verdict only; `false` also covers "unknown".
 */
export type ReadyKeyStatusResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly preFixKey: boolean;
};
