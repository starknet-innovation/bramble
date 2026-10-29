/**
 * Side-panel runtime client for on-chain class-hash verification. The client
 * must surface the whole response — including its `accountId` — so the render
 * loop can drop a verdict that resolved for an account the user has since
 * switched away from, and it must reject any malformed payload as `null`
 * (never a fabricated "verified" verdict).
 */
import { describe, expect, test } from "bun:test";
import type { ClassHashVerification } from "@bramble/starknet/class-hash-verify";
import {
  emptyRenderCache,
  updateRenderScope,
  verificationForAccount,
} from "../../../../src/sidepanel/app/rendering/render-cache";
import { createSidepanelRuntime } from "../../../../src/sidepanel/runtime/runtime";

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
    // Frozen intents and watched shared accounts never survive the lock reset.
    expect(empty.multisigs).toEqual({ intents: [], multisigs: [] });
    expect(empty.multisigClassDeclared).toBeNull();
    expect(empty.multisigsError).toBe(false);
    expect(empty.multisigBalanceId).toBeNull();
    expect(empty.multisigBalances).toEqual({ error: "multisig balances unavailable" });
  });

  test("clears the remaining view-scoped lists and price fields", () => {
    expect(empty.allowances).toEqual({
      entries: [],
      loading: true,
      notices: [],
      unavailable: false,
    });
    // Not yet read, so the screen cannot claim no site is connected.
    expect(empty.connectedSites).toBe("loading");
    expect(empty.chart).toEqual([]);
    expect(empty.deployment).toBeNull();
    expect(empty.prices).toEqual({});
    expect(empty.changes).toEqual({});
    expect(empty.priceAsOf).toBeNull();
    expect(empty.priceStale).toBe(false);
    // Nothing read yet: loading, never a failed-read marker (issue 795).
    expect(empty.balances).toEqual({ loading: true });
  });
});

describe("updateRenderScope", () => {
  test("retains scoped lanes on resync and clears them on account switches", () => {
    const cache = emptyRenderCache();
    const transaction = {
      accountId: ACCOUNT_ID,
      hash: "0x1",
      kind: "transfer" as const,
      networkId: "SN_MAIN" as const,
      status: "pending" as const,
      submittedAt: 1,
      summary: "Send",
    };
    Object.assign(cache, {
      balances: { accountId: ACCOUNT_ID, balances: [], networkId: "SN_MAIN" },
      deployment: false,
      historyUnavailable: true,
      multisigClassDeclared: true,
      status: { ...cache.status, activeAccountId: ACCOUNT_ID, networkId: "SN_MAIN" as const },
      transactions: [transaction],
    });

    expect(updateRenderScope(cache, { ...cache.status })).toBeNull();
    expect(cache.deployment).toBe(false);
    expect(cache.transactions).toEqual([transaction]);
    expect(cache.historyUnavailable).toBe(true);
    expect(cache.multisigClassDeclared).toBe(true);

    expect(updateRenderScope(cache, { ...cache.status, activeAccountId: OTHER_ACCOUNT_ID })).toBe(
      "account",
    );
    expect(cache.transactions).toEqual([]);
    expect(cache.historyUnavailable).toBe(false);
    expect(cache.multisigClassDeclared).toBeNull();
    expect(cache.deployment).toBeNull();
    expect(cache.balances).toEqual({ loading: true });

    expect(updateRenderScope(cache, { ...cache.status, networkId: "SN_SEPOLIA" })).toBe("network");
  });
});
