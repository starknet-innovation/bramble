/**
 * Mapping a Starknet node's structured RPC rejection into the wallet error the
 * extension UI shows. Pins the security contract: only `code` and the
 * `revert_reason` / `execution_error` strings under `data` are read, every
 * surfaced string is sanitized (hex runs elided, non-printables dropped, length
 * capped), and any shape that is not a record with a numeric `code` fails
 * closed to `null` so the caller keeps its original error.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "../../src/shared/errors";
import { RPC_FAILURE_PREFIX, rpcFailureError } from "../../src/shared/rpc-failure";

// The verbatim sentence a mainnet node returns when a transaction exceeds the
// per-transaction L2 gas cap — the reason the wallet used to throw away.
const L2_GAS_REASON = "Insufficient max L2Gas: max amount: 1200000000, actual used: 1378435600.";

const reasonOf = (baseError: unknown): string | null => rpcFailureError(baseError)?.message ?? null;

describe("rpcFailureError", () => {
  test("surfaces the node's execution_error verbatim for the L2 gas cap", () => {
    const mapped = rpcFailureError({
      code: 41,
      data: { execution_error: L2_GAS_REASON, transaction_index: 0 },
      message: "Transaction execution error",
    });

    expect(mapped).toBeInstanceOf(WalletError);
    expect(mapped?.message).toBe(
      `${RPC_FAILURE_PREFIX} (RPC error 41): Insufficient max L2Gas: max amount: 1200000000, actual used: 1378435600.`,
    );
  });

  test("prefers revert_reason and reads a bare string data payload", () => {
    expect(reasonOf({ code: 41, data: { revert_reason: "ERC20: insufficient balance" } })).toBe(
      `${RPC_FAILURE_PREFIX} (RPC error 41): ERC20: insufficient balance`,
    );
    expect(
      reasonOf({ code: 21, data: "Requested entrypoint does not exist in the contract" }),
    ).toBe(
      `${RPC_FAILURE_PREFIX} (RPC error 21): Requested entrypoint does not exist in the contract`,
    );
  });

  test("descends nested contract execution frames to the innermost reason", () => {
    expect(
      reasonOf({
        code: 41,
        data: {
          execution_error: {
            class_hash: "0x3713ea370d460957014cc4b56ad7d7cbaa5f3fde485a73e9ebbea7d695bd91f",
            contract_address: "0x5bf9b9d20523fa4a502cc16ae76f26a228dd73de7d1bcd4078b89cc5e0069ac",
            error: { error: "Caller is not the owner", selector: "0x2dea79ca" },
          },
        },
      }),
    ).toBe(`${RPC_FAILURE_PREFIX} (RPC error 41): Caller is not the owner`);
  });

  test("elides long hex runs so addresses and proof limbs never reach the message", () => {
    const mapped = reasonOf({
      code: 41,
      data: {
        execution_error: `Execution failed in contract 0x5bf9b9d20523fa4a502cc16ae76f26a228dd73de7d1bcd4078b89cc5e0069ac (selector 0x2dea79ca7872696259db3c4c16f2d2233f8f0a77600ef73084028b0a6ab43b1)`,
      },
    });

    expect(mapped).toBe(
      `${RPC_FAILURE_PREFIX} (RPC error 41): Execution failed in contract 0x... (selector 0x...)`,
    );
    expect(mapped).not.toContain("5bf9b9d2");
  });

  test("collapses whitespace, drops non-printables, and caps the length", () => {
    expect(reasonOf({ code: 41, data: { revert_reason: "  line one\n\tline\u0000 two  " } })).toBe(
      `${RPC_FAILURE_PREFIX} (RPC error 41): line one line two`,
    );

    // Also covers the pre-scan bound: an oversized payload is windowed before
    // any pattern runs, so the cost stays fixed no matter what the node returns.
    for (const size of [400, 5_000_000]) {
      const long = reasonOf({ code: 41, data: { revert_reason: "z".repeat(size) } }) ?? "";
      expect(long.endsWith("...")).toBe(true);
      // Prefix + " (RPC error 41): " + 200 reason characters + the "..." marker.
      expect(long.length).toBe(RPC_FAILURE_PREFIX.length + " (RPC error 41): ".length + 203);
    }
  });

  test("names the code alone when the node supplies no usable reason", () => {
    expect(reasonOf({ code: 41, data: { execution_error: "   " } })).toBe(
      `${RPC_FAILURE_PREFIX} (RPC error 41).`,
    );
    expect(reasonOf({ code: 63, data: { revert_reason: 12345 } })).toBe(
      `${RPC_FAILURE_PREFIX} (RPC error 63).`,
    );
    expect(reasonOf({ code: 41 })).toBe(`${RPC_FAILURE_PREFIX} (RPC error 41).`);
  });

  test("stops descending a self-referential execution_error rather than spinning", () => {
    const looping: Record<string, unknown> = {};
    looping["error"] = looping;

    expect(reasonOf({ code: 41, data: { execution_error: looping } })).toBe(
      `${RPC_FAILURE_PREFIX} (RPC error 41).`,
    );
  });

  test("fails closed to null for anything that is not a coded node rejection", () => {
    expect(rpcFailureError(null)).toBeNull();
    expect(rpcFailureError(undefined)).toBeNull();
    expect(rpcFailureError("Transaction execution error")).toBeNull();
    expect(rpcFailureError({ message: "no code here" })).toBeNull();
    expect(rpcFailureError({ code: "41" })).toBeNull();
  });
});
