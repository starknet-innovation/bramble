/**
 * The bounded hold after a sponsored deploy attempt (issue 431 review). The
 * attempt is stored durably and holds every deploy route of its account —
 * sponsored, self-paid and each deploy-before-send — for three minutes, or
 * until the chain shows the account deployed or the attempt's own transaction
 * failed. After the hold a self-paid deploy goes ahead (a duplicate never costs
 * the user), and sponsorship is never offered for that account again.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import type { ActivityLog } from "@bramble/transactions/activity";
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
  PENDING_DEPLOYMENTS_LIMIT,
  type PendingDeployments,
  SPONSORED_DEPLOY_HOLD_MS,
} from "../../../apps/extension/src/background/accounts/pending-deployments";
import { SPONSORED_DEPLOY_ALREADY_SENT } from "../../../apps/extension/src/background/accounts/sponsored-deployment";
import { routerContext } from "../../../apps/extension/src/background/routing/message-context";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createWallet, extensionSender, testExtension } from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import {
  accepted,
  type Chain,
  sponsoredHarness as harness,
  lost,
  ozAccount,
  relay,
} from "../../support/sponsored-deploy-harness";

const HELD = { error: DEPLOYMENT_MAY_BE_ON_ITS_WAY };
const INSIDE = 60_000;
const AFTER = SPONSORED_DEPLOY_HOLD_MS + 1;
const rpcInput = { account: ozAccount, rpcUrls: ["https://rpc.test"] } as never;

const submit = (deps: DeployAccountDeps, now = 0) =>
  handleDeployAccountSponsored(
    { ...deps, now: () => now },
    { type: "wallet.deployAccountSponsored" },
  );
const offer = async (deps: DeployAccountDeps, now: number): Promise<unknown> => {
  const reply = await handleDeploySponsorship(
    { ...deps, now: () => now },
    { type: "wallet.deploySponsorship" },
  );
  return "sponsorship" in reply ? reply.sponsorship : reply;
};

// A transfer submitter behind the guard, counting the transfers that got through.
const guardedTransfers = (
  pending: PendingDeployments,
  now: number,
  deployed = false,
  activity?: ActivityLog,
) => {
  const sent: string[] = [];
  const rpc = guardDeployments(
    makeRuntimeRpc({
      async getDeploymentStatus() {
        return deployed;
      },
      async verifyAccountClassHash({ expectedClassHash }) {
        return deployed
          ? { onChainClassHash: expectedClassHash, status: "verified" }
          : { status: "undeployed" };
      },
      async submitErc20Transfer() {
        sent.push("transfer");
        return { transactionHash: "0x1" } as never;
      },
    }) as RuntimeRpc,
    { ...(activity ? { activity } : {}), now: () => now, pendingDeployments: pending },
  );
  return { send: () => rpc.submitErc20Transfer(rpcInput), sent };
};

describe("sponsored attempt hold", () => {
  test("holds every route during the hold and lets a self-paid deploy go after it", async () => {
    const { deps, pending } = await harness({ relay: relay(lost) });
    expect(await submit(deps, 0)).toMatchObject({ submissionUnknown: true });
    const inside = guardedTransfers(pending, INSIDE);
    await expect(inside.send()).rejects.toThrow(DEPLOYMENT_MAY_BE_ON_ITS_WAY);
    const after = guardedTransfers(pending, AFTER);
    await after.send();
    expect([inside.sent, after.sent]).toEqual([[], ["transfer"]]);
  });

  test("after the hold, sends read nothing extra from the chain", async () => {
    const { deps, pending } = await harness({ relay: relay(lost) });
    await submit(deps, 0);
    let reads = 0;
    const rpc = guardDeployments(
      makeRuntimeRpc({
        async getDeploymentStatus() {
          reads += 1;
          return false;
        },
        async verifyAccountClassHash() {
          reads += 1;
          return { status: "undeployed" };
        },
        async submitErc20Transfer() {
          return { transactionHash: "0x1" } as never;
        },
      }) as RuntimeRpc,
      { now: () => AFTER, pendingDeployments: pending },
    );
    await rpc.submitErc20Transfer(rpcInput);
    expect(reads).toBe(0);
  });

  test("tells the screen: held during the hold, may-land after, never offered again", async () => {
    const sponsor = relay(lost);
    const { deps } = await harness({ relay: sponsor });
    await submit(deps, 0);
    expect(await offer(deps, INSIDE)).toBe("held");
    expect(await offer(deps, AFTER)).toBe("may-land");
    expect(await submit(deps, INSIDE)).toEqual(HELD);
    expect(await submit(deps, AFTER)).toEqual({ error: SPONSORED_DEPLOY_ALREADY_SENT });
    expect(sponsor.calls).toEqual(["paymaster_buildTransaction", "paymaster_executeTransaction"]);
  });

  test("survives a worker restart inside the hold", async () => {
    const storage = createMemoryStore();
    const before = await harness({
      pending: createPendingDeployments(storage),
      relay: relay(lost),
    });
    await submit(before.deps, 0);
    const sponsor = relay(accepted);
    const after = await harness({ pending: createPendingDeployments(storage), relay: sponsor });
    expect(await submit(after.deps, INSIDE)).toEqual(HELD);
    expect(sponsor.calls).toEqual([]);
  });

  test("an unreadable store means no hold, never a locked account", async () => {
    const unreadable: KeyValueStore = {
      ...createMemoryStore(),
      get: async () => {
        throw new Error("storage unavailable");
      },
    };
    const pending = createPendingDeployments(unreadable);
    const transfers = guardedTransfers(pending, INSIDE);
    await transfers.send();
    expect(transfers.sent).toEqual(["transfer"]);
  });

  test("after a restart whose read failed, sponsorship stops but self-paid goes ahead", async () => {
    const storage = createMemoryStore();
    const before = await harness({
      pending: createPendingDeployments(storage),
      relay: relay(lost),
    });
    await submit(before.deps, 0);
    const unreadable: KeyValueStore = {
      ...storage,
      get: async () => {
        throw new Error("storage unavailable");
      },
    };
    const sponsor = relay(accepted);
    const after = await harness({ pending: createPendingDeployments(unreadable), relay: sponsor });
    expect(await offer(after.deps, INSIDE)).toBe("none");
    expect(await submit(after.deps, INSIDE)).toEqual({ error: "sponsored deployment unavailable" });
    expect(sponsor.calls).toEqual([]);
    const transfers = guardedTransfers(after.pending, INSIDE);
    await transfers.send();
    expect(transfers.sent).toEqual(["transfer"]);
  });

  test("never evicts an attempt marker: a full store refuses new sponsorship instead", async () => {
    const { deps, pending } = await harness({ relay: relay(lost) });
    await submit(deps, 0);
    for (let index = 1; index < PENDING_DEPLOYMENTS_LIMIT; index += 1) {
      const other = {
        address: `0x${(index + 0x1000).toString(16)}`,
        networkId: "SN_SEPOLIA",
      } as const;
      expect(pending.reserve(other, AFTER)).toBe("reserved");
    }
    expect(pending.reserve({ address: "0xfffff", networkId: "SN_SEPOLIA" }, AFTER)).toBe("full");
    expect(await offer(deps, AFTER)).toBe("may-land");
    expect(await submit(deps, AFTER)).toEqual({ error: SPONSORED_DEPLOY_ALREADY_SENT });
  });

  test("ends early when the chain shows the account deployed", async () => {
    const { chain, deps, pending } = await harness({ relay: relay(accepted) });
    await submit(deps, 0);
    chain.deployed = true;
    const transfers = guardedTransfers(pending, INSIDE, true);
    await transfers.send();
    expect(transfers.sent).toEqual(["transfer"]);
    expect(pending.entry(ozAccount)).toBeUndefined();
  });

  test("ends early when the attempt's own transaction is reverted or rejected", async () => {
    for (const status of ["reverted", "rejected"] as const) {
      const { activity, deps, pending } = await harness({ relay: relay(accepted) });
      await submit(deps, 0);
      await activity.updateStatuses(
        { "0x5ab": { status } },
        { accountId: ozAccount.id, networkId: "SN_SEPOLIA" },
      );
      const transfers = guardedTransfers(pending, INSIDE, false, activity);
      await transfers.send();
      expect(transfers.sent).toEqual(["transfer"]);
      expect(await offer(deps, INSIDE)).toBe("may-land");
    }
  });

  test("an accepted relay hash is not a deployment: the hold stands until the chain shows one", async () => {
    const { activity, chain, deps, pending } = await harness({ relay: relay(accepted) });
    await submit(deps, 0);
    await activity.updateStatuses(
      { "0x5ab": { status: "accepted" } },
      { accountId: ozAccount.id, networkId: "SN_SEPOLIA" },
    );
    expect(await offer(deps, INSIDE)).toBe("held");
    // Something at the address, but not the account's class, is not this deploy.
    chain.deployed = true;
    chain.classHash = "0x123";
    expect(await offer(deps, INSIDE)).toBe("held");
    expect(await submit(deps, INSIDE)).toEqual(HELD);
    expect(pending.entry(ozAccount)).toBeDefined();
    delete chain.classHash;
    expect(await submit(deps, INSIDE)).toEqual({ error: "account already deployed" });
    expect(pending.entry(ozAccount)).toBeUndefined();
  });

  test("a failed relay hash releases the hold only while the chain shows the address empty", async () => {
    // The chain cannot be read, or the address runs another class.
    const unconfirmed: readonly Partial<Chain>[] = [
      { deployed: new Error("rpc down") },
      { classHash: "0x123", deployed: true },
    ];
    for (const settle of unconfirmed) {
      const { activity, chain, deps } = await harness({ relay: relay(accepted) });
      await submit(deps, 0);
      await activity.updateStatuses(
        { "0x5ab": { status: "rejected" } },
        { accountId: ozAccount.id, networkId: "SN_SEPOLIA" },
      );
      Object.assign(chain, settle);
      expect(await offer(deps, INSIDE)).toBe("held");
      expect(await submit(deps, INSIDE)).toEqual(HELD);
    }
  });

  test("a relay hash Activity already holds is not recorded, and the hold stands", async () => {
    const { activity, deps, pending } = await harness({ relay: relay(accepted) });
    const scope = { accountId: ozAccount.id, networkId: "SN_SEPOLIA" } as const;
    await activity.record({ ...scope, hash: "0x5ab", kind: "transfer", summary: "Sent 1 STRK" });
    await activity.updateStatuses({ "0x5ab": { status: "rejected" } }, scope);
    expect(await submit(deps, 0)).toMatchObject({ submissionUnknown: true });
    const [row] = await activity.list();
    expect(row).toMatchObject({ hash: "0x5ab", kind: "transfer", summary: "Sent 1 STRK" });
    expect(row?.feePayer).toBeUndefined();
    expect(pending.entry(ozAccount)?.hash).toBeUndefined();
    expect(await submit(deps, INSIDE)).toEqual(HELD);
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

  test("refuses, sending nothing, when the attempt cannot be stored", async () => {
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

  test("treats a stored value over the limit as unreadable rather than trimming it", async () => {
    const storage = createMemoryStore();
    await storage.set(
      PENDING_DEPLOYMENTS_KEY,
      Array.from({ length: PENDING_DEPLOYMENTS_LIMIT + 1 }, (_, index) => ({
        address: `0x${(index + 1).toString(16)}`,
        holdUntil: AFTER,
        networkId: "SN_SEPOLIA",
        since: 0,
      })),
    );
    const pending = createPendingDeployments(storage);
    await pending.load();
    expect(pending.readable()).toBe(false);
    expect(pending.entry({ address: "0x1", networkId: "SN_SEPOLIA" })).toBeUndefined();
  });

  test("drops unreadable stored entries instead of trusting them", async () => {
    const storage = createMemoryStore();
    const fields = { holdUntil: AFTER, since: 0 };
    await storage.set(PENDING_DEPLOYMENTS_KEY, [
      { ...fields, address: "not-a-felt", networkId: "SN_SEPOLIA" },
      { ...fields, address: ozAccount.address, networkId: "SN_NOWHERE" },
      { ...fields, address: ozAccount.address, extra: true, networkId: "SN_SEPOLIA" },
      { address: ozAccount.address, networkId: "SN_SEPOLIA", since: 0 },
    ]);
    const pending = createPendingDeployments(storage);
    await pending.load();
    expect(pending.entry(ozAccount)).toBeUndefined();
  });
});

describe("every deploy route honours the hold", () => {
  const selfPaid = async (pending: PendingDeployments, now: number) => {
    const { preferencesStore, session } = await harness({});
    let sent = 0;
    const handler = createMessageHandler(
      createWallet({ accounts: [ozAccount], activeAccountId: () => ozAccount.id }),
      testExtension,
      {
        now: () => now,
        pendingDeployments: pending,
        preferencesStore,
        runtimeRpc: makeRuntimeRpc({
          async getDeploymentStatus() {
            return false;
          },
          async submitAccountDeployment() {
            sent += 1;
            return { transactionHash: "0x99" };
          },
        }),
        session,
      },
    );
    const reply = await handler(
      { reviewedFee: { overallFee: "1000", unit: "FRI" }, type: "wallet.deployAccount" },
      extensionSender,
    );
    return { reply, sent };
  };

  test("a self-paid deploy is refused inside the hold and goes ahead after it", async () => {
    const sponsored = await harness({ relay: relay(lost) });
    await submit(sponsored.deps, 0);
    expect(await selfPaid(sponsored.pending, INSIDE)).toEqual({ reply: HELD, sent: 0 });
    expect(await selfPaid(sponsored.pending, AFTER)).toEqual({
      reply: { ok: true, transactionHash: "0x99" },
      sent: 1,
    });
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
        now: () => INSIDE,
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
    for (const submitter of [
      ctx.runtimeRpc.submitAccountDeployment,
      ctx.runtimeRpc.submitDeclareTransaction,
      ctx.runtimeRpc.submitErc20Transfer,
      ctx.runtimeRpc.submitInvokeTransaction,
    ]) {
      await expect(submitter(rpcInput)).rejects.toThrow(DEPLOYMENT_MAY_BE_ON_ITS_WAY);
    }
    expect(called).toEqual([]);
  });
});
