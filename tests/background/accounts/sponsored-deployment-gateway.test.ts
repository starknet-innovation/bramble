/**
 * The wallet gateway's sponsored-deploy route (#788), answer by answer, as the
 * background reads it. The gateway is the on/off switch and its budget and
 * abuse limits are its own, so whatever it answers to a quote leaves the user
 * a self-paid deploy with no sponsor message; an answer to the broadcast is a
 * determinate refusal only as a clean JSON-RPC error, and anything else holds
 * the account until the chain decides. Only the exact classes it accepts are
 * ever offered.
 */
import { describe, expect, test } from "bun:test";
import {
  SPONSORED_DEPLOY_REFUSED,
  SPONSORED_DEPLOY_UNSUPPORTED,
} from "@bramble/privacy/sponsored-deploy";
import { createMemoryStore } from "@bramble/store/kv";
import { createActivityLog } from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  type DeployAccountDeps,
  handleDeployAccountSponsored,
  handleDeploySponsorship,
} from "../../../apps/extension/src/background/accounts/deploy-account-ops";
import {
  DEPLOYMENT_MAY_BE_ON_ITS_WAY,
  guardDeployments,
  type PendingDeployments,
  SPONSORED_DEPLOY_HOLD_MS,
} from "../../../apps/extension/src/background/accounts/pending-deployments";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import {
  accepted,
  argentAccount,
  argentAccountAt,
  type Chain,
  sponsoredHarness as harness,
  OLDER_OZ_CLASS_HASH,
  ozAccount,
  ozAccountAt,
  type Relay,
  relay,
  xverseAccount,
} from "../../support/sponsored-deploy-harness";

const INSIDE = 60_000;
const AFTER = SPONSORED_DEPLOY_HOLD_MS + 1;
const HELD = { error: DEPLOYMENT_MAY_BE_ON_ITS_WAY };
// Argent 0.3.1: a real Argent class the gateway does not sponsor.
const OLDER_ARGENT_CLASS_HASH =
  "0x029927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b";

const offer = async (deps: DeployAccountDeps, now = 0): Promise<unknown> => {
  const reply = await handleDeploySponsorship(
    { ...deps, now: () => now },
    { type: "wallet.deploySponsorship" },
  );
  return "sponsorship" in reply ? reply.sponsorship : reply;
};
const submit = (deps: DeployAccountDeps, now = 0) =>
  handleDeployAccountSponsored(
    { ...deps, now: () => now },
    { type: "wallet.deployAccountSponsored" },
  );

// The gateway's own refusal before forwarding: a JSON-RPC error echoing the id.
const gatewayError = (status: number, code: string) => (): Response =>
  new Response(
    JSON.stringify({
      error: { code: -32000, message: code },
      id: "bramble-strk20",
      jsonrpc: "2.0",
    }),
    { status },
  );
const plain = (status: number, body: string) => (): Response => new Response(body, { status });

// A relay whose quote gets `answer`; it is never asked to broadcast.
const quoteAnswer = (answer: () => Promise<Response> | Response): Relay => {
  const calls: string[] = [];
  return {
    calls,
    http: async (_url, init) => {
      calls.push((JSON.parse(String(init?.body)) as { method: string }).method);
      return answer();
    },
  };
};

// A self-paid deploy behind the shared guard, as the deploy screen sends it.
const selfPaid = (pending: PendingDeployments, now: number) => {
  let sent = 0;
  const rpc = guardDeployments(
    makeRuntimeRpc({
      async submitAccountDeployment() {
        sent += 1;
        return { transactionHash: "0x99" };
      },
      async verifyAccountClassHash() {
        return { status: "undeployed" };
      },
    }) as RuntimeRpc,
    { now: () => now, pendingDeployments: pending },
  );
  return rpc
    .submitAccountDeployment({ account: ozAccount, rpcUrls: ["https://rpc.test"] } as never)
    .then(
      () => sent,
      (error: unknown) => (error instanceof Error ? error.message : "refused"),
    );
};

describe("which accounts are offered sponsorship", () => {
  const accepted_: readonly [string, AccountRef][] = [
    ["OpenZeppelin 3.0", ozAccount],
    ["Argent 0.4.0", argentAccount],
    ["the Xverse Argent 0.4.0 build", xverseAccount],
  ];
  for (const [name, account] of accepted_) {
    test(`${name} is offered, and deploys through the sponsor`, async () => {
      const sponsor = relay(accepted);
      const { deps } = await harness({ account, relay: sponsor });
      expect(await offer(deps)).toBe("available");
      expect(await submit(deps)).toEqual({ ok: true, transactionHash: "0x5ab" });
      expect(sponsor.calls).toEqual([
        "paymaster_buildTransaction",
        "paymaster_buildTransaction",
        "paymaster_executeTransaction",
      ]);
    });
  }

  const others: readonly [string, AccountRef][] = [
    ["an older OpenZeppelin class", ozAccountAt(OLDER_OZ_CLASS_HASH)],
    ["an older Argent class", argentAccountAt(OLDER_ARGENT_CLASS_HASH)],
  ];
  for (const [name, account] of others) {
    test(`${name} is never offered or sent, so it deploys self-paid`, async () => {
      const sponsor = relay(accepted);
      const { deps } = await harness({ account, relay: sponsor });
      expect(await offer(deps)).toBe("none");
      expect(await submit(deps)).toEqual({ error: SPONSORED_DEPLOY_UNSUPPORTED });
      expect(sponsor.calls).toEqual([]);
    });
  }
});

describe("a quote the gateway does not give offers nothing, quietly", () => {
  const answers: readonly [string, () => Promise<Response> | Response][] = [
    ["switched off (404 sponsored_deploy_disabled)", plain(404, "sponsored_deploy_disabled")],
    ["rate-limited (plain 429)", plain(429, "too_many_requests")],
    [
      "budget spent (429 sponsorship_budget_exhausted)",
      gatewayError(429, "sponsorship_budget_exhausted"),
    ],
    ["already attempted (429)", gatewayError(429, "sponsored_deploy_already_attempted")],
    ["a clean JSON-RPC refusal on a 200", gatewayError(200, "class_not_supported")],
    ["a 5xx", plain(502, "bad gateway")],
    ["a 503 with a JSON-RPC error", gatewayError(503, "deployment_status_unavailable")],
    [
      "a transport failure",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
    [
      "a deadline",
      () => {
        throw new DOMException("deadline", "TimeoutError");
      },
    ],
    ["a garbled body", plain(200, "{not json")],
    [
      "an unusable echo",
      () =>
        Response.json({
          id: "bramble-strk20",
          jsonrpc: "2.0",
          result: { deployment: {}, type: "deploy" },
        }),
    ],
  ];
  for (const [name, answer] of answers) {
    test(`${name}: "none", and a press sends nothing and turns self-paid`, async () => {
      const sponsor = quoteAnswer(answer);
      const { activity, deps, pending } = await harness({ relay: sponsor });
      expect(await offer(deps)).toBe("none");
      expect(await submit(deps)).toEqual({ error: SPONSORED_DEPLOY_REFUSED });
      expect(sponsor.calls).toEqual(["paymaster_buildTransaction", "paymaster_buildTransaction"]);
      expect(pending.entry(ozAccount)).toBeUndefined();
      expect(await activity.list()).toEqual([]);
      expect(await selfPaid(pending, 0)).toBe(1);
    });
  }
});

describe("a broadcast refused before forwarding sent nothing", () => {
  for (const code of ["sponsored_deploy_already_attempted", "sponsorship_budget_exhausted"]) {
    test(`429 ${code} turns self-paid at once`, async () => {
      const { activity, deps, pending } = await harness({ relay: relay(gatewayError(429, code)) });
      expect(await submit(deps)).toEqual({ error: SPONSORED_DEPLOY_REFUSED });
      expect(pending.entry(ozAccount)).toBeUndefined();
      expect(await activity.list()).toEqual([]);
      expect(await selfPaid(pending, 0)).toBe(1);
    });
  }

  test("409 account_already_deployed shows the account deployed when the chain agrees", async () => {
    const chain: Chain = { deployed: false };
    const refuse = gatewayError(409, "account_already_deployed");
    const { activity, deps, pending } = await harness({
      chain,
      relay: relay(() => {
        chain.deployed = true;
        return refuse();
      }),
    });
    expect(await submit(deps)).toEqual({ error: "account already deployed" });
    expect(pending.entry(ozAccount)).toBeUndefined();
    expect(await activity.list()).toEqual([]);
  });

  test("409 with the chain still showing it undeployed, or unreadable, turns self-paid", async () => {
    for (const after of [false, new Error("rpc down")]) {
      const chain: Chain = { deployed: false };
      const refuse = gatewayError(409, "account_already_deployed");
      const { deps, pending } = await harness({
        chain,
        relay: relay(() => {
          chain.deployed = after;
          return refuse();
        }),
      });
      expect(await submit(deps)).toEqual({ error: SPONSORED_DEPLOY_REFUSED });
      expect(pending.entry(ozAccount)).toBeUndefined();
    }
  });
});

describe("a broadcast answer that does not prove nothing was sent holds the account", () => {
  const lostAnswers: readonly [string, () => Promise<Response> | Response][] = [
    ["503 deployment_status_unavailable", gatewayError(503, "deployment_status_unavailable")],
    ["a relay 4xx relayed as a plain body", plain(400, "upstream_rejected")],
    ["a switched-off gateway's plain 404", plain(404, "sponsored_deploy_disabled")],
    ["a 5xx", plain(500, "internal")],
    [
      "a transport failure",
      () => {
        throw new TypeError("connection reset");
      },
    ],
    [
      "a result without a hash",
      () => Response.json({ id: "bramble-strk20", jsonrpc: "2.0", result: {} }),
    ],
  ];
  for (const [name, answer] of lostAnswers) {
    test(`${name}: no self-paid offer until the hold resolves from the chain`, async () => {
      const { activity, chain, deps, pending } = await harness({ relay: relay(answer) });
      expect(await submit(deps)).toMatchObject({ submissionUnknown: true });
      expect(await activity.list()).toEqual([]);
      // Inside the hold: nothing re-offered, and both deploy routes refuse.
      expect(await offer(deps, INSIDE)).toBe("held");
      expect(await submit(deps, INSIDE)).toEqual(HELD);
      expect(await selfPaid(pending, INSIDE)).toBe(DEPLOYMENT_MAY_BE_ON_ITS_WAY);
      // Over, with the chain showing it empty: self-paid, never sponsored again.
      expect(await offer(deps, AFTER)).toBe("may-land");
      expect(await selfPaid(pending, AFTER)).toBe(1);
      // The chain showing it deployed ends it as deployed.
      chain.deployed = true;
      expect(await submit(deps, AFTER)).toEqual({ error: "account already deployed" });
    });
  }
});

describe("the sponsored Activity row", () => {
  test("two overlapping deploys answered with one hash record it once", async () => {
    const store = createMemoryStore();
    const activity = createActivityLog({
      now: () => 1,
      store: {
        ...store,
        // Reads answer late, so unserialized recordings would both read first.
        get: async (key) => {
          const value = await store.get(key);
          await new Promise((resolve) => setTimeout(resolve, 5));
          return value;
        },
      },
    });
    const first = await harness({ activity, relay: relay(accepted) });
    const second = await harness({ account: argentAccount, activity, relay: relay(accepted) });
    const answers = await Promise.all([submit(first.deps), submit(second.deps)]);
    expect(answers).toContainEqual({ ok: true, transactionHash: "0x5ab" });
    expect(answers.find((answer) => !("ok" in answer))).toMatchObject({ submissionUnknown: true });
    const rows = await activity.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feePayer: "sponsor", hash: "0x5ab", kind: "deploy" });
    // The losing attempt is not tied to the hash: its hold stands until the chain decides.
    const loser = answers[0] && "ok" in answers[0] ? second : first;
    const loserAccount = loser === first ? ozAccount : argentAccount;
    expect(loser.pending.entry(loserAccount)).toMatchObject({
      holdUntil: SPONSORED_DEPLOY_HOLD_MS,
    });
    expect(loser.pending.entry(loserAccount)?.hash).toBeUndefined();
  });
});
