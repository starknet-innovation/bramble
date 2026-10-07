/** A watched deployment must retire a fresh "undeployed" snapshot immediately. */
import { expect, test } from "bun:test";
import type { WalletStatus } from "../../../src/popup/responses/responses";
import { createDeploymentCache } from "../../../src/sidepanel/app/sync/deployment-cache";
import type { SidepanelWallet } from "../../../src/sidepanel/runtime/runtime";

test("noteDeployed overrides a fresh undeployed result", async () => {
  let reads = 0;
  const wallet = {
    loadDeploymentStatus: async () => {
      reads += 1;
      return { accountId: "acc", deployed: false, ok: true as const };
    },
  } as unknown as SidepanelWallet;
  let now = 1_000;
  const cache = createDeploymentCache(wallet, () => now);
  const status = {
    activeAccountId: "acc",
    hasVault: true,
    locked: false,
    networkId: "SN_MAIN",
  } as WalletStatus;

  expect(await cache.load(status, "home")).toBe(false);
  cache.noteDeployed("SN_MAIN", "acc");
  now += 1_000;
  expect(await cache.load(status, "home")).toBe(true);
  expect(reads).toBe(1);
});

test("an account switch mid-request does not cache the other account's verdict", async () => {
  // The background answers for whichever account is active when it handles the
  // request: `acc-b` (deployed) after a mid-flight switch, `acc-a` (undeployed)
  // once the switch settles back.
  let answerFor = "acc-b";
  let reads = 0;
  const wallet = {
    loadDeploymentStatus: async () => {
      reads += 1;
      return { accountId: answerFor, deployed: answerFor === "acc-b", ok: true as const };
    },
  } as unknown as SidepanelWallet;
  const cache = createDeploymentCache(wallet, () => 1_000);
  const statusA = {
    activeAccountId: "acc-a",
    hasVault: true,
    locked: false,
    networkId: "SN_MAIN",
  } as WalletStatus;

  expect(await cache.load(statusA, "home")).toBeNull();
  answerFor = "acc-a";
  expect(await cache.load(statusA, "home")).toBe(false);
  expect(reads).toBe(2);
});
