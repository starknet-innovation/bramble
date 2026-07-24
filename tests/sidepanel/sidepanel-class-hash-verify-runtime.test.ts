/**
 * Side-panel runtime client for on-chain class-hash verification. The client
 * must surface the whole response — including its `accountId` — so the render
 * loop can drop a verdict that resolved for an account the user has since
 * switched away from, and it must reject any malformed payload as `null`
 * (never a fabricated "verified" verdict).
 */
import { describe, expect, test } from "bun:test";
import { emptyRenderCache, verificationForAccount } from "../../src/sidepanel/render-cache";
import { createSidepanelRuntime } from "../../src/sidepanel/runtime";
import type { ClassHashVerification } from "../../src/starknet/class-hash-verify";

const OTHER_ACCOUNT_ID = "SN_MAIN:0x9999999999999999999999999999999999999999999999999999999999999";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const ON_CHAIN = "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3";

const runtimeReturning = (response: unknown) =>
  createSidepanelRuntime({
    async sendMessage() {
      return response;
    },
  });

describe("loadClassHashVerification", () => {
  test("returns the full response, preserving the account id for correlation", async () => {
    const wallet = runtimeReturning({
      accountId: ACCOUNT_ID,
      ok: true,
      verification: { onChainClassHash: ON_CHAIN, status: "verified" },
    });
    expect(await wallet.loadClassHashVerification()).toEqual({
      accountId: ACCOUNT_ID,
      ok: true,
      verification: { onChainClassHash: ON_CHAIN, status: "verified" },
    });
  });

  test("carries the account id for every non-verified verdict", async () => {
    const verdicts: readonly ClassHashVerification[] = [
      { expectedClassHash: "0x1", onChainClassHash: ON_CHAIN, status: "mismatch" },
      { status: "undeployed" },
      { status: "unreachable" },
    ];
    for (const verification of verdicts) {
      const wallet = runtimeReturning({ accountId: ACCOUNT_ID, ok: true, verification });
      const loaded = await wallet.loadClassHashVerification();
      expect(loaded?.accountId).toBe(ACCOUNT_ID);
      expect(loaded?.verification).toEqual(verification);
    }
  });

  test("returns null for an error response rather than a fabricated verdict", async () => {
    const wallet = runtimeReturning({ error: "class hash verification unavailable" });
    expect(await wallet.loadClassHashVerification()).toBeNull();
  });

  test("returns null when the verdict shape is malformed", async () => {
    const wallet = runtimeReturning({
      accountId: ACCOUNT_ID,
      ok: true,
      verification: { status: "verified" },
    });
    expect(await wallet.loadClassHashVerification()).toBeNull();
  });
});

describe("verificationForAccount", () => {
  const verified = {
    accountId: ACCOUNT_ID,
    ok: true,
    verification: { onChainClassHash: ON_CHAIN, status: "verified" },
  } as const;

  test("shows the verdict when the cached account is the active one", () => {
    expect(verificationForAccount(verified, ACCOUNT_ID)).toEqual({
      onChainClassHash: ON_CHAIN,
      status: "verified",
    });
  });

  test("hides a verdict cached for a different account (stale switch / late race)", () => {
    // The exact false-positive the feature exists to prevent: account A's
    // "verified" must never render under account B.
    expect(verificationForAccount(verified, OTHER_ACCOUNT_ID)).toBeNull();
  });

  test("is pending (null) when nothing is cached", () => {
    expect(verificationForAccount(null, ACCOUNT_ID)).toBeNull();
  });

  test("is pending when no account is active even if a verdict is cached", () => {
    expect(verificationForAccount(verified, null)).toBeNull();
  });
});

describe("emptyRenderCache (lock-reset single source)", () => {
  // The render loop resets the cache on lock by delegating to emptyRenderCache
  // (preserving only the freshly-read status/pending/preferences), so every
  // view-scoped field must return to its locked/empty baseline here. A field
  // that emptyRenderCache forgets would survive a lock and leak stale state —
  // this guards against the reset drifting behind newly added fields.
  const empty = emptyRenderCache();

  test("clears the on-chain / verification fields the wallet must not retain locked", () => {
    expect(empty.classHashVerification).toBeNull();
    expect(empty.transactions).toEqual([]);
    expect(empty.historyUnavailable).toBe(false);
    // Previously omitted from the hand-written lock reset: multisig state must
    // also reset so a prior session's proposals cannot linger post-lock.
    expect(empty.multisigs).toEqual({ multisigs: [], proposals: [] });
    expect(empty.multisigClassDeclared).toBeNull();
  });

  test("clears the remaining view-scoped lists and price fields", () => {
    expect(empty.allowances).toEqual([]);
    expect(empty.discoveredNfts).toEqual([]);
    expect(empty.connectedSites).toEqual([]);
    expect(empty.chart).toEqual([]);
    expect(empty.deployment).toBeNull();
    expect(empty.prices).toEqual({});
    expect(empty.changes).toEqual({});
    expect(empty.priceAsOf).toBeNull();
    expect(empty.priceStale).toBe(false);
    // The locked shell: balances carries the explicit "wallet locked" marker.
    expect(empty.balances).toEqual({ error: "wallet locked" });
  });
});
