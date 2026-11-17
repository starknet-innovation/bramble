/**
 * Background feature-flag client: the fail-closed ladder (fresh -> last good
 * -> bundled defaults), rollback protection across restarts, the request's
 * privacy shape, refresh throttling, and the privileged `wallet.featureFlags`
 * message.
 */
import { describe, expect, test } from "bun:test";
import type { BoundedHttpFetch } from "@bramble/core/http-json";
import { FEATURE_FLAG_URL, TRUSTED_FLAG_KEYS } from "@bramble/flags/catalog";
import { FEATURE_FLAG_BUCKET_KEY, FEATURE_FLAG_STORE_KEY } from "@bramble/flags/state";
import { importTrustedFlagKeys } from "@bramble/flags/verify";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import {
  FEATURE_FLAG_ALARM,
  startFeatureFlagRefresh,
} from "../../../apps/extension/src/background/flags/feature-flag-alarm";
import {
  bundledFeatureFlags,
  createFeatureFlagClient,
  FEATURE_FLAG_REFRESH_MS,
} from "../../../apps/extension/src/background/flags/feature-flag-client";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import {
  createTestPublisher,
  NOW,
  payload,
  stamp,
} from "../../../packages/features/flags/tests/support/flag-fixture";
import {
  contentSender,
  createWallet,
  extensionSender,
  testExtension,
} from "../../support/background-wallet-stub";

const publisher = await createTestPublisher();

type Served = { readonly fetch: BoundedHttpFetch; readonly requests: [string, RequestInit][] };

// Serves a scripted body (or failure) per call and records every request.
const serve = (...bodies: (string | Error | number)[]): Served => {
  const requests: [string, RequestInit][] = [];
  let index = 0;
  return {
    fetch: async (url, init) => {
      requests.push([url, init]);
      const body = bodies[Math.min(index, bodies.length - 1)];
      index += 1;
      if (body instanceof Error) throw body;
      if (typeof body === "number") return new Response("nope", { status: body });
      return new Response(body ?? "");
    },
    requests,
  };
};

const clientFor = (
  served: Served,
  {
    clock = { now: NOW },
    store = createMemoryStore(),
  }: { clock?: { now: number }; store?: KeyValueStore } = {},
) =>
  createFeatureFlagClient({
    drawBucket: () => 0,
    fetch: served.fetch,
    now: () => clock.now,
    store,
    trustedKeys: publisher.trusted,
    version: "0.10.0",
  });

const killed = (sequence: number, overrides: Record<string, unknown> = {}) =>
  publisher.sign(
    payload({ flags: { "swap.enabled": { enabled: false } }, sequence, ...overrides }),
  );

describe("feature-flag client", () => {
  test("bundled defaults before any document", async () => {
    const client = clientFor(serve(new Error("offline")));
    expect(await client.snapshot("SN_MAIN")).toEqual({
      flags: { "swap.enabled": true },
      killed: [],
      overridable: [],
      overridden: [],
      sequence: null,
      source: "bundled",
    });
    expect(await client.refresh()).toBe("unreachable");
    expect((await client.snapshot("SN_MAIN")).source).toBe("bundled");
  });

  test("applies a verified document and persists it", async () => {
    const store = createMemoryStore();
    const client = clientFor(serve(await killed(3)), { store });
    expect(await client.refresh()).toBe("accepted");
    expect(await client.snapshot("SN_MAIN")).toEqual({
      flags: { "swap.enabled": false },
      killed: [],
      overridable: [],
      overridden: [],
      sequence: 3,
      source: "remote",
    });
    expect(await store.get(FEATURE_FLAG_STORE_KEY)).toMatchObject({ sequence: 3 });
  });

  test("a rejected or failed refresh keeps the last good document", async () => {
    const tampered = (await killed(4)).replace('"enabled":false', '"enabled":true');
    const client = clientFor(serve(await killed(3), tampered, 503, "{"));
    await client.refresh();
    expect(await client.refresh({ force: true })).toBe("bad-signature");
    expect(await client.refresh({ force: true })).toBe("unreachable");
    expect(await client.refresh({ force: true })).toBe("malformed");
    expect(await client.snapshot("SN_MAIN")).toMatchObject({ sequence: 3, source: "remote" });
  });

  test("falls back to bundled defaults once the last good document expires", async () => {
    const clock = { now: NOW };
    const client = clientFor(serve(await killed(3), new Error("offline")), { clock });
    await client.refresh();
    clock.now = NOW + 31 * 86_400_000;
    expect(await client.refresh({ force: true })).toBe("unreachable");
    expect((await client.snapshot("SN_MAIN")).source).toBe("bundled");
  });

  test("rejects rollback across a worker restart, then accepts a newer document", async () => {
    const store = createMemoryStore();
    await clientFor(serve(await killed(7)), { store }).refresh();
    const restarted = clientFor(serve(await killed(6), await killed(8)), { store });
    expect((await restarted.snapshot("SN_MAIN")).sequence).toBe(7);
    expect(await restarted.refresh({ force: true })).toBe("rollback");
    expect(await restarted.refresh({ force: true })).toBe("accepted");
    expect((await restarted.snapshot("SN_MAIN")).sequence).toBe(8);
  });

  test("a stored copy that no longer verifies is not applied", async () => {
    const store = createMemoryStore();
    await clientFor(serve(await killed(3)), { store }).refresh();
    const stored = (await store.get(FEATURE_FLAG_STORE_KEY)) as Record<string, unknown>;
    await store.set(FEATURE_FLAG_STORE_KEY, {
      ...stored,
      document: String(stored["document"]).replace('"enabled":false', '"enabled":true'),
    });
    const restarted = clientFor(serve(new Error("offline")), { store });
    expect((await restarted.snapshot("SN_MAIN")).source).toBe("bundled");
  });

  test("rejects documents for other channels and expired documents", async () => {
    const client = clientFor(
      serve(await killed(3, { channel: "beta" }), await killed(3, { expiresAt: stamp(NOW) })),
    );
    expect(await client.refresh()).toBe("wrong-channel");
    expect(await client.refresh({ force: true })).toBe("expired");
  });

  test("sends a bare GET of the fixed URL: no query, headers, cookies, or referrer", async () => {
    const served = serve(await killed(3));
    await clientFor(served).refresh();
    const [[url, init]] = served.requests as [[string, RequestInit]];
    expect(url).toBe(FEATURE_FLAG_URL);
    expect(new URL(url).search).toBe("");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  test("never transmits the install bucket", async () => {
    const store = createMemoryStore();
    const served = serve(await killed(3));
    const client = createFeatureFlagClient({
      drawBucket: () => 7321,
      fetch: served.fetch,
      now: () => NOW,
      store,
      trustedKeys: publisher.trusted,
      version: "0.10.0",
    });
    await client.snapshot("SN_MAIN");
    await client.refresh();
    expect(await store.get(FEATURE_FLAG_BUCKET_KEY)).toBe(7321);
    expect(JSON.stringify(served.requests)).not.toContain("7321");
  });

  test("throttles non-forced refreshes; forced ones always fetch", async () => {
    const clock = { now: NOW };
    const served = serve(await killed(3));
    const client = clientFor(served, { clock });
    await client.refresh();
    expect(await client.refresh()).toBe("skipped");
    expect(await client.refresh({ force: true })).toBe("accepted");
    clock.now += FEATURE_FLAG_REFRESH_MS;
    expect(await client.refresh()).toBe("accepted");
    expect(served.requests).toHaveLength(3);
  });

  test("the bundled production key imports", async () => {
    expect([...(await importTrustedFlagKeys(TRUSTED_FLAG_KEYS)).keys()]).toEqual(["flags-2026-11"]);
  });
});

describe("feature-flag refresh scheduling", () => {
  test("creates the alarm only when missing and force-refreshes on it", async () => {
    const created: string[] = [];
    let listener: ((alarm: { name: string }) => void) | undefined;
    const forced: boolean[] = [];
    startFeatureFlagRefresh({
      alarms: {
        create: (name) => created.push(name),
        get: async () => undefined,
        onAlarm: { addListener: (l) => (listener = l) },
      },
      client: {
        refresh: async (o) => {
          forced.push(o?.force ?? false);
          return "skipped";
        },
      },
      ready: Promise.resolve(),
    });
    await Bun.sleep(0);
    listener?.({ name: "bramble:tx-monitor-fast" });
    listener?.({ name: FEATURE_FLAG_ALARM });
    await Bun.sleep(0);
    expect(created).toEqual([FEATURE_FLAG_ALARM]);
    expect(forced).toEqual([false, true]);
  });
});

describe("wallet.featureFlags message", () => {
  test("answers extension pages with the snapshot for the active chain", async () => {
    const chains: (string | null)[] = [];
    const handler = createMessageHandler(createWallet(), testExtension, {
      featureFlags: {
        ...bundledFeatureFlags,
        snapshot: async (chain) => {
          chains.push(chain);
          return {
            flags: { "swap.enabled": false },
            killed: [],
            overridable: [],
            overridden: [],
            sequence: 9,
            source: "remote",
          };
        },
      },
    });
    expect(await handler({ type: "wallet.featureFlags" }, extensionSender)).toEqual({
      flags: { "swap.enabled": false },
      killed: [],
      ok: true,
      overridable: [],
      overridden: [],
      sequence: 9,
      source: "remote",
    });
    expect(chains).toHaveLength(1);
  });

  test("defaults to bundled values and refuses content scripts and extra fields", async () => {
    const handler = createMessageHandler(createWallet(), testExtension);
    expect(await handler({ type: "wallet.featureFlags" }, extensionSender)).toMatchObject({
      flags: { "swap.enabled": true },
      source: "bundled",
    });
    expect(await handler({ type: "wallet.featureFlags" }, contentSender)).toEqual({
      error: "privileged sender required",
    });
    expect(await handler({ refresh: true, type: "wallet.featureFlags" }, extensionSender)).toEqual({
      error: "invalid feature flags request",
    });
  });
});
