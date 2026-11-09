/** Caller and upstream policy of the local STRK20 dev gateway (Sherlock 199, 244). */
import { describe, expect, it } from "vitest";
import {
  bareHttpsOrigin,
  devGatewayCaller,
  devGatewayCorsHeaders,
  devGatewayPaymasterUrl,
  isDevGatewayPaymasterPath,
} from "./dev-gateway-policy";

const RELAY = "https://starknet.paymaster.avnu.fi";

describe("devGatewayPaymasterUrl", () => {
  it("joins plain segments below the relay origin", () => {
    expect(devGatewayPaymasterUrl(RELAY, "/api/strk20/paymaster", "")?.href).toBe(`${RELAY}/`);
    expect(devGatewayPaymasterUrl(RELAY, "/api/strk20/paymaster/v1/build", "?a=1")?.href).toBe(
      `${RELAY}/v1/build?a=1`,
    );
  });

  it("refuses a path that would extend the relay's host name", () => {
    expect(devGatewayPaymasterUrl(RELAY, "/api/strk20/paymaster.evil.example/x", "")).toBeNull();
    expect(devGatewayPaymasterUrl(RELAY, "/api/strk20/paymasterXYZ", "")).toBeNull();
  });

  it("refuses dots, escapes, and empty segments", () => {
    for (const path of [
      "/api/strk20/paymaster/a.b",
      "/api/strk20/paymaster/%2e%2e/x",
      "/api/strk20/paymaster//evil.example",
      "/api/strk20/paymaster/a@evil.example",
    ]) {
      expect(devGatewayPaymasterUrl(RELAY, path, "")).toBeNull();
    }
  });

  it("matches the paymaster leg only on a path boundary", () => {
    expect(isDevGatewayPaymasterPath("/api/strk20/paymaster")).toBe(true);
    expect(isDevGatewayPaymasterPath("/api/strk20/paymaster/v1")).toBe(true);
    expect(isDevGatewayPaymasterPath("/api/strk20/paymaster.evil.example")).toBe(false);
  });
});

describe("bareHttpsOrigin", () => {
  it("accepts a bare https origin, with or without a trailing slash", () => {
    expect(bareHttpsOrigin(RELAY)).toBe(RELAY);
    expect(bareHttpsOrigin(`${RELAY}/`)).toBe(RELAY);
  });

  it("refuses a path, credentials, plain http, or garbage", () => {
    for (const value of [
      `${RELAY}/v1`,
      "https://user@starknet.paymaster.avnu.fi",
      "http://starknet.paymaster.avnu.fi",
      "not a url",
    ]) {
      expect(bareHttpsOrigin(value)).toBeNull();
    }
  });
});

describe("devGatewayCaller", () => {
  it("admits Chrome and Firefox extension origins", () => {
    for (const origin of [
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      "moz-extension://0f8e7d6c-5b4a-4321-8fed-cba987654321",
    ]) {
      expect(devGatewayCaller(new Headers({ origin }))).toEqual({ allowed: true, origin });
    }
  });

  it("refuses web origins, the null origin, and lookalike extension origins", () => {
    for (const origin of [
      "http://localhost:5273",
      "https://evil.example",
      "null",
      "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    ]) {
      expect(devGatewayCaller(new Headers({ origin })).allowed).toBe(false);
    }
  });

  it("admits an origin-less request only with the privileged extension shape", () => {
    const privileged = {
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "none",
    };
    expect(devGatewayCaller(new Headers(privileged))).toEqual({ allowed: true, origin: null });
    expect(devGatewayCaller(new Headers()).allowed).toBe(false);
    expect(
      devGatewayCaller(new Headers({ ...privileged, referer: "https://evil.example/" })).allowed,
    ).toBe(false);
    expect(
      devGatewayCaller(new Headers({ ...privileged, "sec-fetch-site": "cross-site" })).allowed,
    ).toBe(false);
  });

  it("allows back only the caller's own origin", () => {
    expect(devGatewayCorsHeaders({ origin: null })).not.toHaveProperty(
      "Access-Control-Allow-Origin",
    );
    expect(
      devGatewayCorsHeaders({ origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" })[
        "Access-Control-Allow-Origin"
      ],
    ).toBe("chrome-extension://abcdefghijklmnopabcdefghijklmnop");
  });
});
