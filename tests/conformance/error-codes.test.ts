/**
 * Per-method error-code conformance: every mandated wallet_rpc error carries its
 * correct NUMERIC code on the dapp wire. Driven through the REAL
 * `toProviderPayload`, which maps a background error string to a spec
 * `{ code, message }` object — the exact mapping a dapp branches on. Covers
 * USER_REFUSED_OP (113) on deny for every state-changing method,
 * INVALID_REQUEST_PAYLOAD (114) for malformed params, and the method-specific
 * codes (115/116 deploymentData, 117 switch, 162 api-version, 118/119/120
 * STRK20).
 */
import { describe, expect, test } from "bun:test";
import { toProviderPayload } from "@bramble/wallet-protocol/bridge";
import { ERROR_CODES, SPEC_METHODS } from "./wallet-rpc-spec";

// A representative background error string for each numeric code reachable
// through the wallet's error boundary (errorForMessage). Codes 111/112 are
// spec-listed for watch/switch but the wallet routes those failures through
// 114/117 respectively, so they are documented in the table, not driven here.
const REACHABLE: Readonly<Record<number, string>> = {
  [ERROR_CODES.USER_REFUSED_OP]: "request rejected",
  [ERROR_CODES.INVALID_REQUEST_PAYLOAD]: "invalid request payload",
  [ERROR_CODES.ACCOUNT_ALREADY_DEPLOYED]: "account already deployed",
  [ERROR_CODES.DEPLOYMENT_DATA_NOT_AVAILABLE]: "deployment data not available",
  [ERROR_CODES.CHAIN_ID_NOT_SUPPORTED]: "unsupported chain",
  [ERROR_CODES.NOT_REGISTERED]: "account not registered in strk20",
  [ERROR_CODES.INSUFFICIENT_PRIVATE_BALANCE]: "insufficient private balance",
  [ERROR_CODES.PRIVACY_LEAK]: "strk20 privacy leak",
  [ERROR_CODES.API_VERSION_NOT_SUPPORTED]: "unsupported api version",
  [ERROR_CODES.UNKNOWN_ERROR]: "something unexpected happened",
};

describe("wallet_rpc error codes", () => {
  for (const entry of SPEC_METHODS) {
    describe(entry.method, () => {
      for (const code of entry.errorCodes) {
        const sample = REACHABLE[code];
        if (sample === undefined) {
          continue;
        }
        test(`maps its ${code} failure to numeric code ${code} on the wire`, () => {
          const payload = toProviderPayload({ error: sample }, entry.resultMethod);
          expect(payload.result).toBeUndefined();
          expect(payload.error?.code).toBe(code);
          expect(typeof payload.error?.message).toBe("string");
          expect(payload.error?.message.length).toBeGreaterThan(0);
        });
      }

      if (entry.stateChanging) {
        test("a denied held request reaches the dapp as USER_REFUSED_OP (113)", () => {
          // Connect settles a deny with "connection rejected"; all other held
          // methods settle with "request rejected". Both must map to 113.
          const denyString =
            entry.method === "wallet_requestAccounts" ? "connection rejected" : "request rejected";
          const payload = toProviderPayload({ error: denyString }, entry.resultMethod);
          expect(payload.error?.code).toBe(ERROR_CODES.USER_REFUSED_OP);
        });
      }

      test("a malformed-params failure reaches the dapp as 114", () => {
        const payload = toProviderPayload(
          { error: `invalid ${entry.method} request` },
          entry.resultMethod,
        );
        expect(payload.error?.code).toBe(ERROR_CODES.INVALID_REQUEST_PAYLOAD);
      });
    });
  }

  test("every state-changing spec method mandates USER_REFUSED_OP (113)", () => {
    for (const entry of SPEC_METHODS) {
      if (entry.stateChanging) {
        expect(entry.errorCodes).toContain(ERROR_CODES.USER_REFUSED_OP);
      }
    }
  });
});
