/**
 * Register-path diagnostics at the message boundary. A failed pool broadcast
 * used to collapse to the generic "strk20 request failed", discarding the only
 * evidence of why registration was rejected. These checks pin the sanitized
 * stage, category, and on-chain revert reason surviving to the dapp response
 * while note, proof, authorizing, and service-endpoint material does not.
 */
import { describe, expect, test } from "bun:test";
import { mapStrk20StageError } from "@bramble/privacy/official-sdk-errors";
import type { Strk20Service } from "@bramble/privacy/service";
import {
  approveHeldStrk20,
  buildStrk20Handler,
  STRK20_CALL_AND_PROOF,
  STRK20_ORIGIN,
  STRK20_TOKEN,
} from "../../support/strk20-background";

// Every method the register path does not reach shares one rejecting stub, so
// the double asserts the path under test and nothing else.
const offPath = async (): Promise<never> => {
  throw new Error("not part of the register path");
};

// Stands in for the real adapter: registration reaches its broadcast and the
// pool rejects apply_actions, exactly as a live INVOKE rejection arrives.
const registerRejectedBy = (error: unknown): Strk20Service => ({
  prepare: offPath,
  privateBalances: offPath,
  async poolFee() {
    return "0x1";
  },
  async prepareRegistration() {
    return {
      allowanceGrants: [],
      calls: [
        {
          calldata: [...STRK20_CALL_AND_PROOF.call.calldata],
          contractAddress: STRK20_TOKEN,
          entrypoint: "apply_actions",
        },
      ],
      proof: STRK20_CALL_AND_PROOF.proof,
    };
  },
  quoteActions: offPath,
  async register() {
    return mapStrk20StageError("submission", error);
  },
  async registrationStatus() {
    return "unregistered";
  },
  subaccountCommitment: offPath,
  submitActions: offPath,
  async submitPrepared() {
    return mapStrk20StageError("submission", error);
  },
});

const registerError = async (error: unknown): Promise<string> => {
  const result = await approveHeldStrk20(
    buildStrk20Handler({ registered: false, strk20: registerRejectedBy(error) }),
    { origin: STRK20_ORIGIN, type: "wallet.strk20Register" },
    "strk20-register",
  );
  const message = (result as { readonly error?: string }).error;
  return message ?? "";
};

describe("strk20 register failure diagnostics", () => {
  test("surfaces the pool revert reason instead of a generic failure", async () => {
    const message = await registerError(
      Object.assign(new Error("RPC: starknet_addInvokeTransaction with params {...}"), {
        baseError: {
          code: 41,
          data: { execution_error: "pool/registration-closed" },
          message: "Transaction execution error",
        },
      }),
    );

    expect(message).not.toBe("strk20 request failed");
    expect(message).toContain("(submission/execution-reverted)");
    expect(message).toContain("pool/registration-closed");
  });

  test("withholds proof, note, and endpoint material from the surfaced error", async () => {
    const message = await registerError(
      Object.assign(
        new Error(
          'RPC: starknet_addInvokeTransaction with params {"proof":"cHJvb2ZCbG9iVGhhdE11c3ROZXZlckxlYWs","calldata":["0x05c1d2e3f405162738"]}',
        ),
        {
          baseError: {
            code: 41,
            data: {
              execution_error:
                "reverted at https://prover.internal/v1/prove with note 0x07a1b2c3d4e5f60718",
            },
            message: "err",
          },
        },
      ),
    );

    expect(message).not.toContain("cHJvb2ZCbG9iVGhhdE11c3ROZXZlckxlYWs");
    expect(message).not.toContain("0x05c1d2e3f405162738");
    expect(message).not.toContain("0x07a1b2c3d4e5f60718");
    expect(message).not.toContain("prover.internal");
    expect(message).not.toContain("params");
    // The stage and category still attribute the failure.
    expect(message).toContain("(submission/execution-reverted)");
  });

  test("labels a transport failure distinctly from an on-chain rejection", async () => {
    expect(await registerError(new Error("Failed to fetch"))).toContain("(submission/transport)");
  });
});
