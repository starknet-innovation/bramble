/**
 * Sponsored account deployment (#431) in the background: the offer, the
 * submission, and what Activity records. The relay is a fake SNIP-29 paymaster.
 * Off by default, so the production table is never consulted here; each test
 * names the relay it turns on.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { SPONSORED_DEPLOY_REFUSED } from "@bramble/privacy/sponsored-deploy";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryActivityLog } from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { hash } from "starknet";
import {
  type DeployAccountDeps,
  handleDeployAccountSponsored,
  handleDeploySponsorship,
} from "../../../apps/extension/src/background/accounts/deploy-account-ops";
import {
  forgetSponsoredDeployHolds,
  SPONSORED_DEPLOY_HELD,
} from "../../../apps/extension/src/background/accounts/sponsored-deployment";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const CLASS_HASH = "0x61dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";
const PUBLIC_KEY = "0x1f3c942d7f492a37608cde0d77b884a5aa9e11d2919225968557370ddb5a5aa";
const ADDRESS = hash.calculateContractAddressFromHash(PUBLIC_KEY, CLASS_HASH, [PUBLIC_KEY], 0);
const RELAY = { SN_SEPOLIA: { url: "https://gateway.test/sponsor" } };

const ozAccount: AccountRef = {
  accountContractType: "openzeppelin",
  address: ADDRESS,
  classHash: CLASS_HASH,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_SEPOLIA:${ADDRESS}`,
  networkId: "SN_SEPOLIA",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0x2",
};

const braavosAccount: AccountRef = {
  ...ozAccount,
  accountContractType: "braavos",
  deploymentSalt: PUBLIC_KEY,
};

type Relay = {
  readonly calls: string[];
  readonly http: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

// A relay that sponsors (`buildTransaction` echoes the request) and answers the
// broadcast with `execute`.
const relay = (execute: () => Promise<Response> | Response, quote = true): Relay => {
  const calls: string[] = [];
  return {
    calls,
    http: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        method: string;
        params: { parameters: unknown; transaction: { deployment: unknown } };
      };
      calls.push(request.method);
      if (request.method === "paymaster_executeTransaction") return execute();
      return quote
        ? json({
            id: "bramble-strk20",
            jsonrpc: "2.0",
            result: {
              deployment: request.params.transaction.deployment,
              parameters: request.params.parameters,
              type: "deploy",
            },
          })
        : json({
            error: { code: 163, message: "sponsorship limit reached" },
            id: "bramble-strk20",
            jsonrpc: "2.0",
          });
    },
  };
};

const accepted = (): Response =>
  json({ id: "bramble-strk20", jsonrpc: "2.0", result: { transaction_hash: "0x5ab" } });

const harness = async (input: {
  readonly account?: AccountRef;
  readonly balance?: string;
  readonly deployed?: boolean | Error;
  readonly relay?: Relay;
  readonly relayOn?: boolean;
  readonly unlocked?: boolean;
}) => {
  const account = input.account ?? ozAccount;
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  const session = createUnlockSession();
  if (input.unlocked ?? true) session.unlock(vaultPassphrase);
  const activity = memoryActivityLog();
  const runtimeRpc = makeRuntimeRpc({
    async estimateAccountDeploymentFee() {
      return { overallFee: "1000", unit: "FRI" };
    },
    async getDeploymentStatus() {
      const deployed = input.deployed ?? false;
      if (deployed instanceof Error) throw deployed;
      return deployed;
    },
    async getTokenBalances({ tokens }) {
      return tokens.map((token) => ({ ...token, balance: input.balance ?? "0", formatted: "0" }));
    },
  }) as RuntimeRpc;
  const deps: DeployAccountDeps = {
    activity,
    preferencesStore,
    runtimeRpc,
    session,
    ...(input.relayOn === false
      ? {}
      : {
          sponsoredDeploy: {
            ...(input.relay ? { http: input.relay.http } : {}),
            networks: RELAY,
          },
        }),
    wallet: createWallet({ accounts: [account], activeAccountId: () => account.id }),
  };
  return { activity, deps };
};

beforeEach(() => {
  forgetSponsoredDeployHolds();
});

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

  test("says the sponsor declined, so the screen can fall back to a self-paid deploy", async () => {
    const { deps } = await harness({ relay: relay(accepted, false) });
    expect(await handleDeploySponsorship(deps, { type: "wallet.deploySponsorship" })).toEqual({
      ok: true,
      sponsorship: "refused",
    });
  });
});

describe("sponsored deploy submission", () => {
  const submit = (deps: DeployAccountDeps) =>
    handleDeployAccountSponsored(deps, { type: "wallet.deployAccountSponsored" });

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
    const sponsor = relay(() => new Response("bad gateway", { status: 502 }));
    const { activity, deps } = await harness({ relay: sponsor });
    const first = await submit(deps);
    expect(first).toMatchObject({ submissionUnknown: true });
    expect(await activity.list()).toEqual([]);
    expect(await submit(deps)).toEqual({ error: SPONSORED_DEPLOY_HELD });
    expect(sponsor.calls).toEqual(["paymaster_buildTransaction", "paymaster_executeTransaction"]);
  });

  test("an accepted deploy also holds the account until the chain shows it deployed", async () => {
    const sponsor = relay(accepted);
    const { deps } = await harness({ relay: sponsor });
    await submit(deps);
    expect(await submit(deps)).toEqual({ error: SPONSORED_DEPLOY_HELD });
    const deployed = await harness({ deployed: true, relay: sponsor });
    expect(await submit(deployed.deps)).toEqual({ error: "account already deployed" });
  });

  test("refuses before asking the relay when deployment is unconfirmed or done", async () => {
    for (const deployed of [true, new Error("rpc down")]) {
      const sponsor = relay(accepted);
      const { deps } = await harness({ deployed, relay: sponsor });
      expect(await submit(deps)).toEqual({ error: "account already deployed" });
      expect(sponsor.calls).toEqual([]);
    }
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
