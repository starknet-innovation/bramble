/**
 * wallet_deploymentData result validation for the dapp provider bridge. Split
 * from bridge-results.ts to keep each provider module within the size cap.
 */
import { hasOnlyKnownKeys, isJson, isRecord } from "@bramble/core/json";
import type { ProviderDeploymentData } from "../provider/results";

const isPaddedFelt = (value: unknown): value is string =>
  typeof value === "string" && /^0x0[0-8][0-9a-f]{62}$/.test(value);

/**
 * Narrows an unknown value to a spec ACCOUNT_DEPLOYMENT_DATA whose address and
 * felts are all PADDED_FELT and whose version is 0 or 1.
 */
export const providerDeploymentResult = (result: unknown): ProviderDeploymentData | null => {
  if (
    !isRecord(result) ||
    !isJson(result) ||
    !hasOnlyKnownKeys(result, [
      "address",
      "calldata",
      "class_hash",
      "salt",
      "sigdata",
      "version",
    ]) ||
    !isPaddedFelt(result["address"]) ||
    !isPaddedFelt(result["class_hash"]) ||
    !isPaddedFelt(result["salt"]) ||
    (result["version"] !== 0 && result["version"] !== 1) ||
    !Array.isArray(result["calldata"]) ||
    !result["calldata"].every(isPaddedFelt) ||
    (result["sigdata"] !== undefined &&
      !(Array.isArray(result["sigdata"]) && result["sigdata"].every(isPaddedFelt)))
  ) {
    return null;
  }
  return {
    address: result["address"],
    calldata: [...result["calldata"]],
    class_hash: result["class_hash"],
    salt: result["salt"],
    ...(result["sigdata"] === undefined ? {} : { sigdata: [...result["sigdata"]] }),
    version: result["version"],
  };
};
