/**
 * Every wait inside a shield's proof is bounded, and a lapse settles the job.
 *
 * Reported from a registered mainnet wallet after the job registry shipped:
 * "'Preparing shield' still remains to be incredibly long, and seems there is
 * no success at all yet", with no error shown. The channel fix held, so the
 * work inside the job was what never settled — and it could not: the pinned
 * SDK's discovery pagination has no transport deadline and loops until the
 * indexer says the cursor is complete, the remote prove is a fetch the wallet
 * cannot inject a signal into, and the maturity poll's count bound was no
 * wall-clock bound at all once each node read could take the transport's full
 * deadline. These drive the real deposit job through the real official-SDK
 * adapter with a runtime double that stalls in one phase at a time, and pin
 * that the job settles with a reason naming that phase, inside the budget, and
 * that the last poll before it settled already named the phase.
 */
import { describe, expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { STRK20_PHASES } from "@bramble/privacy/phases";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import type { RpcProvider } from "starknet";
import {
  createGatewayAnalytics,
  withGatewayAnalyticsFlows,
} from "../../../apps/extension/src/background/analytics/gateway-analytics";
import { createStrk20JobRegistry } from "../../../apps/extension/src/background/privacy/strk20-preparation-jobs";
import {
  executeResult,
  sdkRuntime,
  strk20ProviderFor,
} from "../../../packages/features/privacy/tests/support/official-sdk";
import { account } from "../../support/background-wallet-stub";
import { flushHeld } from "../../support/held";
import {
  buildStrk20Handler,
  STRK20_EXTENSION_SENDER,
  STRK20_TOKEN,
  strk20RunningJobId,
} from "../../support/strk20-background";

const POOL = "0x123";

const preferences = (): WalletPreferences => ({
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_SEPOLIA",
  strk20Networks: {
    SN_SEPOLIA: {
      discoveryUrl: "https://discovery.example/strk20",
      poolAddress: POOL,
      proverUrl: "https://prover.example/strk20",
    },
  },
});

const token = preferences().tokens.find(
  (candidate) => candidate.networkId === "SN_SEPOLIA" && candidate.address === STRK20_TOKEN,
);
if (!token) {
  throw new Error("Sepolia token fixture missing");
}

const shield = {
  amount: "1",
  recipient: account.address,
  tokenId: token.id,
  type: "wallet.strk20PrepareDeposit",
};

// Small enough that a suite of stalls finishes in well under a second, large
// enough that the happy path never trips one.
const BUDGET_MS = 40;
const never = (): Promise<never> => new Promise(() => undefined);

type Stall =
  | "building the proof request"
  | "checking registration"
  | "none"
  | "proving"
  | "waiting for pool maturity";

// The official adapter over a runtime double that stalls in exactly one phase.
const officialService = (stall: Stall) => {
  const baseProviderFor = strk20ProviderFor();
  const providerFor = (): RpcProvider => {
    const provider = baseProviderFor();
    return {
      ...provider,
      // A deposit's maturity check reads the account's historical balance at
      // the proving block; a balance that never appears is a pool that never
      // matures for this deposit.
      async callContract(call: { entrypoint?: string }, block?: unknown) {
        if (stall === "waiting for pool maturity" && call.entrypoint === "balanceOf") {
          return ["0x0", "0x0"];
        }
        return provider.callContract(call as never, block as never);
      },
    } as unknown as RpcProvider;
  };
  // The builder is self-referential, as the SDK's is: every action call
  // returns the same builder, so the stalling `createProofInvocation` is the
  // one the adapter ends up calling.
  const builder = {
    createProofInvocation: () =>
      stall === "building the proof request" ? never() : Promise.resolve({ warnings: [] }),
    invoke: () => builder,
    register: () => builder,
    shadowAccounts: () => ({
      commitment: async () => 0x123n,
      invoke: () => builder,
      partialCommitment: async () => 0x456n,
    }),
    surplusTo: () => builder,
    with: () => ({
      deposit: () => ({ done: () => builder }),
      done: () => builder,
      transfer: () => ({ done: () => builder }),
      withdraw: () => ({ done: () => builder }),
    }),
  };
  const sdk = sdkRuntime(() => ({
    build: () => builder as never,
    discoverNotes: async () => ({ notes: new Map() }),
    discoverRequirement: () => (stall === "checking registration" ? never() : Promise.resolve(3)),
    executeWithInvocation: () => (stall === "proving" ? never() : Promise.resolve(executeResult())),
  }));
  return createOfficialStrk20Service({
    pauseForMaturity: async () => {
      await flushHeld();
    },
    providerFor,
    sdk,
    waitBudgets: {
      discovery: BUDGET_MS,
      maturity: BUDGET_MS,
      proofRequest: BUDGET_MS,
      proving: BUDGET_MS,
    },
  });
};

const withAnalyticsFlow = (service: ReturnType<typeof officialService>) => {
  const analytics = createGatewayAnalytics({
    enabled: () => true,
    http: async () => new Response("{}"),
    metadata: {
      appVersion: "0.10.1",
      platform: "chrome",
      releaseChannel: "development",
    },
    randomUuid: () => "11111111-1111-4111-8111-111111111111",
    store: createMemoryStore(),
  });
  return withGatewayAnalyticsFlows(service, analytics.withFlow);
};

// Drives the shield through its job the way the panel does, recording the
// phase of every running poll and every phase the job closed in the
// diagnostics lane, and returns the settled reply with the wall time it took.
const runShield = async (stall: Stall, service = officialService(stall)) => {
  const closed: (readonly [string, string])[] = [];
  const handler = buildStrk20Handler({
    preferences: preferences(),
    publicBalance: "2000000000000000000",
    strk20: service,
    strk20Jobs: createStrk20JobRegistry({
      diagnostics: (_kind, phase, outcome) => {
        closed.push([phase, outcome]);
      },
      now: () => Date.now(),
    }),
  });
  const startedAt = performance.now();
  let response = await handler(shield, STRK20_EXTENSION_SENDER);
  const polled: (string | undefined)[] = [];
  let jobId = strk20RunningJobId(response);
  expect(jobId).not.toBeNull();
  while (jobId !== null) {
    polled.push((response as { strk20Job: { phase?: string } }).strk20Job.phase);
    await flushHeld();
    response = await handler(
      { jobId, type: "wallet.strk20PreparationStatus" },
      STRK20_EXTENSION_SENDER,
    );
    jobId = strk20RunningJobId(response);
  }
  return { closed, elapsedMs: performance.now() - startedAt, polled, response };
};

describe("a shield's waits are bounded and named", () => {
  test("proves and reviews when nothing stalls, reporting each phase in order", async () => {
    const { closed, polled, response } = await runShield("none");
    expect(response).toMatchObject({ ok: true, strk20Preparation: { kind: "deposit" } });
    // Every phase a poll carried is from the fixed vocabulary...
    expect(
      polled.every(
        (phase) => phase === undefined || (STRK20_PHASES as readonly string[]).includes(phase),
      ),
    ).toBe(true);
    // ...and the job closed the pipeline's phases in order, each as "ok": the
    // background's own checks, then the adapter's maturity, proof request and
    // prove, then the fee estimate, then the run.
    expect(closed).toEqual([
      ["checking registration", "ok"],
      ["reading the pool fee", "ok"],
      ["checking the public balance", "ok"],
      ["reading the pool fee", "ok"],
      ["waiting for pool maturity", "ok"],
      ["checking registration", "ok"],
      ["building the proof request", "ok"],
      ["proving", "ok"],
      ["estimating the network fee", "ok"],
      ["job", "ok"],
    ]);
  });

  test("completes when product analytics wraps the service flow", async () => {
    const { response } = await runShield("none", withAnalyticsFlow(officialService("none")));
    expect(response).toMatchObject({ ok: true, strk20Preparation: { kind: "deposit" } });
  });

  for (const stall of [
    "checking registration",
    "waiting for pool maturity",
    "building the proof request",
    "proving",
  ] as const) {
    test(`settles with a reason when ${stall} never finishes`, async () => {
      const { closed, elapsedMs, polled, response } = await runShield(stall);
      expect(response).toEqual({
        error: `strk20 services unavailable: ${stall} did not finish within ${Math.round(BUDGET_MS / 1_000)} s`,
      });
      // The poll that saw the job last saw the phase it was stuck in, so the
      // user was told what the wait was doing before it was called off, and
      // the diagnostics closed that phase and the run as a timeout.
      expect(polled.at(-1)).toBe(stall);
      expect(closed.slice(-2)).toEqual([
        [stall, "timeout"],
        ["job", "timeout"],
      ]);
      // Bounded by the budget, with room for the bounded retries around a
      // registration read and the scheduler's own slack — never the minutes
      // the field report described.
      expect(elapsedMs).toBeLessThan(BUDGET_MS * 10);
    });
  }
});
