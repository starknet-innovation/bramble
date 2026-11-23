/**
 * Local feature-flag overrides through the background client and its
 * privileged messages: overrides persist across restarts, never beat a remote
 * hard kill, need an unlocked wallet, and are unreachable from content scripts.
 */
import { describe, expect, test } from "bun:test";
import type { FlagCatalog } from "@bramble/flags/catalog";
import { FEATURE_FLAG_OVERRIDES_KEY } from "@bramble/flags/overrides";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import {
  bundledFeatureFlags,
  createFeatureFlagClient,
} from "../../../apps/extension/src/background/flags/feature-flag-client";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  createTestPublisher,
  NOW,
  payload,
} from "../../../packages/features/flags/tests/support/flag-fixture";
import {
  contentSender,
  createWallet,
  extensionSender,
  testExtension,
} from "../../support/background-wallet-stub";

const publisher = await createTestPublisher();

const CATALOG: FlagCatalog = {
  "beta.panel": { enabled: false, localOverride: true, remote: "toggle" },
  "beta.screen": { enabled: false, localOverride: true, remote: "toggle" },
  "swap.enabled": { enabled: true, remote: "kill-only" },
};

const clientFor = (store: KeyValueStore = createMemoryStore(), body?: string) =>
  createFeatureFlagClient({
    catalog: CATALOG,
    drawBucket: () => 0,
    fetch: async () => (body === undefined ? Response.error() : new Response(body)),
    now: () => NOW,
    store,
    trustedKeys: publisher.trusted,
    version: "0.10.0",
  });

describe("feature-flag client overrides", () => {
  test("lists overridable flags and applies a set override", async () => {
    const client = clientFor();
    expect(await client.snapshot("SN_MAIN")).toMatchObject({
      flags: { "beta.screen": false },
      overridable: ["beta.panel", "beta.screen"],
      overridden: [],
    });
    expect(await client.setOverride("beta.screen", true)).toBe("applied");
    expect(await client.snapshot("SN_MAIN")).toMatchObject({
      flags: { "beta.screen": true, "swap.enabled": true },
      overridden: ["beta.screen"],
      source: "bundled",
    });
  });

  test("refuses flags that are not overridable", async () => {
    const client = clientFor();
    expect(await client.setOverride("swap.enabled", false)).toBe("not-overridable");
    expect(await client.setOverride("unknown", true)).toBe("not-overridable");
    expect((await client.snapshot(null)).flags["swap.enabled"]).toBe(true);
  });

  test("overrides survive a restart; clearing one or all restores the evaluated value", async () => {
    const store = createMemoryStore();
    await clientFor(store).setOverride("beta.screen", true);
    const restarted = clientFor(store);
    expect((await restarted.snapshot(null)).flags["beta.screen"]).toBe(true);
    expect(await restarted.setOverride("beta.screen", null)).toBe("applied");
    expect(await store.get(FEATURE_FLAG_OVERRIDES_KEY)).toBeUndefined();
    await restarted.setOverride("beta.screen", true);
    expect(await restarted.clearOverrides()).toBe("applied");
    expect(await restarted.snapshot(null)).toMatchObject({
      flags: { "beta.screen": false },
      overridden: [],
    });
  });

  test("a remote hard kill beats a stored override", async () => {
    const kill = await publisher.sign(payload({ flags: { "beta.screen": { enabled: false } } }));
    const client = clientFor(createMemoryStore(), kill);
    await client.setOverride("beta.screen", true);
    expect(await client.refresh()).toBe("accepted");
    expect(await client.snapshot("SN_MAIN")).toMatchObject({
      flags: { "beta.screen": false },
      killed: ["beta.screen"],
      overridden: [],
      source: "remote",
    });
  });

  test("two rapid overrides both persist", async () => {
    // Each write re-reads the whole map, so unserialised writes would clobber
    // each other; the second must see the first.
    const store = createMemoryStore();
    const client = clientFor(store);
    const results = await Promise.all([
      client.setOverride("beta.panel", true),
      client.setOverride("beta.screen", true),
    ]);
    expect(results).toEqual(["applied", "applied"]);
    expect(await store.get(FEATURE_FLAG_OVERRIDES_KEY)).toMatchObject({
      flags: { "beta.panel": true, "beta.screen": true },
    });
    expect((await clientFor(store).snapshot("SN_MAIN")).overridden).toEqual([
      "beta.panel",
      "beta.screen",
    ]);
  });

  test("a store that refuses writes reports unavailable and changes nothing", async () => {
    const store = createMemoryStore();
    const client = clientFor({ ...store, set: async () => Promise.reject(new Error("full")) });
    expect(await client.setOverride("beta.screen", true)).toBe("unavailable");
    expect((await client.snapshot(null)).overridden).toEqual([]);
  });
});

describe("feature-flag override messages", () => {
  const handlerFor = (unlocked: boolean) => {
    const session = createUnlockSession();
    if (unlocked) session.unlock("test-passphrase");
    return createMessageHandler(createWallet(), testExtension, {
      featureFlags: clientFor(),
      session,
    });
  };

  test("sets and clears an override for an unlocked extension page", async () => {
    const handler = handlerFor(true);
    const set = { key: "beta.screen", type: "wallet.setFeatureFlagOverride", value: true };
    expect(await handler(set, extensionSender)).toMatchObject({
      flags: { "beta.screen": true },
      ok: true,
      overridden: ["beta.screen"],
    });
    expect(
      await handler({ type: "wallet.clearFeatureFlagOverrides" }, extensionSender),
    ).toMatchObject({ flags: { "beta.screen": false }, ok: true, overridden: [] });
  });

  test("requires an unlocked wallet", async () => {
    const handler = handlerFor(false);
    const set = { key: "beta.screen", type: "wallet.setFeatureFlagOverride", value: true };
    expect(await handler(set, extensionSender)).toEqual({ error: "wallet locked" });
    expect(await handler({ type: "wallet.clearFeatureFlagOverrides" }, extensionSender)).toEqual({
      error: "wallet locked",
    });
  });

  test("refuses content scripts", async () => {
    const handler = handlerFor(true);
    const set = { key: "beta.screen", type: "wallet.setFeatureFlagOverride", value: true };
    expect(await handler(set, contentSender)).toEqual({ error: "privileged sender required" });
    expect(await handler({ type: "wallet.clearFeatureFlagOverrides" }, contentSender)).toEqual({
      error: "privileged sender required",
    });
  });

  test.each([
    ["missing value", { key: "beta.screen" }],
    ["non-boolean value", { key: "beta.screen", value: "on" }],
    ["empty key", { key: "", value: true }],
    ["oversized key", { key: "k".repeat(65), value: true }],
    ["extra field", { extra: 1, key: "beta.screen", value: true }],
  ])("rejects a %s", async (_name, fields) => {
    const handler = handlerFor(true);
    expect(
      await handler({ ...fields, type: "wallet.setFeatureFlagOverride" }, extensionSender),
    ).toEqual({ error: "invalid feature flag override request" });
  });

  test("rejects flags that are not overridable, and storage-less defaults", async () => {
    const handler = handlerFor(true);
    const set = { key: "swap.enabled", type: "wallet.setFeatureFlagOverride", value: false };
    expect(await handler(set, extensionSender)).toEqual({
      error: "feature flag not overridable",
    });
    expect(await bundledFeatureFlags.setOverride("beta.screen", true)).toBe("unavailable");
  });
});
