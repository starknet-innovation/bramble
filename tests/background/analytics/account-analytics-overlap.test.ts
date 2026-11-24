/** Timed-out SDK work and relay operations never inherit ambient account metadata. */
import { expect, test } from "bun:test";
import { withinStrk20WaitBudget } from "@bramble/privacy/official-sdk-budget";
import type { Strk20Service } from "@bramble/privacy/service";
import { createMemoryStore } from "@bramble/store/kv";
import {
  ANALYTICS_GATEWAY_ORIGIN,
  ANALYTICS_INSTALLATION_ID_KEY,
  createGatewayAnalytics,
  withGatewayAnalyticsFlows,
} from "../../../apps/extension/src/background/analytics/gateway-analytics";

const installation = "11111111-1111-4111-8111-111111111111";
const metadata = {
  appVersion: "0.10.10",
  platform: "chrome",
  releaseChannel: "production",
} as const;

// Controlled promises avoid clocks, sleeps and real network activity.
const signal = () => {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

test("a timed-out discovery continuing during another flow carries no account headers", async () => {
  const captured: Headers[] = [];
  let lookups = 0;
  const analytics = createGatewayAnalytics({
    enabled: () => true,
    metadata,
    randomUuid: () => installation,
    store: createMemoryStore(),
    account: async () => {
      lookups += 1;
      return { id: "b".repeat(64), provenance: "imported" };
    },
    http: async (_input, init) => {
      captured.push(new Headers(init?.headers));
      return new Response("{}");
    },
  });
  const startedA = signal(),
    continueA = signal(),
    continuedA = signal();
  const startedB = signal(),
    finishB = signal();
  let expireA = (): void => undefined;
  const service = withGatewayAnalyticsFlows(
    {
      async privateBalances(input: { readonly account: { readonly id: string } }) {
        if (input.account.id === "A")
          return withinStrk20WaitBudget(
            "discovering private notes",
            1,
            async () => {
              startedA.release();
              await continueA.promise;
              await analytics.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/api/strk20/discovery/next`);
              continuedA.release();
              return [];
            },
            (tick) => {
              expireA = tick;
              return () => undefined;
            },
          );
        startedB.release();
        await analytics.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/api/strk20/prover`);
        await finishB.promise;
        return [];
      },
    } as unknown as Strk20Service,
    analytics.withFlow,
  );
  const first = service.privateBalances({ account: { id: "A" } } as never);
  await startedA.promise;
  const handled = first.catch(() => undefined);
  expireA();
  await expect(first).rejects.toThrow("did not finish");
  await handled;
  const second = service.privateBalances({ account: { id: "B" } } as never);
  await startedB.promise;
  continueA.release();
  await continuedA.promise;
  finishB.release();
  await second;
  expect(captured).toHaveLength(2);
  expect(lookups).toBe(0);
  for (const headers of captured) {
    expect(headers.get("x-mc-installation-id")).toBe(installation);
    expect(headers.has("x-mc-account-id")).toBe(false);
    expect(headers.has("x-mc-account-provenance")).toBe(false);
  }
});

test("accepted-relay submission waits for its own flow and omits unowned account metadata", async () => {
  const store = createMemoryStore();
  await store.set(ANALYTICS_INSTALLATION_ID_KEY, installation);
  const uuids = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const captured: Headers[] = [];
  const analytics = createGatewayAnalytics({
    enabled: () => true,
    metadata,
    randomUuid: () => uuids.shift() ?? "invalid",
    store,
    account: async () => ({ id: "a".repeat(64), provenance: "created" }),
    http: async (_input, init) => {
      captured.push(new Headers(init?.headers));
      return new Response("{}");
    },
  });
  const started = signal(),
    finish = signal();
  let relayCalls = 0;
  const service = withGatewayAnalyticsFlows(
    {
      async privateBalances() {
        await analytics.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/api/strk20/discovery`);
        started.release();
        await finish.promise;
        return [];
      },
      async submitAcceptedRelay() {
        relayCalls += 1;
        await analytics.fetch(`${ANALYTICS_GATEWAY_ORIGIN}/api/strk20/paymaster`);
        return { transactionHash: "0x123" };
      },
    } as unknown as Strk20Service,
    analytics.withFlow,
  );
  const first = service.privateBalances({} as never);
  await started.promise;
  const relay = service.submitAcceptedRelay?.({} as never);
  await Promise.resolve();
  expect(relayCalls).toBe(0);
  finish.release();
  await Promise.all([first, relay]);
  expect(relayCalls).toBe(1);
  expect(captured.map((headers) => headers.get("x-mc-flow-id"))).toEqual([
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ]);
  expect(captured.every((headers) => !headers.has("x-mc-account-id"))).toBe(true);
});
