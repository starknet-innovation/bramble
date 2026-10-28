/**
 * Sponsored account deployment (#431) in the background: the offer, the
 * submission, and what Activity records. The shared deploy guard has its own
 * suite (`sponsored-deployment-guard.test.ts`). The relay is a fake SNIP-29 paymaster.
 * Off by default, so the production table is never consulted here; each test
 * names the relay it turns on.
 */
import { describe, expect, test } from "bun:test";
import {
  SPONSORED_DEPLOY_REFUSED,
  SPONSORED_DEPLOY_UNREACHABLE,
} from "@bramble/privacy/sponsored-deploy";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import {
  type DeployAccountDeps,
  handleDeployAccountSponsored,
  handleDeploySponsorship,
} from "../../../apps/extension/src/background/accounts/deploy-account-ops";
import { DEPLOYMENT_MAY_BE_ON_ITS_WAY } from "../../../apps/extension/src/background/accounts/pending-deployments";
import { DEPLOYMENT_STATUS_UNKNOWN } from "../../../apps/extension/src/background/accounts/sponsored-deployment";
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
      { relayOn: false },
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

  test("an unreachable relay at submission sends nothing and leaves no attempt behind", async () => {
    const http = async (): Promise<Response> => new Response("bad gateway", { status: 502 });
    const { deps, pending } = await harness({ relay: { calls: [], http } });
    expect(await submit(deps)).toEqual({ error: SPONSORED_DEPLOY_UNREACHABLE });
    expect(pending.entry(ozAccount)).toBeUndefined();
  });

  test("says the sponsor declined, so the screen can fall back to a self-paid deploy", async () => {
    const { deps } = await harness({ relay: relay(accepted, false) });
    expect(await handleDeploySponsorship(deps, { type: "wallet.deploySponsorship" })).toEqual({
      ok: true,
      sponsorship: "refused",
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
    expect(await submit(deps)).toEqual({ error: SPONSORED_DEPLOY_REFUSED });
    expect(sponsor.calls).toEqual(["paymaster_buildTransaction"]);
    expect(await activity.list()).toEqual([]);
    // Not held: a refusal is determinate, so asking again is safe.
    expect(await submit(deps)).toEqual({ error: SPONSORED_DEPLOY_REFUSED });
  });

  test("a lost reply is status unknown and holds the account against a blind retry", async () => {
    const sponsor = relay(lost);
    const { activity, deps } = await harness({ relay: sponsor });
    const first = await submit(deps);
    expect(first).toMatchObject({ submissionUnknown: true });
    expect(await activity.list()).toEqual([]);
    expect(await submit(deps)).toEqual({ error: DEPLOYMENT_MAY_BE_ON_ITS_WAY });
    expect(sponsor.calls).toEqual(["paymaster_buildTransaction", "paymaster_executeTransaction"]);
  });

  const unclear: readonly [string, () => Response][] = [
    ["a null error", () => Response.json({ error: null, id: "bramble-strk20", jsonrpc: "2.0" })],
    ["a bare 4xx", () => new Response("forbidden", { status: 403 })],
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
      expect(await submit(deps)).toEqual({ error: DEPLOYMENT_MAY_BE_ON_ITS_WAY });
    });
  }

  test("an accepted deploy also holds the account until the chain shows it deployed", async () => {
    const sponsor = relay(accepted);
    const { chain, deps, pending } = await harness({ relay: sponsor });
    await submit(deps);
    expect(await submit(deps)).toEqual({ error: DEPLOYMENT_MAY_BE_ON_ITS_WAY });
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

  test("refuses an unsupported class and a network with sponsorship off", async () => {
    const braavos = await harness({
      account: braavosAccount,
      relay: relay(accepted),
    });
    expect(await submit(braavos.deps)).toEqual({
      error:
        "This account type can't be deployed with a sponsored fee. Add STRK to deploy it yourself.",
    });
    const off = await harness({ relayOn: false });
    expect(await submit(off.deps)).toEqual({ error: "sponsored deployment unavailable" });
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
  test("are privileged, and answer off-by-default in production wiring", async () => {
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
    for (const type of ["wallet.deploySponsorship", "wallet.deployAccountSponsored"]) {
      expect(await handler({ type }, content)).toEqual({ error: "privileged sender required" });
    }
    expect(await handler({ type: "wallet.deploySponsorship" }, extensionSender)).toMatchObject({
      ok: true,
      sponsorship: "none",
    });
    expect(await handler({ type: "wallet.deployAccountSponsored" }, extensionSender)).toEqual({
      error: "sponsored deployment unavailable",
    });
    expect(
      await handler({ extra: true, type: "wallet.deployAccountSponsored" }, extensionSender),
    ).toEqual({ error: "invalid sponsored deploy request" });
  });
});
