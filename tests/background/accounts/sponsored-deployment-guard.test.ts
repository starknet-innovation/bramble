/**
 * The shared deploy guard (issue 431 review). A sponsored deploy that may be in
 * flight holds its account in durable storage: the hold survives a worker
 * restart, never ages out, is reserved atomically, and refuses every deploy
 * route — sponsored, self-paid, and each deploy-before-send — until the chain
 * shows the account deployed or the deploy's own transaction failed.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import {
  type DeployAccountDeps,
  handleDeployAccountSponsored,
  handleDeploySponsorship,
} from "../../../apps/extension/src/background/accounts/deploy-account-ops";
import {
  createPendingDeployments,
  DEPLOYMENT_MAY_BE_ON_ITS_WAY,
  guardDeployments,
  memoryPendingDeployments,
  PENDING_DEPLOYMENTS_KEY,
} from "../../../apps/extension/src/background/accounts/pending-deployments";
import { routerContext } from "../../../apps/extension/src/background/routing/message-context";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createWallet, extensionSender, testExtension } from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import {
  accepted,
  sponsoredHarness as harness,
  lost,
  ozAccount,
  relay,
} from "../../support/sponsored-deploy-harness";

const submit = (deps: DeployAccountDeps) =>
  handleDeployAccountSponsored(deps, { type: "wallet.deployAccountSponsored" });

const HELD = { error: DEPLOYMENT_MAY_BE_ON_ITS_WAY };

describe("pending sponsored deploy", () => {
  test("survives a worker restart: a lost reply still holds the account", async () => {
    const storage = createMemoryStore();
    const before = await harness({
      pending: createPendingDeployments(storage),
      relay: relay(lost),
    });
    expect(await submit(before.deps)).toMatchObject({ submissionUnknown: true });
    const sponsor = relay(accepted);
    const after = await harness({ pending: createPendingDeployments(storage), relay: sponsor });
    expect(await submit(after.deps)).toEqual(HELD);
    expect(sponsor.calls).toEqual([]);
  });

  test("never ages out while the chain cannot show the account deployed", async () => {
    const { deps } = await harness({ relay: relay(lost) });
    await submit({ ...deps, now: () => 0 });
    for (const now of [11 * 60_000, 30 * 24 * 60 * 60_000]) {
      expect(await submit({ ...deps, now: () => now })).toEqual(HELD);
    }
  });

  test("withdraws the sponsored offer while it stands", async () => {
    const sponsor = relay(lost);
    const { deps } = await harness({ relay: sponsor });
    await submit(deps);
    const offer = await handleDeploySponsorship(deps, { type: "wallet.deploySponsorship" });
    expect(offer).toEqual({ ok: true, sponsorship: "none" });
    expect(sponsor.calls).toEqual(["paymaster_buildTransaction", "paymaster_executeTransaction"]);
  });

  test("is reserved atomically: two concurrent submits make exactly one broadcast", async () => {
    let releaseBroadcast: () => void = () => undefined;
    const sponsor = relay(
      () =>
        new Promise<Response>((resolve) => {
          releaseBroadcast = () => resolve(accepted());
        }),
    );
    const { deps } = await harness({ relay: sponsor });
    const first = submit(deps);
    const second = submit(deps);
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseBroadcast();
    const answers = await Promise.all([first, second]);
    expect(answers).toContainEqual({ ok: true, transactionHash: "0x5ab" });
    expect(answers).toContainEqual(HELD);
    expect(sponsor.calls.filter((method) => method === "paymaster_executeTransaction")).toEqual([
      "paymaster_executeTransaction",
    ]);
  });

  test("is released when the deploy's own transaction is reverted or rejected", async () => {
    for (const status of ["reverted", "rejected"] as const) {
      const sponsor = relay(accepted);
      const { activity, deps } = await harness({ relay: sponsor });
      await submit(deps);
      expect(await submit(deps)).toEqual(HELD);
      await activity.updateStatuses(
        { "0x5ab": { status } },
        { accountId: ozAccount.id, networkId: "SN_SEPOLIA" },
      );
      expect(await submit(deps)).toEqual({ ok: true, transactionHash: "0x5ab" });
    }
  });

  test("refuses, sending nothing, when the reservation cannot be stored", async () => {
    const failing: KeyValueStore = {
      ...createMemoryStore(),
      set: async () => {
        throw new Error("quota");
      },
    };
    const sponsor = relay(accepted);
    const { deps } = await harness({ pending: createPendingDeployments(failing), relay: sponsor });
    expect(await submit(deps)).toEqual({ error: "sponsored deployment unavailable" });
    expect(sponsor.calls).toEqual([]);
  });

  test("drops unreadable stored entries instead of trusting them", async () => {
    const storage = createMemoryStore();
    await storage.set(PENDING_DEPLOYMENTS_KEY, [
      { address: "not-a-felt", networkId: "SN_SEPOLIA", since: 0 },
      { address: ozAccount.address, networkId: "SN_NOWHERE", since: 0 },
      { address: ozAccount.address, extra: true, networkId: "SN_SEPOLIA", since: 0 },
    ]);
    const pending = createPendingDeployments(storage);
    await pending.load();
    expect(pending.pending(ozAccount)).toBeUndefined();
  });
});

describe("every deploy route honours the hold", () => {
  test("the self-paid deploy is refused after a lost sponsored reply", async () => {
    const sponsored = await harness({ relay: relay(lost) });
    expect(await submit(sponsored.deps)).toMatchObject({ submissionUnknown: true });
    let selfPaid = 0;
    const handler = createMessageHandler(
      createWallet({ accounts: [ozAccount], activeAccountId: () => ozAccount.id }),
      testExtension,
      {
        pendingDeployments: sponsored.pending,
        preferencesStore: sponsored.preferencesStore,
        runtimeRpc: makeRuntimeRpc({
          async getDeploymentStatus() {
            return false;
          },
          async submitAccountDeployment() {
            selfPaid += 1;
            return { transactionHash: "0x99" };
          },
        }),
        session: sponsored.session,
      },
    );
    const reply = await handler(
      { reviewedFee: { overallFee: "1000", unit: "FRI" }, type: "wallet.deployAccount" },
      extensionSender,
    );
    expect(reply).toEqual(HELD);
    expect(selfPaid).toBe(0);
  });

  test("the router context guards every deploy-capable submission", async () => {
    const pending = memoryPendingDeployments();
    await pending.load();
    pending.reserve(ozAccount, 0);
    const called: string[] = [];
    const spy = (name: string) => async (): Promise<never> => {
      called.push(name);
      throw new Error("must not run");
    };
    const ctx = routerContext(
      createWallet(),
      testExtension,
      {
        pendingDeployments: pending,
        runtimeRpc: makeRuntimeRpc({
          async getDeploymentStatus() {
            return false;
          },
          submitAccountDeployment: spy("deploy"),
          submitDeclareTransaction: spy("declare"),
          submitErc20Transfer: spy("transfer"),
          submitInvokeTransaction: spy("invoke"),
        }),
      },
      (await harness({})).session,
    );
    const input = { account: ozAccount, rpcUrls: ["https://rpc.test"] } as never;
    for (const submitter of [
      ctx.runtimeRpc.submitAccountDeployment,
      ctx.runtimeRpc.submitDeclareTransaction,
      ctx.runtimeRpc.submitErc20Transfer,
      ctx.runtimeRpc.submitInvokeTransaction,
    ]) {
      await expect(submitter(input)).rejects.toThrow(DEPLOYMENT_MAY_BE_ON_ITS_WAY);
    }
    expect(called).toEqual([]);
  });

  test("a deployed account, or no entry, passes straight through", async () => {
    const pending = memoryPendingDeployments();
    await pending.load();
    pending.reserve(ozAccount, 0);
    let deployed = true;
    let transfers = 0;
    const rpc = guardDeployments(
      makeRuntimeRpc({
        async getDeploymentStatus() {
          return deployed;
        },
        async submitErc20Transfer() {
          transfers += 1;
          return { transactionHash: "0x1" } as never;
        },
      }) as RuntimeRpc,
      { pendingDeployments: pending },
    );
    const input = { account: ozAccount, rpcUrls: ["https://rpc.test"] } as never;
    await rpc.submitErc20Transfer(input);
    expect(pending.pending(ozAccount)).toBeUndefined();
    deployed = false;
    await rpc.submitErc20Transfer(input);
    expect(transfers).toBe(2);
  });
});
