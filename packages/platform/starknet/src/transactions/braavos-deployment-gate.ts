/**
 * The deploy-then-act gate for Braavos: an undeployed Braavos account deploys
 * only through the explicit deployment, never inside another transaction.
 * Split from deployment.ts by the size budget; deployment.ts re-exports it.
 */

import { WalletError } from "@bramble/core/errors";
import {
  isDeployableBraavos,
  UNDEPLOYED_BRAAVOS_REFUSAL,
} from "@bramble/wallet-model/account-families";

/** Refusal for any Braavos class this wallet cannot deploy at all. */
export const BRAAVOS_DEPLOYMENT_UNSUPPORTED = "This wallet does not deploy Braavos accounts";

/**
 * Thrown before any signing when a transaction would have to deploy a
 * modern-class Braavos account first. Typed so a review surface can show
 * {@link UNDEPLOYED_BRAAVOS_REFUSAL} instead of a generic estimate failure
 * without matching on message text.
 */
export class UndeployedBraavosError extends WalletError {
  public constructor() {
    super(UNDEPLOYED_BRAAVOS_REFUSAL);
    this.name = "UndeployedBraavosError";
  }
}

/**
 * Throws before any signing when an undeployed Braavos account would need a
 * deploy-then-act submission, which only the explicit deployment can produce
 * (its deploy signature signs an extra hash first): {@link UndeployedBraavosError}
 * for the modern class, {@link BRAAVOS_DEPLOYMENT_UNSUPPORTED} for an older one.
 */
export const refuseUndeployedBraavos = (
  account: { readonly accountContractType: string; readonly classHash: string },
  deployed: boolean,
): void => {
  if (deployed || account.accountContractType !== "braavos") return;
  if (isDeployableBraavos(account)) throw new UndeployedBraavosError();
  throw new WalletError(BRAAVOS_DEPLOYMENT_UNSUPPORTED);
};
