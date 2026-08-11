/**
 * Warning-envelope policy and stage error mapping for the official SDK adapter.
 * The mapper must surface a Starknet revert reason while never emitting note,
 * proof, authorizing, or service-endpoint material.
 */

import { describe, expect, test } from "bun:test";
import {
  isRetryableStrk20ServiceError,
  mapStrk20ProtocolError,
  mapStrk20StageError,
  sanitizeStrk20Detail,
} from "@mc-wallet/privacy/official-sdk-errors";
import { assertNoSdkWarnings } from "@mc-wallet/privacy/official-sdk-results";

const rpcError = (code: number, data: unknown, message = "Transaction execution error") =>
  Object.assign(new Error("RPC: starknet_addInvokeTransaction with params {...}"), {
    baseError: { code, data, message },
  });

describe("official SDK warning envelope", () => {
  test("accepts an empty envelope and maps a linkage warning to a privacy leak", () => {
    expect(() => assertNoSdkWarnings({ warnings: [] })).not.toThrow();
    expect(() =>
      assertNoSdkWarnings({ warnings: [{ code: "USER_LINKAGE", message: "linked" }] }),
    ).toThrow("strk20 privacy leak");
  });

  test("validates warning shape before reading any code", () => {
    // A malformed warning must fail closed as unusable rather than be trusted
    // far enough to be read as a recognized linkage signal.
    expect(() => assertNoSdkWarnings({ warnings: [{ code: "USER_LINKAGE", message: 5 }] })).toThrow(
      "strk20 services unavailable",
    );
    expect(() =>
      assertNoSdkWarnings({ warnings: [{ code: "x".repeat(65), message: "long code" }] }),
    ).toThrow("strk20 services unavailable");
    expect(() => assertNoSdkWarnings({ warnings: [{ message: "no code" }] })).toThrow(
      "strk20 services unavailable",
    );
  });

  test("bounds the warning count ahead of the linkage branch", () => {
    const warning = { code: "USER_LINKAGE", message: "linked" };
    expect(() =>
      assertNoSdkWarnings({ warnings: Array.from({ length: 64 }, () => warning) }),
    ).toThrow("strk20 privacy leak");
    expect(() =>
      assertNoSdkWarnings({ warnings: Array.from({ length: 65 }, () => warning) }),
    ).toThrow("strk20 services unavailable");
  });

  test("rejects an unreviewed warning code and a missing envelope", () => {
    expect(() =>
      assertNoSdkWarnings({ warnings: [{ code: "UNKNOWN", message: "review" }] }),
    ).toThrow("strk20 services unavailable");
    expect(() => assertNoSdkWarnings({})).toThrow("sdk-result/missing-warnings");
    expect(() => assertNoSdkWarnings({ warnings: "nope" })).toThrow("sdk-result/missing-warnings");
  });
});

describe("STRK20 detail sanitizer", () => {
  test("removes service endpoints, felt blobs, and long opaque tokens", () => {
    expect(sanitizeStrk20Detail("failed against https://prover.example/v1/prove now")).toBe(
      "failed against [endpoint] now",
    );
    expect(sanitizeStrk20Detail("note 0x04f3a1b2c3d4e5f60718 spent")).toBe("note [value] spent");
    expect(sanitizeStrk20Detail(`proof ${"A".repeat(64)} attached`)).toBe("proof [value] attached");
  });

  test("keeps a short revert reason intact and bounds the result", () => {
    expect(sanitizeStrk20Detail("Error message: pool/not-registered")).toBe(
      "Error message: pool/not-registered",
    );
    expect(sanitizeStrk20Detail(`${"reason ".repeat(160)}`).length).toBeLessThanOrEqual(800);
    expect(sanitizeStrk20Detail("  collapse\n\tthe   space ")).toBe("collapse the space");
  });

  test("bounds repeated hostile service input before redaction", () => {
    expect(sanitizeStrk20Detail(`https://${"a".repeat(20_000)}.example/prove`)).toBe("[endpoint]");
    expect(sanitizeStrk20Detail(`${"A".repeat(20_000)}!`)).toBe("[value]");
  });
});

describe("STRK20 stage error mapping", () => {
  test("carries the stage, category, and on-chain revert reason", () => {
    expect(() =>
      mapStrk20StageError("submission", rpcError(41, { execution_error: "pool/not-registered" })),
    ).toThrow(
      "(submission/execution-reverted): 41 Transaction execution error pool/not-registered",
    );
  });

  test("does not let revert text impersonate a transport failure", () => {
    expect(() =>
      mapStrk20StageError(
        "submission",
        rpcError(41, { execution_error: "pool: network timeout policy rejected" }),
      ),
    ).toThrow("(submission/execution-reverted)");
  });

  test("never emits the request body starknet.js embeds in the error message", () => {
    // RpcError.message contains the full JSON request params, which on a privacy
    // submission carry the proof blob and note-derived calldata.
    const error = Object.assign(
      new Error(
        'RPC: starknet_addInvokeTransaction with params {"proof":"c2VjcmV0UHJvb2ZCbG9iVmFsdWVIZXJl","calldata":["0x06f1a2b3c4d5e6f70819"]}',
      ),
      { baseError: { code: 41, data: { execution_error: "pool/bad-nullifier" }, message: "err" } },
    );
    let thrown = "";
    try {
      mapStrk20StageError("submission", error);
    } catch (caught) {
      thrown = caught instanceof Error ? caught.message : "";
    }
    expect(thrown).toContain("pool/bad-nullifier");
    expect(thrown).not.toContain("c2VjcmV0UHJvb2ZCbG9iVmFsdWVIZXJl");
    expect(thrown).not.toContain("0x06f1a2b3c4d5e6f70819");
    expect(thrown).not.toContain("params");
  });

  test("classifies nonce, fee, validation, proof, throttling, and transport failures", () => {
    const cases: readonly (readonly [unknown, string])[] = [
      [rpcError(52, "Invalid transaction nonce"), "invalid-nonce"],
      [rpcError(55, "insufficient max fee for validate"), "insufficient-fee"],
      [rpcError(55, "Account validation failed"), "validation-failed"],
      [rpcError(63, "proof rejected for base_block"), "proof-rejected"],
      [rpcError(-32_005, "rate limit exceeded"), "rate-limited"],
      [new Error("Proving service HTTP 429"), "rate-limited"],
      [new Error("Failed to fetch"), "transport"],
      [new Error("something else entirely"), "service-unavailable"],
    ];
    for (const [error, category] of cases) {
      expect(() => mapStrk20StageError("submission", error)).toThrow(`/${category})`);
    }
  });

  test("retries only explicit service throttling responses", () => {
    expect(isRetryableStrk20ServiceError(rpcError(-32_005, "rate limit exceeded"))).toBe(true);
    expect(isRetryableStrk20ServiceError(new Error("Proving service HTTP 429"))).toBe(true);
    expect(isRetryableStrk20ServiceError(rpcError(63, "proof rejected"))).toBe(false);
    expect(isRetryableStrk20ServiceError(new Error("Failed to fetch"))).toBe(false);
  });

  test("preserves reviewed wallet errors and the protocol base message", () => {
    // A already-mapped WalletError must pass through untouched so the curated
    // spec messages keep their exact wire form.
    expect(() => mapStrk20StageError("proving", new Error("account is not registered"))).toThrow(
      "account not registered in strk20 (proving/service-unavailable)",
    );
    expect(() => mapStrk20ProtocolError(new Error("not enough private notes"))).toThrow(
      "insufficient private balance",
    );
  });

  test("omits the detail suffix when nothing survives sanitizing", () => {
    let thrown = "";
    try {
      mapStrk20StageError("confirmation", { nothing: true });
    } catch (caught) {
      thrown = caught instanceof Error ? caught.message : "";
    }
    expect(thrown).toBe("strk20 services unavailable (confirmation/service-unavailable)");
  });
});
