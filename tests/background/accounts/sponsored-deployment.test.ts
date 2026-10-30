/**
 * Sponsored account deployment (#431) in the background: the offer, the
 * submission, and what Activity records. The shared deploy guard has its own
 * suite (`sponsored-deployment-guard.test.ts`). The relay is a fake SNIP-29 paymaster.
 * Each test names the relay it turns on; the production table is consulted only
 * under a stubbed `fetch`. Every gateway answer the sponsored route can get is
 * in `sponsored-deployment-gateway.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import {
  type DeployAccountDeps,
  handleDeployAccountSponsored,
  handleDeploySponsorship,
} from "../../../apps/extension/src/background/accounts/deploy-account-ops";
import {
  DEPLOYMENT_IN_PROGRESS,
  memoryPendingDeployments,
} from "../../../apps/extension/src/background/accounts/pending-deployments";
import {
  DEPLOYMENT_STATUS_UNKNOWN,
  SPONSORED_DEPLOY_DECLINED,
} from "../../../apps/extension/src/background/accounts/sponsored-deployment";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import {
  accepted,
  braavosAccount,
  sponsoredHarness as harness,
  lost,
  ozAccount,
  relay,
} from "../../support/sponsored-deploy-harness";

const submit = (deps: DeployAccountDeps) =>
  handleDeployAccountSponsored(deps, { type: "wallet.deployAccountSponsored" });

describe("sponsored deploy offer", () => {
  test("is offered when the sponsor accepts an account that cannot pay its own deploy", async () => {
    const sponsor = relay(accepted);
    const { deps } = await harness({ relay: sponsor });
    expect(await handleDeploySponsorship(deps, { type: "wallet.deploySponsorship" })).toEqual({
      ok: true,
      sponsorship: "available",
    });
    expect(sponsor.calls).toEqual(["paymaster_buildTransaction"]);
  });

  test("is not offered while sponsorship is off, the account can pay, or the read is unknown", async () => {
    const cases = [
      { relayOn: "off" as const },
      { balance: "1000" },
      { deployed: true },
      { deployed: new Error("rpc down") },
      { account: braavosAccount },
    ];
    for (const options of cases) {
      const sponsor = relay(accepted);
      const { deps } = await harness({ ...options, relay: sponsor });
      expect(await handleDeploySponsorship(deps, { type: "wallet.deploySponsorship" })).toEqual({
        ok: true,
        sponsorship: "none",
      });
      expect(sponsor.calls).toEqual([]);
    }
  });

  test("with the bundled table, asks only the wallet gateway, and a switched-off one offers nothing", async () => {
    const pending = memoryPendingDeployments();
    await pending.load();
    pending.reserve(ozAccount, 0);
    await pending.persist();
    await pending.recordHash(ozAccount, "0x5ab");
    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (input: string) => {
      fetched.push(input);
      return new Response("sponsored_deploy_disabled", { status: 404 });
    }) as typeof fetch;
    try {
      // An earlier attempt is answered from the store and the chain, never the relay.
      for (const now of [0, 10 * 60_000]) {
        const { deps } = await harness({ pending, relayOn: "bundled" });
        expect(
          await handleDeploySponsorship(
            { ...deps, now: () => now },
            { type: "wallet.deploySponsorship" },
          ),
        ).toMatchObject({ ok: true });
      }
      expect(fetched).toEqual([]);
      const fresh = await harness({ relayOn: "bundled" });
      expect(
        await handleDeploySponsorship(fresh.deps, { type: "wallet.deploySponsorship" }),
      ).toEqual({ ok: true, sponsorship: "none" });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(fetched).toEqual(["https://wallet.nodes.starknet.org/api/sponsored-deploy/sepolia"]);
  });

  test("an unreachable relay offers nothing rather than claiming the sponsor said no", async () => {
    const answers = [
      async (): Promise<Response> => new Response("bad gateway", { status: 502 }),
      async (): Promise<Response> => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const http of answers) {
      const { deps } = await harness({ relay: { calls: [], http } });
      expect(await handleDeploySponsorship(deps, { type: "wallet.deploySponsorship" })).toEqual({
        ok: true,
        sponsorship: "none",
      });
    }
  });

  test("an unreachable relay at submission sends nothing, leaves no attempt, and turns self-paid", async () => {
    const http = async (): Promise<Response> => new Response("bad gateway", { status: 502 });
    const { deps, pending } = await harness({ relay: { calls: [], http } });
    expect(await submit(deps)).toEqual(SPONSORED_DEPLOY_DECLINED);
    expect(pending.entry(ozAccount)).toBeUndefined();
  });

  test("a sponsor's no at the quote offers nothing, so the screen stays self-paid and quiet", async () => {
    const { deps } = await harness({ relay: relay(accepted, false) });
    expect(await handleDeploySponsorship(deps, { type: "wallet.deploySponsorship" })).toEqual({
      ok: true,
      sponsorship: "none",
    });
  });
});

describe("sponsored deploy submission", () => {
  test("deploys through the sponsor and records a row whose fee is not the user's", async () => {
    const sponsor = relay(accepted);
    const { activity, deps } = await harness({ relay: sponsor });
    expect(await submit(deps)).toEqual({ ok: true, transactionHash: "0x5ab" });
    expect(sponsor.calls).toEqual(["paymaster_buildTransaction", "paymaster_executeTransaction"]);
    const [row] = await activity.list();
    expect(row).toMatchObject({
      feePayer: "sponsor",
      hash: "0x5ab",
      kind: "deploy",
      origin: "wallet",
      summary: "Deploy account contract",
    });
    expect(row?.feePaid).toBeUndefined();
  });

  test("a sponsor refusal sends nothing, records nothing, and allows the self-paid path", async () => {
    const sponsor = relay(accepted, false);
    const { activity, deps } = await harness({ relay: sponsor });
    expect(await submit(deps)).toEqual(SPONSORED_DEPLOY_DECLINED);
    expect(sponsor.calls).toEqual(["paymaster_buildTransaction"]);
    expect(await activity.list()).toEqual([]);
    // Not held: a refusal is determinate, so asking again is safe.
    expect(await submit(deps)).toEqual(SPONSORED_DEPLOY_DECLINED);
  });

  test("a lost reply is status unknown and holds the account against a blind retry", async () => {
    const sponsor = relay(lost);
    const { activity, deps } = await harness({ relay: sponsor });
    const first = await submit(deps);
    expect(first).toMatchObject({ submissionUnknown: true });
    expect(await activity.list()).toEqual([]);
    expect(await submit(deps)).toEqual({ error: DEPLOYMENT_IN_PROGRESS });
    expect(sponsor.calls).toEqual(["paymaster_buildTransaction", "paymaster_executeTransaction"]);
  });

  const unclear: readonly [string, () => Response][] = [
    ["a null error", () => Response.json({ error: null, id: "bramble-strk20", jsonrpc: "2.0" })],
    ["a bare 4xx", () => new Response("forbidden", { status: 403 })],
    [
      "an error without a message",
      () => Response.json({ error: { code: 163 }, id: "bramble-strk20", jsonrpc: "2.0" }),
    ],
    [
      "an error beside a result",
      () =>
        Response.json({
          error: { code: 163, message: "no" },
          id: "bramble-strk20",
          jsonrpc: "2.0",
          result: { transaction_hash: "0x5ab" },
        }),
    ],
  ];
  for (const [name, answer] of unclear) {
    test(`${name} on the broadcast is status unknown and keeps the hold`, async () => {
      const { activity, deps, pending } = await harness({ relay: relay(answer) });
      expect(await submit(deps)).toMatchObject({ submissionUnknown: true });
      expect(pending.entry(ozAccount)).toBeDefined();
      expect(await activity.list()).toEqual([]);
      expect(await submit(deps)).toEqual({ error: DEPLOYMENT_IN_PROGRESS });
    });
  }

  test("an accepted deploy also holds the account until the chain shows it deployed", async () => {
    const sponsor = relay(accepted);
    const { chain, deps, pending } = await harness({ relay: sponsor });
    await submit(deps);
    expect(await submit(deps)).toEqual({ error: DEPLOYMENT_IN_PROGRESS });
    chain.deployed = true;
    expect(await submit(deps)).toEqual({ error: "account already deployed" });
    expect(pending.entry(ozAccount)).toBeUndefined();
    expect(sponsor.calls).toEqual(["paymaster_buildTransaction", "paymaster_executeTransaction"]);
  });

  test("refuses before asking the relay when the account is deployed", async () => {
    const sponsor = relay(accepted);
    const { deps, pending } = await harness({ deployed: true, relay: sponsor });
    expect(await submit(deps)).toEqual({ error: "account already deployed" });
    expect(sponsor.calls).toEqual([]);
    expect(pending.entry(ozAccount)).toBeUndefined();
  });

  test("an unreadable deployment status is unknown, never deployed, and sends nothing", async () => {
    const sponsor = relay(accepted);
    const { deps, pending } = await harness({ deployed: new Error("rpc down"), relay: sponsor });
    expect(await submit(deps)).toEqual({ error: DEPLOYMENT_STATUS_UNKNOWN });
    expect(sponsor.calls).toEqual([]);
    expect(pending.entry(ozAccount)).toBeUndefined();
  });

  test("declines, sending nothing, an unsupported class and a network with sponsorship off", async () => {
    const sponsor = relay(accepted);
    const braavos = await harness({ account: braavosAccount, relay: sponsor });
    expect(await submit(braavos.deps)).toEqual(SPONSORED_DEPLOY_DECLINED);
    expect(sponsor.calls).toEqual([]);
    const off = await harness({ relayOn: "off" });
    expect(await submit(off.deps)).toEqual(SPONSORED_DEPLOY_DECLINED);
  });

  test("refuses an account whose stored address its deployment data cannot reproduce", async () => {
    const sponsor = relay(accepted);
    const { deps } = await harness({
      account: { ...ozAccount, publicKeyX: "0x123" },
      relay: sponsor,
    });
    expect(await submit(deps)).toEqual({
      error: "Account deployment parameters do not match the stored address",
    });
    expect(sponsor.calls).toEqual([]);
  });

  test("refuses when the wallet is locked", async () => {
    const sponsor = relay(accepted);
    const { deps } = await harness({ relay: sponsor, unlocked: false });
    expect(await submit(deps)).toEqual({ error: "wallet locked" });
    expect(sponsor.calls).toEqual([]);
  });
});

describe("sponsored deploy messages", () => {
  test("are privileged, and offer nothing in production wiring while the gateway is off", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
    await preferencesStore.setActiveNetwork("SN_SEPOLIA");
    const handler = createMessageHandler(
      createWallet({ accounts: [ozAccount], activeAccountId: () => ozAccount.id }),
      testExtension,
      {
        preferencesStore,
        runtimeRpc: makeRuntimeRpc({
          async getDeploymentStatus() {
            return false;
          },
        }),
        session,
      },
    );
    const content = { id: "extension-id", url: "https://example.com/app" };
    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (input: string) => {
      fetched.push(input);
      return new Response("sponsored_deploy_disabled", { status: 404 });
    }) as typeof fetch;
    try {
      for (const type of ["wallet.deploySponsorship", "wallet.deployAccountSponsored"]) {
        expect(await handler({ type }, content)).toEqual({ error: "privileged sender required" });
      }
      expect(fetched).toEqual([]);
      expect(await handler({ type: "wallet.deploySponsorship" }, extensionSender)).toMatchObject({
        ok: true,
        sponsorship: "none",
      });
      // A press that raced the switch-off sends nothing and turns self-paid.
      expect(await handler({ type: "wallet.deployAccountSponsored" }, extensionSender)).toEqual({
        ...SPONSORED_DEPLOY_DECLINED,
      });
      expect(
        await handler({ extra: true, type: "wallet.deployAccountSponsored" }, extensionSender),
      ).toEqual({ error: "invalid sponsored deploy request" });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(fetched.length).toBeGreaterThan(0);
    for (const url of fetched) {
      expect(url).toBe("https://wallet.nodes.starknet.org/api/sponsored-deploy/sepolia");
    }
  });
});
