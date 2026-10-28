/**
 * Which account classes may sign a gasless outside execution. The gateway
 * accepts SNIP-9 v2 only. Argent 0.3.0 and 0.3.1 are not verified for v2, so
 * they stay on STRK. An undeployed Braavos account is refused here as well:
 * a gasless deploy-and-invoke does not bypass that gate.
 */

import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  XVERSE_ARGENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";
import { sameFelt } from "@bramble/wallet-model/networks";

/**
 * The class and deployment state a gasless quote needs. `deployed` is the
 * chain's answer, not the class's role in the catalog.
 *
 * For Braavos, `classHash` is the deployment class stored on the account.
 * That class is not the implementation the account runs, so eligibility uses
 * `liveClassHash` — the class at the address now — and ignores `classHash`.
 */
export type GaslessAccountClass = {
  readonly accountContractType: string;
  readonly classHash: string;
  readonly deployed: boolean;
  /** Live implementation class. Required for a deployed Braavos account. */
  readonly liveClassHash?: string;
};

/**
 * Whether this account may be offered a gasless fee. False for multisig,
 * read-only, unknown classes, Argent 0.3.x, Braavos accounts whose live class
 * is not the current implementation, and any undeployed Braavos account.
 */
export const accountSignsGaslessV2 = (account: GaslessAccountClass): boolean => {
  if (account.accountContractType === "argent-multisig") {
    return false;
  }
  if (
    account.accountContractType === "argent" &&
    (sameFelt(account.classHash, ARGENT_ACCOUNT_CLASS_HASH) ||
      sameFelt(account.classHash, XVERSE_ARGENT_CLASS_HASH))
  ) {
    return true;
  }
  if (
    account.accountContractType === "openzeppelin" &&
    sameFelt(account.classHash, OPENZEPPELIN_ACCOUNT_CLASS_HASH)
  ) {
    return true;
  }
  return (
    account.accountContractType === "braavos" &&
    account.deployed &&
    account.liveClassHash !== undefined &&
    sameFelt(account.liveClassHash, BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH)
  );
};
