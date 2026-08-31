/** Privacy-safe RPC diagnostic aggregation behavior. */
import { afterEach, describe, expect, test } from "bun:test";
import {
  explorerDiagnosticsSnapshot,
  recordExplorerDiagnostic,
  recordRpcDiagnostic,
  rpcDiagnosticsSnapshot,
  rpcEndpointClass,
  setReliabilityDiagnosticsEnabled,
} from "../../src/rpc/rpc-diagnostics";
import { timedRpcFetch } from "../../src/rpc/rpc-transport";

afterEach(() => setReliabilityDiagnosticsEnabled(false));

describe("RPC diagnostics", () => {
  test("retains only bounded endpoint and outcome aggregates when opted in", () => {
    setReliabilityDiagnosticsEnabled(true);
    recordRpcDiagnostic("wallet-gateway", "ok", 10);
    recordRpcDiagnostic("wallet-gateway", "ok", 20);
    recordExplorerDiagnostic("starkscan", "ok", 30);

    expect(rpcDiagnosticsSnapshot()).toEqual([
      { count: 2, endpoint: "wallet-gateway", latencyMs: 15, outcome: "ok" },
    ]);
    expect(rpcEndpointClass("https://wallet.nodes.starknet.org/rpc/mainnet/v0_10")).toBe(
      "wallet-gateway",
    );
    expect(rpcEndpointClass("https://mainnet.nodes.starknet.org/rpc/v0_10")).toBe("foundation");
    expect(explorerDiagnosticsSnapshot()).toEqual([
      { count: 1, latencyMs: 30, outcome: "ok", service: "starkscan" },
    ]);

    setReliabilityDiagnosticsEnabled(false);
    expect(rpcDiagnosticsSnapshot()).toEqual([]);
    expect(explorerDiagnosticsSnapshot()).toEqual([]);
  });

  test("classifies a stalled response body as a timeout", async () => {
    setReliabilityDiagnosticsEnabled(true);
    const rpcFetch = timedRpcFetch(
      5,
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull() {},
          }),
        ),
      () => 0,
    );

    await expect(rpcFetch("https://wallet.nodes.starknet.org/rpc/mainnet/v0_10")).rejects.toThrow(
      "Response timed out",
    );
    expect(rpcDiagnosticsSnapshot()).toEqual([
      { count: 1, endpoint: "wallet-gateway", latencyMs: 0, outcome: "timeout" },
    ]);
  });
});
