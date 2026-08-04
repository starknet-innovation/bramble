/**
 * Validation of untrusted official-SDK result envelopes. Split out of the
 * service adapter so the warning policy and the call/proof bounds can be
 * audited — and tested — independently of the submission orchestration.
 */

import { WalletError } from "../../shared/errors";
import { isRecord } from "../../shared/json";
import { sameFelt } from "../networks";
import type { Strk20NetworkConfig } from "./config";
import type { SdkWarning } from "./official-sdk-runtime";
import { isStrk20CallAndProof, STRK20_LIMITS, type Strk20CallAndProof } from "./schemas";
import { STRK20_PRIVACY_LEAK, STRK20_SERVICE_UNAVAILABLE } from "./service";

const invalidSdkResult = (reason: string): WalletError =>
  new WalletError(`${STRK20_SERVICE_UNAVAILABLE} (sdk-result/${reason})`);

// A warning is only usable if it is a bounded { code, message } string pair.
// Checked before any semantic branch so a malformed envelope can never be read
// as a recognized signal.
const isSdkWarningShape = (warning: unknown): boolean =>
  isRecord(warning) &&
  typeof warning["code"] === "string" &&
  warning["code"].length <= 64 &&
  typeof warning["message"] === "string" &&
  warning["message"].length <= 512;

/**
 * Rejects an SDK result whose warning envelope is missing, oversized,
 * malformed, or carries a code this adapter has not reviewed. `USER_LINKAGE`
 * is the only code the pinned SDK declares and maps to a privacy leak; every
 * other warning fails closed so an unknown signal never reaches submission.
 */
export const assertNoSdkWarnings = (value: unknown): void => {
  if (!isRecord(value) || !Array.isArray(value["warnings"])) {
    throw invalidSdkResult("missing-warnings");
  }
  const warnings = value["warnings"] as readonly SdkWarning[];
  if (warnings.length > STRK20_LIMITS.sdkWarnings || !warnings.every(isSdkWarningShape)) {
    throw invalidSdkResult("invalid-warnings");
  }
  if (warnings.some((warning) => warning.code === "USER_LINKAGE")) {
    throw new WalletError(STRK20_PRIVACY_LEAK);
  }
  // The pinned SDK declares exactly one warning code, handled above. Anything
  // still present therefore carries an unreviewed code: fail closed instead of
  // proceeding on a signal this adapter does not understand.
  if (warnings.length > 0) {
    throw invalidSdkResult("unsupported-warning");
  }
};

/**
 * Reads the SDK's call/proof envelope, enforcing the calldata and proof bounds
 * and pinning the call to the configured pool's `apply_actions` entry point.
 * Simulations are normalized to an empty proof so they can never be submitted.
 */
export const readCallAndProof = (
  value: unknown,
  config: Strk20NetworkConfig,
  simulate: boolean,
): Strk20CallAndProof => {
  const source = isRecord(value) && isRecord(value["callAndProof"]) ? value["callAndProof"] : null;
  if (!source || !isRecord(source["call"]) || !isRecord(source["proof"])) {
    throw invalidSdkResult("missing-call-and-proof");
  }
  const call = source["call"];
  const proof = source["proof"];
  if (
    !Array.isArray(call["calldata"]) ||
    call["calldata"].length > STRK20_LIMITS.invokeCalldataFelts ||
    !call["calldata"].every((item) => typeof item === "string") ||
    !Array.isArray(proof["output"]) ||
    proof["output"].length > STRK20_LIMITS.proofOutputFelts ||
    !Array.isArray(proof["proofFacts"]) ||
    proof["proofFacts"].length > STRK20_LIMITS.proofFacts
  ) {
    throw invalidSdkResult("invalid-call-or-proof");
  }
  const candidate = {
    call: {
      calldata: [...call["calldata"]],
      contract_address: call["contractAddress"],
      entry_point: call["entrypoint"],
    },
    proof: simulate
      ? { data: "", output: [], proof_facts: [] }
      : {
          data: proof["data"],
          output: proof["output"],
          proof_facts: proof["proofFacts"],
        },
  };
  if (
    !isStrk20CallAndProof(candidate) ||
    !sameFelt(candidate.call.contract_address, config.poolAddress) ||
    candidate.call.entry_point !== "apply_actions"
  ) {
    throw invalidSdkResult("unbound-call-or-proof");
  }
  return candidate;
};
