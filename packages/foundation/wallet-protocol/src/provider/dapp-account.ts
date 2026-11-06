/**
 * Account shapes a connected site is allowed to see. Single-signer records are
 * full account refs. A multisig is only its public address fields: no key, no
 * derivation, no signer set.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isAccountId } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";

/**
 * Public multisig projection returned to a connected site and to the extension
 * page that approved the connection.
 */
export type DappMultisigAccount = {
  readonly accountContractType: "argent-multisig";
  readonly address: string;
  readonly classHash: string;
  readonly id: string;
  readonly networkId: StarknetNetworkId;
};

/**
 * Validates a multisig account a site may be told about. The id must be the
 * canonical `network:address` spelling so it cannot alias another account.
 */
export const isDappMultisigAccount = (value: unknown): value is DappMultisigAccount => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["accountContractType", "address", "classHash", "id", "networkId"]) ||
    value["accountContractType"] !== "argent-multisig" ||
    typeof value["address"] !== "string" ||
    typeof value["classHash"] !== "string" ||
    !isStarknetNetworkId(value["networkId"]) ||
    !isAccountId(value["id"])
  ) {
    return false;
  }
  const address = canonicalFelt(value["address"]);
  return (
    address !== null &&
    value["id"] === `${value["networkId"]}:${address}` &&
    value["address"] === address
  );
};
