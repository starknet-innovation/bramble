/** The signability cache ages both verdicts and drops a switched-away answer. */
import { expect, test } from "bun:test";
import type {
  AccountSignabilityResponse,
  WalletStatus,
} from "../../../src/popup/responses/responses";
import { createSignabilityCache } from "../../../src/sidepanel/app/sync/signability-cache";
import type { SidepanelWallet } from "../../../src/sidepanel/runtime/runtime";

const statusFor = (accountId: string): WalletStatus =>
  ({
    activeAccountId: accountId,
    hasVault: true,
    locked: false,
    networkId: "SN_MAIN",
  }) as WalletStatus;

test("serves a cached verdict within the freshness window, re-probes after it", async () => {
  let reads = 0;
  const wallet = {
    loadAccountSignability: async (): Promise<AccountSignabilityResponse> => {
      reads += 1;
      return { accountId: "acc", ok: true, readOnly: true, reason: "braavos" };
    },
  } as unknown as SidepanelWallet;
  let now = 1_000;
  const cache = createSignabilityCache(wallet, () => now);
  const status = statusFor("acc");

  expect(await cache.load(status, "home")).toEqual({ readOnly: true, reason: "braavos" });
  // Within five minutes the cached verdict is reused without a second probe.
  now += 60_000;
  await cache.load(status, "home");
  expect(reads).toBe(1);
  // Past the window it re-probes.
  now += 300_001;
  await cache.load(status, "home");
  expect(reads).toBe(2);
});

test("a completed action forces a fresh probe", async () => {
  let reads = 0;
  const wallet = {
    loadAccountSignability: async (): Promise<AccountSignabilityResponse> => {
      reads += 1;
      return { accountId: "acc", ok: true, readOnly: false };
    },
  } as unknown as SidepanelWallet;
  const cache = createSignabilityCache(wallet, () => 1_000);
  await cache.load(statusFor("acc"), "home");
  await cache.load(statusFor("acc"), "home", true);
  expect(reads).toBe(2);
});

test("an account switch mid-request does not cache the other account's verdict", async () => {
  let answerFor = "acc-b";
  const wallet = {
    loadAccountSignability: async (): Promise<AccountSignabilityResponse> => ({
      accountId: answerFor,
      ok: true,
      readOnly: answerFor === "acc-b",
      ...(answerFor === "acc-b" ? { reason: "braavos" as const } : {}),
    }),
  } as unknown as SidepanelWallet;
  const cache = createSignabilityCache(wallet, () => 1_000);

  // The reply is for acc-b while acc-a is active: it must not be cached as acc-a's.
  expect(await cache.load(statusFor("acc-a"), "home")).toBeNull();
  // Once the switch settles, acc-a's own verdict is read and returned.
  answerFor = "acc-a";
  expect(await cache.load(statusFor("acc-a"), "home")).toEqual({ readOnly: false });
});

test("does not probe off Home, when locked, or with no account", async () => {
  let reads = 0;
  const wallet = {
    loadAccountSignability: async (): Promise<AccountSignabilityResponse> => {
      reads += 1;
      return { accountId: "acc", ok: true, readOnly: false };
    },
  } as unknown as SidepanelWallet;
  const cache = createSignabilityCache(wallet, () => 1_000);
  expect(await cache.load(statusFor("acc"), "activity")).toBeNull();
  expect(await cache.load({ ...statusFor("acc"), locked: true }, "home")).toBeNull();
  expect(await cache.load({ ...statusFor("acc"), activeAccountId: null }, "home")).toBeNull();
  expect(reads).toBe(0);
});
