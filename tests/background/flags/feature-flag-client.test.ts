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
import { startFeatureFlags } from "../../../apps/extension/src/background/flags/feature-flag-boot";
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

const enabled = (sequence: number) =>
  publisher.sign(payload({ flags: { "swap.enabled": { enabled: true } }, sequence }));

// A store whose reads fail while `down` is set; writes always succeed.
const flakyStore = (): KeyValueStore & { down: boolean } => {
  const inner = createMemoryStore();
  const store = {
    down: false,
    get: async (key: string) => {
      if (store.down) throw new Error("storage down");
      return inner.get(key);
    },
    remove: (key: string) => inner.remove(key),
    set: (key: string, value: Parameters<KeyValueStore["set"]>[1]) => inner.set(key, value),
  };
  return store;
};

describe("feature-flag client", () => {
  test("bundled defaults before any document", async () => {
    const client = clientFor(serve(new Error("offline")));
    expect(await client.snapshot("SN_MAIN")).toEqual({
      flags: { "qsb.vaults": false, "swap.enabled": true },
      killed: [],
      overridable: ["qsb.vaults"],
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
      // No qsb.vaults rule in the document: the toggle flag stays at its bundled off.
      flags: { "qsb.vaults": false, "swap.enabled": false },
      killed: [],
      overridable: ["qsb.vaults"],
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

  test("keeps a kill after the last good document expires and the CDN is unreachable", async () => {
    const clock = { now: NOW };
    const client = clientFor(serve(await killed(3), new Error("offline")), { clock });
    await client.refresh();
    clock.now = NOW + 31 * 86_400_000;
    expect(await client.refresh({ force: true })).toBe("unreachable");
    expect(await client.snapshot("SN_MAIN")).toMatchObject({
      flags: { "swap.enabled": false },
      sequence: null,
      source: "bundled",
    });
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

  test("a clock that steps back keeps the rollback floor across a restart", async () => {
    // Kill accepted at NOW, then the device clock lands before that check
    // time and the worker restarts: the older "enabled" document must still
    // be refused, and the stored kill must still apply.
    const store = createMemoryStore();
    await clientFor(serve(await killed(7)), { store }).refresh();
    const restarted = clientFor(serve(await enabled(6)), {
      clock: { now: NOW - 3_600_000 },
      store,
    });
    expect(await restarted.snapshot("SN_MAIN")).toMatchObject({
      flags: { "swap.enabled": false },
      sequence: 7,
    });
    expect(await restarted.refresh({ force: true })).toBe("rollback");
    expect((await restarted.snapshot("SN_MAIN")).sequence).toBe(7);
  });

  test("an unreadable store neither resets the floor nor fetches, and is retried", async () => {
    const store = flakyStore();
    await clientFor(serve(await killed(7)), { store }).refresh();
    store.down = true;
    const served = serve(await enabled(6), await killed(8));
    const restarted = clientFor(served, { store });
    expect((await restarted.snapshot("SN_MAIN")).source).toBe("bundled");
    expect(await restarted.refresh({ force: true })).toBe("unreachable");
    expect(served.requests).toHaveLength(0);
    // Storage recovers: the state is read afresh, so the floor is still 7.
    store.down = false;
    expect((await restarted.snapshot("SN_MAIN")).sequence).toBe(7);
    expect(await restarted.refresh({ force: true })).toBe("rollback");
    expect(await restarted.refresh({ force: true })).toBe("accepted");
    expect((await restarted.snapshot("SN_MAIN")).sequence).toBe(8);
  });

  test("a remote kill applies even when no install bucket can be drawn", async () => {
    const served = serve(await killed(3));
    const client = createFeatureFlagClient({
      drawBucket: () => 10_000,
      fetch: served.fetch,
      now: () => NOW,
      store: createMemoryStore(),
      trustedKeys: publisher.trusted,
      version: "0.10.0",
    });
    expect(await client.refresh()).toBe("accepted");
    expect(await client.snapshot("SN_MAIN")).toMatchObject({
      flags: { "swap.enabled": false },
      sequence: 3,
      source: "remote",
    });
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
    expect(await restarted.snapshot("SN_MAIN")).toMatchObject({
      flags: { "swap.enabled": true },
      source: "bundled",
    });
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
        create: (name) => {
          created.push(name);
        },
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

  test("a rejected alarm creation is handled and the startup refresh still runs", async () => {
    const forced: boolean[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      startFeatureFlagRefresh({
        alarms: {
          create: async () => {
            throw new Error("alarms unavailable");
          },
          get: async () => undefined,
          onAlarm: { addListener: () => undefined },
        },
        client: {
          refresh: async (o) => {
            forced.push(o?.force ?? false);
            return "skipped";
          },
        },
        ready: Promise.resolve(),
      });
      await Bun.sleep(10);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(forced).toEqual([false]);
  });
});

describe("feature-flag boot", () => {
  test("a runtime whose manifest read throws still yields a working client", async () => {
    const reader = startFeatureFlags(
      {
        runtime: {
          getManifest: () => {
            throw new Error("Extension context invalidated.");
          },
        },
      },
      Promise.resolve(),
      () => createMemoryStore(),
    );
    expect(reader).not.toBe(bundledFeatureFlags);
    expect((await reader.snapshot("SN_MAIN")).flags).toEqual({
      "qsb.vaults": false,
      "swap.enabled": true,
    });
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
