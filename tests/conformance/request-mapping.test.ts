/**
 * Per-method request-mapping conformance: for every spec method, the REAL
 * bridge accepts a spec-shaped page request (snake_case param keys, optional
 * api_version) via `readProviderRequestArguments` and maps it to the exact
 * runtime message via `toRuntimeMessage`, and rejects malformed params so a bad
 * payload never reaches the background.
 */
import { describe, expect, test } from "bun:test";
import { isRecord, type Json } from "@bramble/core/json";
import type { ProviderRequest, RuntimeMessage } from "@bramble/wallet-protocol/bridge";
import {
  misaddressedProviderResponse,
  readProviderRequestArguments,
  toRuntimeMessage,
} from "@bramble/wallet-protocol/bridge";
import { ORIGIN, REQUEST_ID, SPEC_METHODS } from "./wallet-rpc-spec";

const isApiVersionOnly = (params: Json | undefined): boolean =>
  typeof params === "object" &&
  params !== null &&
  !Array.isArray(params) &&
  Object.keys(params).length === 1 &&
  Object.hasOwn(params, "api_version");

describe("wallet_rpc request mapping", () => {
  for (const entry of SPEC_METHODS) {
    describe(entry.method, () => {
      test("accepts the spec-shaped page request unchanged", () => {
        const accepted = readProviderRequestArguments({
          method: entry.request.method,
          ...(entry.request.params === undefined ? {} : { params: entry.request.params }),
        });
        expect(accepted).not.toBeNull();
        expect(accepted?.method).toBe(entry.method);
        if (entry.request.params !== undefined) {
          expect(accepted?.params).toEqual(entry.request.params);
        }
      });

      test("declares its documented snake_case param keys", () => {
        const params = entry.request.params;
        for (const key of entry.paramKeys) {
          expect(isRecord(params) && Object.hasOwn(params, key)).toBe(true);
        }
      });

      test("maps to the exact runtime message", () => {
        const request: ProviderRequest = entry.request;
        expect(toRuntimeMessage(request, ORIGIN)).toEqual(entry.expectedRuntime);
      });

      // wallet_signTypedData accepts a bare object AS the typed data (spec allows
      // passing typed_data directly), so junk is not rejected at the bridge — its
      // structural validation is deferred to the background (typedDataHash), which
      // the error-codes suite proves maps to INVALID_REQUEST_PAYLOAD (114).
      if (entry.method !== "wallet_signTypedData") {
        test("rejects malformed params rather than routing them", () => {
          const junk: Json = { unexpected_key: "boom" };
          const accepted = readProviderRequestArguments({ method: entry.method, params: junk });
          const mapped = accepted
            ? toRuntimeMessage({ id: REQUEST_ID, method: entry.method, params: junk }, ORIGIN)
            : null;
          expect(mapped).toBeNull();
        });
      }

      test("refuses to route to an untrusted (non-wallet) origin", () => {
        expect(toRuntimeMessage(entry.request, "not-a-url")).toBeNull();
      });

      if (isApiVersionOnly(entry.request.params)) {
        test("threads an omitted optional api_version (maps without it)", () => {
          const mapped = toRuntimeMessage({ id: REQUEST_ID, method: entry.method }, ORIGIN);
          expect(mapped).toEqual({ origin: ORIGIN, type: entry.runtimeType } as RuntimeMessage);
        });

        test("rejects a malformed api_version", () => {
          const mapped = toRuntimeMessage(
            { id: REQUEST_ID, method: entry.method, params: { api_version: "not.a.version.x" } },
            ORIGIN,
          );
          expect(mapped).toBeNull();
        });
      }
    });
  }
});

describe("misaddressedProviderResponse", () => {
  const id = "6f2d16aa-1111-4222-8333-944444444444";

  test("answers a bridge-addressed message with an invalid body", () => {
    const rejection = {
      error: { code: 114, message: "The request payload is invalid" },
      id,
      target: "bramble:page",
    } as const;
    // The page's pending promise must reject deterministically, never hang:
    // an unsupported method name (a dapp speaking a newer wallet API) …
    expect(
      misaddressedProviderResponse({
        id,
        method: "wallet_futureMethod",
        params: {},
        target: "bramble:content",
      }),
    ).toEqual(rejection);
    // … an unexpected extra key, and params the felt normalizer refuses.
    expect(
      misaddressedProviderResponse({
        extra: true,
        id,
        method: "wallet_requestChainId",
        target: "bramble:content",
      }),
    ).toEqual(rejection);
    expect(
      misaddressedProviderResponse({
        id,
        method: "wallet_requestAccounts",
        params: { note: "x".repeat(1_000_000) },
        target: "bramble:content",
      }),
    ).toEqual(rejection);
  });

  test("stays silent for foreign traffic and for valid requests", () => {
    // Foreign window traffic (wrong or missing target, malformed id) must
    // never receive a response the page could correlate.
    expect(misaddressedProviderResponse({ id, method: "x" })).toBeNull();
    expect(
      misaddressedProviderResponse({ id: "not-a-uuid", method: "x", target: "bramble:content" }),
    ).toBeNull();
    expect(misaddressedProviderResponse("junk")).toBeNull();
    // A request readProviderRequest accepts is handled normally, not salvaged.
    expect(
      misaddressedProviderResponse({
        id,
        method: "wallet_requestChainId",
        target: "bramble:content",
      }),
    ).toBeNull();
  });
});
