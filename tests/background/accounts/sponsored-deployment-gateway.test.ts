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
import { createMemoryStore } from "@bramble/store/kv";
import { createActivityLog } from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  type DeployAccountDeps,
  handleDeployAccountSponsored,
  handleDeploySponsorship,
} from "../../../apps/extension/src/background/accounts/deploy-account-ops";
import {
  createPendingDeployments,
  DEPLOYMENT_IN_PROGRESS,
  guardDeployments,
  nextUtcMidnight,
  type PendingDeployments,
  SPONSORED_ATTEMPT_WINDOW_MS,
  SPONSORED_DEPLOY_HOLD_MS,
} from "../../../apps/extension/src/background/accounts/pending-deployments";
import { SPONSORED_DEPLOY_DECLINED } from "../../../apps/extension/src/background/accounts/sponsored-deployment";
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
const HELD = { error: DEPLOYMENT_IN_PROGRESS };
const DAY = 86_400_000;
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
      expect(await submit(deps)).toEqual(SPONSORED_DEPLOY_DECLINED);
      expect(sponsor.calls).toEqual([]);
    });
  }
});

describe("a quote the gateway does not give offers nothing, quietly", () => {
  // The last field: until when a press then stops offers (the clock is 0), or
  // undefined for no record. Only the budget (00:00 UTC) and an attempt this
  // hour (one hour) are remembered; any other answer leaves no record.
  const answers: readonly [string, () => Promise<Response> | Response, number | undefined][] = [
    [
      "switched off (404 sponsored_deploy_disabled)",
      plain(404, "sponsored_deploy_disabled"),
      undefined,
    ],
    ["rate-limited (plain 429)", plain(429, "too_many_requests"), undefined],
    ["rate-limited (429 JSON-RPC)", gatewayError(429, "rate_limited"), undefined],
    [
      "budget spent (429 sponsorship_budget_exhausted)",
      gatewayError(429, "sponsorship_budget_exhausted"),
      DAY,
    ],
    [
      "already attempted (429)",
      gatewayError(429, "sponsored_deploy_already_attempted"),
      SPONSORED_ATTEMPT_WINDOW_MS,
    ],
    ["a clean JSON-RPC refusal on a 200", gatewayError(200, "class_not_supported"), undefined],
    ["a 5xx", plain(502, "bad gateway"), undefined],
    ["a 503 with a JSON-RPC error", gatewayError(503, "deployment_status_unavailable"), undefined],
    [
      "a transport failure",
      () => {
        throw new TypeError("fetch failed");
      },
      undefined,
    ],
    [
      "a deadline",
      () => {
        throw new DOMException("deadline", "TimeoutError");
      },
      undefined,
    ],
    ["a garbled body", plain(200, "{not json"), undefined],
    [
      "an unusable echo",
      () =>
        Response.json({
          id: "bramble-strk20",
          jsonrpc: "2.0",
          result: { deployment: {}, type: "deploy" },
        }),
      undefined,
    ],
  ];
  for (const [name, answer, refusedUntil] of answers) {
    test(`${name}: "none", and a press sends nothing and turns self-paid`, async () => {
      const sponsor = quoteAnswer(answer);
      const { activity, deps, pending } = await harness({ relay: sponsor });
      expect(await offer(deps)).toBe("none");
      expect(await submit(deps)).toEqual(SPONSORED_DEPLOY_DECLINED);
      expect(sponsor.calls).toEqual(["paymaster_buildTransaction", "paymaster_buildTransaction"]);
      expect(pending.entry(ozAccount)?.refusedUntil).toBe(refusedUntil);
      expect(await activity.list()).toEqual([]);
      expect(await selfPaid(pending, 0)).toBe(1);
    });
  }
});

describe("a broadcast refused before forwarding sent nothing", () => {
  const windows: readonly [string, number | undefined][] = [
    ["sponsored_deploy_already_attempted", SPONSORED_ATTEMPT_WINDOW_MS],
    ["sponsorship_budget_exhausted", DAY],
    ["rate_limited", undefined],
    ["some_future_code", undefined],
  ];
  for (const [code, refusedUntil] of windows) {
    test(`429 ${code} turns self-paid at once`, async () => {
      const { activity, deps, pending } = await harness({ relay: relay(gatewayError(429, code)) });
      expect(await submit(deps)).toEqual(SPONSORED_DEPLOY_DECLINED);
      expect(pending.entry(ozAccount)?.refusedUntil).toBe(refusedUntil);
      expect(pending.entry(ozAccount)?.holdUntil ?? 0).toBe(0);
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
      expect(await submit(deps)).toEqual(SPONSORED_DEPLOY_DECLINED);
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
      expect(await selfPaid(pending, INSIDE)).toBe(DEPLOYMENT_IN_PROGRESS);
      // Over, with the chain showing it empty: self-paid, never sponsored again.
      expect(await offer(deps, AFTER)).toBe("none");
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

describe("after the sponsor says no, no offer until 00:00 UTC", () => {
  const T = 5 * DAY + 10 * 3_600_000; // 10:00 UTC on day 5
  const budgetSpent = gatewayError(429, "sponsorship_budget_exhausted");

  test("the refused account is not offered again that day, then is after the reset", async () => {
    const sponsor = relay(budgetSpent);
    const { deps, pending } = await harness({ relay: sponsor });
    expect(await offer(deps, T)).toBe("available");
    expect(await submit(deps, T)).toEqual(SPONSORED_DEPLOY_DECLINED);
    expect(pending.entry(ozAccount)?.refusedUntil).toBe(6 * DAY);
    const asked = sponsor.calls.length;
    for (const now of [T + 3_600_000, 6 * DAY - 1]) {
      expect(await offer(deps, now)).toBe("none");
      // A press that raced the screen is declined without asking the relay.
      expect(await submit(deps, now)).toEqual(SPONSORED_DEPLOY_DECLINED);
    }
    expect(sponsor.calls.length).toBe(asked);
    // Self-paid is never held by a refusal.
    expect(await selfPaid(pending, T + 1)).toBe(1);
    expect(await offer(deps, 6 * DAY)).toBe("available");
    expect(sponsor.calls.length).toBe(asked + 1);
    expect(pending.entry(ozAccount)).toBeUndefined();
  });

  test("an attempt already made this hour stops offers for an hour, not until midnight", async () => {
    const sponsor = relay(gatewayError(429, "sponsored_deploy_already_attempted"));
    const { deps, pending } = await harness({ relay: sponsor });
    expect(await submit(deps, T)).toEqual(SPONSORED_DEPLOY_DECLINED);
    expect(pending.entry(ozAccount)?.refusedUntil).toBe(T + SPONSORED_ATTEMPT_WINDOW_MS);
    const asked = sponsor.calls.length;
    expect(await offer(deps, T + SPONSORED_ATTEMPT_WINDOW_MS - 1)).toBe("none");
    expect(sponsor.calls.length).toBe(asked);
    expect(await offer(deps, T + SPONSORED_ATTEMPT_WINDOW_MS)).toBe("available");
  });

  test("any other clean refusal is self-paid this time only", async () => {
    for (const code of ["rate_limited", "account_already_deployed", "not_a_known_code"]) {
      const sponsor = relay(gatewayError(429, code));
      const { deps, pending } = await harness({ relay: sponsor });
      expect(await submit(deps, T)).toEqual(SPONSORED_DEPLOY_DECLINED);
      expect(pending.entry(ozAccount)).toBeUndefined();
      expect(await offer(deps, T + 1)).toBe("available");
    }
  });

  test("the gateway switched off is not a refusal: switching it on offers the same day", async () => {
    let on = false;
    const calls: string[] = [];
    const gateway: Relay = {
      calls,
      http: async (url, init) => {
        if (on) return relay(accepted).http(url, init);
        calls.push((JSON.parse(String(init?.body)) as { method: string }).method);
        return plain(404, "sponsored_deploy_disabled")();
      },
    };
    const { deps, pending } = await harness({ relay: gateway });
    // Off at the offer and at a press: nothing offered, nothing remembered.
    expect(await offer(deps, T)).toBe("none");
    expect(await submit(deps, T)).toEqual(SPONSORED_DEPLOY_DECLINED);
    expect(pending.entry(ozAccount)).toBeUndefined();
    expect(calls).toEqual(["paymaster_buildTransaction", "paymaster_buildTransaction"]);
    // Switched on later that day: offered at once.
    on = true;
    expect(await offer(deps, T + 3_600_000)).toBe("available");
    expect(await submit(deps, T + 3_600_000)).toEqual({ ok: true, transactionHash: "0x5ab" });
  });

  test("survives a restart, and leaves other accounts offered", async () => {
    const storage = createMemoryStore();
    const first = await harness({
      pending: createPendingDeployments(storage),
      relay: relay(budgetSpent),
    });
    await submit(first.deps, T);
    const restarted = createPendingDeployments(storage);
    const again = await harness({ pending: restarted, relay: relay(accepted) });
    expect(await offer(again.deps, T + 1)).toBe("none");
    const other = await harness({
      account: argentAccount,
      pending: restarted,
      relay: relay(accepted),
    });
    expect(await offer(other.deps, T + 1)).toBe("available");
  });

  test("an unreadable store offers nothing and asks no relay", async () => {
    const sponsor = relay(accepted);
    const { deps } = await harness({
      pending: createPendingDeployments({
        ...createMemoryStore(),
        get: async () => {
          throw new Error("storage unavailable");
        },
      }),
      relay: sponsor,
    });
    expect(await offer(deps, T)).toBe("none");
    expect(await submit(deps, T)).toEqual(SPONSORED_DEPLOY_DECLINED);
    expect(sponsor.calls).toEqual([]);
  });

  test("names the next 00:00 UTC from the injected clock", () => {
    expect(nextUtcMidnight(0)).toBe(DAY);
    expect(nextUtcMidnight(T)).toBe(6 * DAY);
    expect(nextUtcMidnight(6 * DAY - 1)).toBe(6 * DAY);
    expect(nextUtcMidnight(6 * DAY)).toBe(7 * DAY);
  });
});
