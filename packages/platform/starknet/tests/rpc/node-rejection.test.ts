/**
 * A node's refusal is the short sentence, never the RPC request dump.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  NETWORK_REJECTION_MESSAGE_MAX,
  networkRejectionMessage,
  nodeRejectionReason,
} from "@bramble/starknet/node-rejection";

const CALLDATA = "Calldata length exceeded maximum: length 5001 (allowed length: 5000)";

const rpcError = (message: string, data?: unknown) =>
  Object.assign(
    new Error(
      `RPC: starknet_addInvokeTransaction with params ${"{}".repeat(400)}\n\n63: ${message}`,
    ),
    {
      baseError: { code: 63, data, message },
    },
  );

describe("nodeRejectionReason", () => {
  test("keeps the node's calldata sentence and drops the request dump", () => {
    expect(nodeRejectionReason(rpcError(CALLDATA))).toBe(CALLDATA);
    expect(nodeRejectionReason(new Error(CALLDATA))).toBeNull();
    expect(networkRejectionMessage(CALLDATA)).toBe(
      `The network rejected this transaction: ${CALLDATA}.`,
    );
    expect(networkRejectionMessage(CALLDATA).length).toBeLessThanOrEqual(
      NETWORK_REJECTION_MESSAGE_MAX,
    );
  });

  test("ignores a wallet message, a dump, and contract revert text", () => {
    expect(nodeRejectionReason(new WalletError("invoke request failed"))).toBeNull();
    expect(
      nodeRejectionReason(new Error(`RPC: starknet_estimateFee with params ${"x".repeat(400)}`)),
    ).toBeNull();
    const phishing = "Bramble security update required: visit bramble-support.app";
    expect(
      nodeRejectionReason(rpcError("Transaction execution error", { revert_error: phishing })),
    ).toBeNull();
    expect(nodeRejectionReason(rpcError(phishing))).toBeNull();
    expect(networkRejectionMessage(CALLDATA)).not.toContain("bramble-support.app");
  });
});
