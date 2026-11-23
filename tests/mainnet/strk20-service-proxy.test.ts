/** Route-confusion and traversal regression coverage for the local mainnet proxy. */
import { describe, expect, test } from "bun:test";
import { readStrk20ProxyRoute, strk20ProxyServiceUrls } from "./strk20-service-proxy";

describe("STRK20 live-test proxy routes", () => {
  test("accepts only the service paths and methods used by the wallet", () => {
    expect(readStrk20ProxyRoute("/strk20-e2e/discovery/ohttp-keys", "GET")).toEqual({
      path: "ohttp-keys",
      service: "discovery",
    });
    expect(readStrk20ProxyRoute("/strk20-e2e/discovery/v1/history", "POST")).toEqual({
      path: "v1/history",
      service: "discovery",
    });
    expect(readStrk20ProxyRoute("/strk20-e2e/prover", "POST")).toEqual({
      path: "",
      service: "prover",
    });
    expect(readStrk20ProxyRoute("/strk20-e2e/rpc/", "POST")).toEqual({
      path: "",
      service: "rpc",
    });
  });

  test("rejects method confusion, unknown routes, queries, and traversal", () => {
    expect(readStrk20ProxyRoute("/strk20-e2e/rpc", "GET")).toBeNull();
    expect(readStrk20ProxyRoute("/strk20-e2e/prover/ohttp-keys", "POST")).toBeNull();
    expect(readStrk20ProxyRoute("/strk20-e2e/discovery/private", "POST")).toBeNull();
    expect(readStrk20ProxyRoute("/strk20-e2e/discovery/../rpc", "POST")).toBeNull();
    expect(readStrk20ProxyRoute("/strk20-e2e/discovery/%2e%2e/rpc", "POST")).toBeNull();
    expect(readStrk20ProxyRoute("/strk20-e2e/discovery?service=rpc", "POST")).toBeNull();
  });

  test("service bases join the wallet's paths without a double slash", () => {
    const urls = strk20ProxyServiceUrls("http://127.0.0.1:1/strk20-e2e");
    const route = (url: string, method: string) =>
      readStrk20ProxyRoute(new URL(url).pathname, method);
    expect(urls.discoveryUrl.endsWith("/")).toBe(false);
    expect(urls.proverUrl.endsWith("/")).toBe(false);
    expect(route(`${urls.discoveryUrl}/v1/sync/preflight_check`, "POST")).toEqual({
      path: "v1/sync/preflight_check",
      service: "discovery",
    });
    expect(route(`${urls.discoveryUrl}/ohttp-keys`, "GET")?.service).toBe("discovery");
    expect(route(urls.proverUrl, "POST")?.service).toBe("prover");
    expect(route(urls.rpcUrl, "POST")?.service).toBe("rpc");
    // A trailing slash on the base used to give this path; the proxy 404s it.
    expect(
      readStrk20ProxyRoute("/strk20-e2e/discovery//v1/sync/preflight_check", "POST"),
    ).toBeNull();
  });
});
