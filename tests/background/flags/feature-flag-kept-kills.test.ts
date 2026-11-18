/**
 * A verified remote kill outlives its document's 30-day expiry: once the last
 * accepted document has expired, its kills (rules with `enabled: false`) stay
 * in force until a newer signed document is accepted, while every other rule
 * returns to the bundled default. Only the last *accepted* document can keep
 * a kill; a freshly fetched expired one, a tampered copy, or one whose key the
 * build no longer trusts contributes nothing. Moving the device clock back
 * before the document was issued keeps its kills too. A kept kill beats a
 * local override, like a current one.
 */
import { describe, expect, test } from "bun:test";
import type { BoundedHttpFetch } from "@bramble/core/http-json";
import type { FlagCatalog } from "@bramble/flags/catalog";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { createFeatureFlagClient } from "../../../apps/extension/src/background/flags/feature-flag-client";
import {
  createTestPublisher,
  NOW,
  payload,
  stamp,
} from "../../../packages/features/flags/tests/support/flag-fixture";

const DAY = 86_400_000;
const AFTER_EXPIRY = NOW + 31 * DAY;
const publisher = await createTestPublisher();

const CATALOG: FlagCatalog = {
  "beta.panel": { enabled: false, localOverride: true, remote: "toggle" },
  "beta.screen": { enabled: false, remote: "toggle" },
  "swap.enabled": { enabled: true, remote: "kill-only" },
};

// Serves each body (or a network failure) in turn, repeating the last.
const serving = (...bodies: (string | null)[]): BoundedHttpFetch => {
  let index = 0;
  return async () => {
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    return body === null ? Response.error() : new Response(body);
  };
};

const clientFor = (
  fetch: BoundedHttpFetch,
  clock: { now: number },
  store: KeyValueStore = createMemoryStore(),
  trustedKeys = publisher.trusted,
) =>
  createFeatureFlagClient({
    catalog: CATALOG,
    drawBucket: () => 0,
    fetch,
    now: () => clock.now,
    store,
    trustedKeys,
    version: "0.10.0",
  });

const doc = (sequence: number, flags: Record<string, unknown>, extra = {}) =>
  publisher.sign(payload({ flags, sequence, ...extra }));

const KILL_AND_ENABLE = {
  "beta.panel": { enabled: false },
  "beta.screen": { enabled: true },
  "swap.enabled": { enabled: false },
};

describe("kept kills after expiry", () => {
  test("kills stay in force; every other rule returns to the bundled default", async () => {
    const clock = { now: NOW };
    const client = clientFor(serving(await doc(3, KILL_AND_ENABLE), null), clock);
    await client.refresh();
    expect((await client.snapshot("SN_MAIN")).flags).toEqual({
      "beta.panel": false,
      "beta.screen": true,
      "swap.enabled": false,
    });
    clock.now = AFTER_EXPIRY;
    expect(await client.snapshot("SN_MAIN")).toMatchObject({
      flags: { "beta.panel": false, "beta.screen": false, "swap.enabled": false },
      killed: ["beta.panel"],
      sequence: null,
      source: "bundled",
    });
  });

  test("survive a worker restart from the stored copy alone", async () => {
    const store = createMemoryStore();
    await clientFor(serving(await doc(3, KILL_AND_ENABLE)), { now: NOW }, store).refresh();
    const restarted = clientFor(serving(null), { now: AFTER_EXPIRY }, store);
    expect((await restarted.snapshot("SN_MAIN")).flags["swap.enabled"]).toBe(false);
  });

  test("a newer signed document replaces them", async () => {
    const clock = { now: NOW };
    const store = createMemoryStore();
    await clientFor(serving(await doc(3, KILL_AND_ENABLE)), clock, store).refresh();
    clock.now = AFTER_EXPIRY;
    const later = { expiresAt: stamp(AFTER_EXPIRY + DAY), issuedAt: stamp(AFTER_EXPIRY - DAY) };
    const client = clientFor(serving(await doc(4, {}, later)), clock, store);
    expect((await client.snapshot("SN_MAIN")).flags["swap.enabled"]).toBe(false);
    expect(await client.refresh({ force: true })).toBe("accepted");
    expect(await client.snapshot("SN_MAIN")).toMatchObject({
      flags: { "beta.panel": false, "swap.enabled": true },
      sequence: 4,
      source: "remote",
    });
  });

  test("survive the device clock moving back before the document was issued", async () => {
    const store = createMemoryStore();
    await clientFor(serving(await doc(3, KILL_AND_ENABLE)), { now: NOW }, store).refresh();
    const restarted = clientFor(serving(null), { now: NOW - 30 * DAY }, store);
    expect(await restarted.snapshot("SN_MAIN")).toMatchObject({
      flags: { "beta.panel": false, "beta.screen": false, "swap.enabled": false },
      source: "bundled",
    });
  });

  test("beat a local override", async () => {
    const store = createMemoryStore();
    await clientFor(serving(await doc(3, KILL_AND_ENABLE)), { now: NOW }, store).refresh();
    const client = clientFor(serving(null), { now: AFTER_EXPIRY }, store);
    expect(await client.setOverride("beta.panel", true)).toBe("applied");
    expect(await client.snapshot("SN_MAIN")).toMatchObject({
      flags: { "beta.panel": false },
      killed: ["beta.panel"],
      overridden: [],
    });
  });

  test("a freshly fetched expired document contributes no kill", async () => {
    const expired = { expiresAt: stamp(NOW), issuedAt: stamp(NOW - DAY) };
    const client = clientFor(serving(await doc(3, KILL_AND_ENABLE, expired)), { now: NOW });
    expect(await client.refresh()).toBe("expired");
    expect((await client.snapshot("SN_MAIN")).flags["swap.enabled"]).toBe(true);
  });

  test("a stored copy whose key this build no longer trusts keeps no kill", async () => {
    const store = createMemoryStore();
    await clientFor(serving(await doc(3, KILL_AND_ENABLE)), { now: NOW }, store).refresh();
    const otherKeys = (await createTestPublisher("flags-next")).trusted;
    const restarted = clientFor(serving(null), { now: AFTER_EXPIRY }, store, otherKeys);
    expect((await restarted.snapshot("SN_MAIN")).flags["swap.enabled"]).toBe(true);
  });
});
