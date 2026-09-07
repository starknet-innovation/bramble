/**
 * Per-method result-shape conformance: for every spec method, a well-formed
 * background result is mapped by the REAL `toProviderPayload` into a spec-valid
 * dapp result, then validated against the spec pattern/shape from the table
 * (padded hashes match ^0x(0[0-8][a-f0-9]{62})$, chain ids match CHAIN_ID,
 * arrays carry the right member shape, booleans are literal `true`).
 */
import { describe, expect, test } from "bun:test";
import { toProviderPayload } from "@bramble/wallet-protocol/bridge";
import { SPEC_METHODS } from "./wallet-rpc-spec";

describe("wallet_rpc result shapes", () => {
  for (const entry of SPEC_METHODS) {
    describe(entry.method, () => {
      test("maps a well-formed background result to a spec-valid payload", () => {
        const payload = toProviderPayload(entry.backgroundResult, entry.resultMethod);
        expect(payload.error).toBeUndefined();
        expect(payload.result).toBeDefined();
        expect(entry.validateResult(payload.result)).toBe(true);
      });

      test("a corrupt background result never yields a malformed success", () => {
        // A result missing its ok/shape must collapse to a spec error object,
        // not a partial success the dapp could misread.
        const payload = toProviderPayload({ ok: false }, entry.resultMethod);
        expect(payload.result).toBeUndefined();
        expect(typeof payload.error?.code).toBe("number");
      });
    });
  }
});
