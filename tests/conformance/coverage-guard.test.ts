/**
 * Coverage guard: proves the provider dispatch surface covers EXACTLY the
 * wallet_rpc.json spec method set (plus the two documented legacy mc_ aliases),
 * so nothing is silently missing or un-spec'd. The `Record<ProviderMethod, ...>`
 * and `Record<ProviderResultMethod, ...>` classifications are exhaustive over
 * their unions at compile time — adding or removing a ProviderMethod without
 * updating the spec table fails to compile or fails an assertion here.
 */
import { describe, expect, test } from "bun:test";
import type { ProviderMethod, ProviderRequest } from "../../src/provider/bridge";
import { readProviderRequestArguments, toRuntimeMessage } from "../../src/provider/bridge";
import type { ProviderResultMethod } from "../../src/provider/bridge-results";
import { ORIGIN, SPEC_METHOD_NAMES, SPEC_METHODS } from "./wallet-rpc-spec";

// The 15 spec method names, written out literally so the table itself cannot
// silently drop or rename one without this list disagreeing.
const REQUIRED_SPEC_METHODS: readonly ProviderMethod[] = [
  "wallet_supportedSpecs",
  "wallet_supportedWalletApi",
  "wallet_getPermissions",
  "wallet_requestAccounts",
  "wallet_requestChainId",
  "wallet_deploymentData",
  "wallet_switchStarknetChain",
  "wallet_watchAsset",
  "wallet_addStarknetChain",
  "wallet_addInvokeTransaction",
  "wallet_addDeclareTransaction",
  "wallet_strk20InvokeTransaction",
  "wallet_strk20PrepareInvoke",
  "wallet_strk20Balances",
  "wallet_signTypedData",
];

// Exhaustive over the ProviderMethod union: every member is classified as a
// spec method or a legacy alias. TypeScript errors if a union member is missing
// or an extra key is present, so the dispatch surface cannot drift from spec.
const METHOD_CLASSIFICATION: Record<ProviderMethod, "legacy" | "spec"> = {
  mc_accounts: "legacy",
  mc_requestAccounts: "legacy",
  wallet_addDeclareTransaction: "spec",
  wallet_addInvokeTransaction: "spec",
  wallet_addStarknetChain: "spec",
  wallet_deploymentData: "spec",
  wallet_getPermissions: "spec",
  wallet_requestAccounts: "spec",
  wallet_requestChainId: "spec",
  wallet_signTypedData: "spec",
  wallet_strk20Balances: "spec",
  wallet_strk20InvokeTransaction: "spec",
  wallet_strk20PrepareInvoke: "spec",
  wallet_supportedSpecs: "spec",
  wallet_supportedWalletApi: "spec",
  wallet_switchStarknetChain: "spec",
  wallet_watchAsset: "spec",
};

// Exhaustive over the ProviderResultMethod union used by toProviderPayload, held
// identical to the ProviderMethod classification so the result-shaping dispatch
// covers exactly the same set.
const RESULT_METHOD_CLASSIFICATION: Record<ProviderResultMethod, "legacy" | "spec"> = {
  mc_accounts: "legacy",
  mc_requestAccounts: "legacy",
  wallet_addDeclareTransaction: "spec",
  wallet_addInvokeTransaction: "spec",
  wallet_addStarknetChain: "spec",
  wallet_deploymentData: "spec",
  wallet_getPermissions: "spec",
  wallet_requestAccounts: "spec",
  wallet_requestChainId: "spec",
  wallet_signTypedData: "spec",
  wallet_strk20Balances: "spec",
  wallet_strk20InvokeTransaction: "spec",
  wallet_strk20PrepareInvoke: "spec",
  wallet_supportedSpecs: "spec",
  wallet_supportedWalletApi: "spec",
  wallet_switchStarknetChain: "spec",
  wallet_watchAsset: "spec",
};

const specClassified = (record: Record<string, "legacy" | "spec">): ReadonlySet<string> =>
  new Set(
    Object.entries(record)
      .filter(([, kind]) => kind === "spec")
      .map(([name]) => name),
  );

describe("wallet_rpc dispatch coverage guard", () => {
  test("the spec table encodes exactly the 15 spec methods, once each", () => {
    expect(SPEC_METHODS).toHaveLength(15);
    expect(SPEC_METHOD_NAMES.size).toBe(15);
    expect([...SPEC_METHOD_NAMES].sort()).toEqual([...REQUIRED_SPEC_METHODS].sort());
  });

  test("the ProviderMethod dispatch surface covers exactly the spec set", () => {
    // Fails if a spec method is unhandled (missing from the union classification)
    // or an extra non-legacy method appears that the table does not know about.
    expect([...specClassified(METHOD_CLASSIFICATION)].sort()).toEqual(
      [...SPEC_METHOD_NAMES].sort(),
    );
  });

  test("the result-shaping dispatch covers exactly the spec set", () => {
    expect([...specClassified(RESULT_METHOD_CLASSIFICATION)].sort()).toEqual(
      [...SPEC_METHOD_NAMES].sort(),
    );
  });

  test("every spec method is accepted and routed by the real bridge", () => {
    for (const entry of SPEC_METHODS) {
      const accepted = readProviderRequestArguments({
        method: entry.request.method,
        ...(entry.request.params === undefined ? {} : { params: entry.request.params }),
      });
      expect(accepted).not.toBeNull();
      expect(accepted?.method).toBe(entry.method);

      const request: ProviderRequest = entry.request;
      const routed = toRuntimeMessage(request, ORIGIN);
      expect(routed).not.toBeNull();
      expect(routed?.type).toBe(entry.runtimeType);
    }
  });
});
