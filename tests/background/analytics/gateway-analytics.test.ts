/** Gateway analytics stays exact-origin, user-controllable, and pseudonymous. */

import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@mc-wallet/store/kv";
import {
  ANALYTICS_GATEWAY_ORIGIN,
  ANALYTICS_INSTALLATION_ID_KEY,
  analyticsPlatform,
  analyticsReleaseChannel,
  createGatewayAnalytics,
} from "../../../apps/extension/src/background/analytics/gateway-analytics";

const INSTALLATION_ID = "11111111-1111-4111-8111-111111111111";
const FIRST_FLOW_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_FLOW_ID = "33333333-3333-4333-8333-333333333333";

const metadata = {
  appVersion: "0.10.0",
  platform: "chrome" as const,
  releaseChannel: "production" as const,
};

type CapturedRequest = {
  readonly init: RequestInit | undefined;
  readonly input: RequestInfo | URL;
};

const captureHttp = (): {
  readonly calls: CapturedRequest[];
  readonly http: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
} => {
  const calls: CapturedRequest[] = [];
  return {
    calls,
    http: async (input, init) => {
      calls.push({ init, input });
      return new Response("{}", { headers: { "content-type": "application/json" } });
    },
  };
};

const callAt = (calls: readonly CapturedRequest[], index: number): CapturedRequest => {
  const call = calls[index];
  if (!call) throw new Error(`missing captured request ${index}`);
  return call;
};

const headersFor = (call: CapturedRequest): Headers => new Headers(call.init?.headers);
const headersAt = (calls: readonly CapturedRequest[], index: number): Headers =>
  headersFor(callAt(calls, index));

describe("gateway analytics fetch", () => {
  test("persists one installation id and adds the complete set only to the gateway", async () => {
    const store = createMemoryStore();
    const firstCapture = captureHttp();
    const first = createGatewayAnalytics({
      enabled: () => true,
      http: firstCapture.http,
      metadata,
      randomUuid: () => INSTALLATION_ID,
      store,
    });

    await first.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/rpc/mainnet/v0_10`, {
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const gatewayHeaders = headersAt(firstCapture.calls, 0);
    expect(gatewayHeaders.get("x-mc-installation-id")).toBe(INSTALLATION_ID);
    expect(gatewayHeaders.get("x-mc-app-version")).toBe("0.10.0");
    expect(gatewayHeaders.get("x-mc-platform")).toBe("chrome");
    expect(gatewayHeaders.get("x-mc-release-channel")).toBe("production");
    expect(gatewayHeaders.get("content-type")).toBe("application/json");
    expect(await store.get(ANALYTICS_INSTALLATION_ID_KEY)).toBe(INSTALLATION_ID);

    let regenerated = false;
    const secondCapture = captureHttp();
    const afterRestart = createGatewayAnalytics({
      enabled: () => true,
      http: secondCapture.http,
      metadata,
      randomUuid: () => {
        regenerated = true;
        return SECOND_FLOW_ID;
      },
      store,
    });
    await afterRestart.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/rpc/sepolia/v0_10`);
    expect(headersAt(secondCapture.calls, 0).get("x-mc-installation-id")).toBe(INSTALLATION_ID);
    expect(regenerated).toBe(false);

    const outside = captureHttp();
    const exactOrigin = createGatewayAnalytics({
      enabled: () => true,
      http: outside.http,
      metadata,
      randomUuid: () => INSTALLATION_ID,
      store,
    });
    const init = { headers: { accept: "application/json" } };
    await exactOrigin.fetch("https://wallet.nodes.starknet.org.example/rpc", init);
    expect(callAt(outside.calls, 0).init).toBe(init);
    expect(headersAt(outside.calls, 0).get("x-mc-installation-id")).toBeNull();
  });

  test("sends no partial or caller-spoofed metadata while disabled", async () => {
    const capture = captureHttp();
    let randomCalls = 0;
    const analytics = createGatewayAnalytics({
      enabled: () => false,
      http: capture.http,
      metadata,
      randomUuid: () => {
        randomCalls += 1;
        return INSTALLATION_ID;
      },
      store: createMemoryStore(),
    });
    const spoofed = {
      "x-mc-app-version": "spoofed",
      "x-mc-flow-id": FIRST_FLOW_ID,
      "x-mc-installation-id": INSTALLATION_ID,
      "x-mc-platform": "other",
      "x-mc-release-channel": "development",
    };

    await analytics.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/rpc/mainnet/v0_10`, {
      headers: spoofed,
    });
    await analytics.fetch("https://rpc.example", { headers: spoofed });

    for (const call of capture.calls) {
      const headers = headersFor(call);
      expect(headers.get("x-mc-installation-id")).toBeNull();
      expect(headers.get("x-mc-app-version")).toBeNull();
      expect(headers.get("x-mc-platform")).toBeNull();
      expect(headers.get("x-mc-release-channel")).toBeNull();
      expect(headers.get("x-mc-flow-id")).toBeNull();
    }
    expect(randomCalls).toBe(0);
  });

  test("groups STRK20 requests into serialized transient flows", async () => {
    const capture = captureHttp();
    const uuids = [FIRST_FLOW_ID, INSTALLATION_ID, SECOND_FLOW_ID];
    const analytics = createGatewayAnalytics({
      enabled: () => true,
      http: capture.http,
      metadata,
      randomUuid: () => uuids.shift() ?? "invalid",
      store: createMemoryStore(),
    });
    let releaseFirst = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstRequestDone = (): void => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      firstRequestDone = resolve;
    });

    const first = analytics.withFlow(async () => {
      await analytics.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/api/strk20/discovery`);
      firstRequestDone();
      await held;
      await analytics.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/api/strk20/prover`);
    });
    await firstStarted;
    const second = analytics.withFlow(() =>
      analytics.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/api/strk20/paymaster`).then(() => undefined),
    );
    await Promise.resolve();
    expect(capture.calls).toHaveLength(1);
    releaseFirst();
    await Promise.all([first, second]);

    const flows = capture.calls.map((call) => headersFor(call).get("x-mc-flow-id"));
    expect(flows).toEqual([FIRST_FLOW_ID, FIRST_FLOW_ID, SECOND_FLOW_ID]);
    expect(capture.calls.map((call) => headersFor(call).get("x-mc-installation-id"))).toEqual([
      INSTALLATION_ID,
      INSTALLATION_ID,
      INSTALLATION_ID,
    ]);

    await analytics.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/rpc/mainnet/v0_10`);
    expect(headersAt(capture.calls, 3).get("x-mc-flow-id")).toBeNull();
  });

  test("omits metadata when persistence or app metadata is unusable", async () => {
    const capture = captureHttp();
    const failingStore = {
      get: async (): Promise<unknown> => {
        throw new Error("storage unavailable");
      },
      remove: async (): Promise<void> => undefined,
      set: async (): Promise<void> => undefined,
    };
    const analytics = createGatewayAnalytics({
      enabled: () => true,
      http: capture.http,
      metadata: { ...metadata, appVersion: "invalid version" },
      randomUuid: () => INSTALLATION_ID,
      store: failingStore,
    });
    await analytics.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/rpc/mainnet/v0_10`);
    expect(headersAt(capture.calls, 0).get("x-mc-installation-id")).toBeNull();

    const storageFailure = createGatewayAnalytics({
      enabled: () => true,
      http: capture.http,
      metadata,
      randomUuid: () => INSTALLATION_ID,
      store: failingStore,
    });
    await storageFailure.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/rpc/mainnet/v0_10`);
    expect(headersAt(capture.calls, 1).get("x-mc-installation-id")).toBeNull();
  });
});

describe("gateway analytics build metadata", () => {
  test("reduces browser and branch inputs to bounded categories", () => {
    expect(analyticsPlatform("Mozilla/5.0 Chrome/140.0", true)).toBe("brave");
    expect(analyticsPlatform("Mozilla/5.0 Edg/140.0")).toBe("edge");
    expect(analyticsPlatform("Mozilla/5.0 Firefox/142.0")).toBe("firefox");
    expect(analyticsPlatform("Mozilla/5.0 Chrome/140.0")).toBe("chrome");
    expect(analyticsPlatform("unknown")).toBe("other");
    expect(analyticsReleaseChannel("")).toBe("production");
    expect(analyticsReleaseChannel("beta/v0.11")).toBe("beta");
    expect(analyticsReleaseChannel("feature/analytics")).toBe("development");
  });
});
