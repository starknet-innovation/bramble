/** Privacy-safe RPC diagnostic aggregation behavior. */
import { afterEach, describe, expect, test } from "bun:test";
import {
  recordRpcDiagnostic,
  rpcDiagnosticsSnapshot,
  rpcEndpointClass,
  setRpcDiagnosticsEnabled,
} from "../../src/rpc/rpc-diagnostics";

afterEach(() => setRpcDiagnosticsEnabled(false));

describe("RPC diagnostics", () => {
  test("retains only bounded endpoint and outcome aggregates when opted in", () => {
    setRpcDiagnosticsEnabled(true);
    recordRpcDiagnostic("wallet-gateway", "ok", 10);
    recordRpcDiagnostic("wallet-gateway", "ok", 20);

    expect(rpcDiagnosticsSnapshot()).toEqual([
      { count: 2, endpoint: "wallet-gateway", latencyMs: 15, outcome: "ok" },
    ]);
    expect(rpcEndpointClass("https://wallet.nodes.starknet.org/rpc/mainnet/v0_10")).toBe(
      "wallet-gateway",
    );
    expect(rpcEndpointClass("https://mainnet.nodes.starknet.org/rpc/v0_10")).toBe("foundation");

    setRpcDiagnosticsEnabled(false);
    expect(rpcDiagnosticsSnapshot()).toEqual([]);
  });
});
