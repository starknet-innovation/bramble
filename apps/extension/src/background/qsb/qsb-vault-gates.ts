/**
 * The coordinator's configuration gates (qsb-app `sdk/client.ts`
 * `assertServerNetwork`, `assertOwnerAllowed`, `assertOperations`): checked
 * before a vault is registered, before a deposit is prepared and again just
 * before it is submitted. A deployment that serves another network, has
 * misconfigured owner limits, does not list this owner, or has deposits or
 * MARA submission switched off is `coordinatorDisabled`, before anything is
 * written or sent. An absent or malformed configuration never enables
 * anything; the client already refused it as unreachable.
 */
import { QSB_COORDINATOR_NETWORK } from "@bramble/qsb/origin";
import type { QsbConfig } from "@bramble/qsb/responses";
import { qsbRefusal } from "./qsb-vault-refusals";

/** Refuses a deployment that is not mainnet or will not serve this owner. */
export const requireOwnerAllowed = (config: QsbConfig): void => {
  if (
    config.network !== QSB_COORDINATOR_NETWORK ||
    config.ownerLimits === null ||
    config.ownerLimits.allowlisted === false
  ) {
    throw qsbRefusal("coordinatorDisabled");
  }
};

/** Also refuses one whose deposits or MARA submission are switched off. */
export const requireDepositsOpen = (config: QsbConfig): void => {
  requireOwnerAllowed(config);
  if (!config.operationsEnabled || !config.exactSubmitEnabled) {
    throw qsbRefusal("coordinatorDisabled");
  }
};
