/**
 * Sponsored first shield (#789), background journey. With a relay configured
 * a self-credit shield asks the sponsor once, at preparation; a yes freezes a
 * route that charges the user nothing and relays exactly the deposit approvals
 * and the pool call, and anything else silently leaves the self-paid route.
 * After review the route never changes, and a lost answer is status unknown.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { approveCalls, RELAY_PAYS_POOL_FEE } from "@bramble/privacy/official-sdk-values";
import type { Strk20Service } from "@bramble/privacy/service";
import {
  SPONSORED_SHIELD_DECLINED,
  type Strk20SponsoredShieldSubmissionInput,
} from "@bramble/privacy/sponsored-shield";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { PAYMASTER_TIMEOUT_MS } from "@bramble/transactions/paymaster-http";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { OutsideExecutionVersion, outsideExecution } from "starknet";
import { assertSponsoredDepositAffordable } from "../../../apps/extension/src/background/privacy/strk20-sponsored-shield";
import {
  type Strk20DepositPreparation,
  strk20WalletPreparationPayload,
} from "../../../apps/extension/src/background/privacy/strk20-wallet-preparations";
import { account } from "../../support/background-wallet-stub";
import {
  buildStrk20Handler,
  executeStrk20Preparation,
  prepareStrk20Deposit,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";
import { makeStrk20WalletService } from "../../support/strk20-wallet-service";

const POOL = "0x123";
const RELAY = { url: "https://gateway.test/api/sponsored-shield/sepolia" };
const BUNDLED_SEPOLIA = "https://wallet.nodes.starknet.org/api/sponsored-shield/sepolia";
const AMOUNT_RAW = "0x14d1120d7b160000";

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

const deposits = approveCalls(
  [{ amount: AMOUNT_RAW, token: STRK20_TOKEN, type: "deposit" }],
  POOL,
  RELAY_PAYS_POOL_FEE,
);

const sponsoredQuote = {
  fee: { estimated_fee_in_strk: "0x10", suggested_max_fee_in_strk: "0x20" },
  parameters: { fee_mode: { mode: "sponsored" }, version: "0x1" },
  type: "invoke_and_apply_action",
  typed_data: outsideExecution.getTypedData(
    STARKNET_NETWORKS.SN_SEPOLIA.chainId,
    { caller: "0x99", execute_after: "0x1", execute_before: "0x2710" },
    "0x5",
    [...deposits],
    OutsideExecutionVersion.V2,
  ),
};

const envelope = (body: Record<string, unknown>): Response =>
  new Response(JSON.stringify({ id: "bramble-strk20", jsonrpc: "2.0", ...body }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });

type Harness = {
  readonly asked: Record<string, unknown>[];
  readonly urls: string[];
  readonly handler: ReturnType<typeof buildStrk20Handler>;
  readonly activations: (true | undefined)[];
  readonly prepared: unknown[];
  readonly registered: { value: boolean };
  readonly sponsored: Strk20SponsoredShieldSubmissionInput[];
};

const harness = (
  options: {
    readonly answer?: (init?: RequestInit) => Response | Promise<Response>;
    /** The bundled relay table, as production ships it, instead of {@link RELAY}. */
    readonly bundled?: true;
    readonly networks?: Record<string, typeof RELAY>;
    readonly relayed?: () => Promise<{ readonly transactionHash: string }>;
    readonly activity?: ReturnType<typeof memoryActivityLog>;
    readonly registered?: boolean;
  } = {},
): Harness => {
  const asked: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const prepared: unknown[] = [];
  const sponsored: Strk20SponsoredShieldSubmissionInput[] = [];
  const activations: (true | undefined)[] = [];
  const registered = { value: options.registered ?? true };
  const base = makeStrk20WalletService({
    registered,
    registrations: { value: 0 },
    submissions: [],
  });
  const strk20: Strk20Service = {
    ...base,
    async prepareAccountActions(input) {
      activations.push(input.activate);
      return (await base.prepareAccountActions?.(input)) as never;
    },
    async submitPrepared(input) {
      prepared.push(input);
      return base.submitPrepared(input);
    },
    async submitSponsoredShield(input) {
      sponsored.push(input);
      return options.relayed ? options.relayed() : { transactionHash: "0x333" };
    },
  };
  const handler = buildStrk20Handler({
    ...(options.activity ? { activity: options.activity } : {}),
    preferences: preferences(),
    publicBalance: "2000000000000000000",
    sponsoredShield: {
      http: async (url, init) => {
        urls.push(String(url));
        asked.push(JSON.parse(String(init?.body)));
        return (options.answer ?? (() => envelope({ result: sponsoredQuote })))(init);
      },
      ...(options.bundled ? {} : { networks: options.networks ?? { SN_SEPOLIA: RELAY } }),
      nowSeconds: () => 100,
    },
    strk20,
  });
  return { activations, asked, handler, prepared, registered, sponsored, urls };
};

type Review = {
  readonly strk20Preparation: {
    readonly authorization?: { readonly caller: string; readonly publicCallCount: number };
    readonly id: string;
    readonly networkFee?: unknown;
    readonly poolFeeFri?: string;
    readonly route: string;
    readonly sponsor?: { readonly estimatedNetworkFeeFri?: string; readonly name: string };
    readonly summaries: readonly string[];
  };
};

const shield = (handler: Harness["handler"], recipient: string = account.address) =>
  prepareStrk20Deposit(handler, {
    amount: "1.5",
    recipient,
    tokenId: token.id,
    type: "wallet.strk20PrepareDeposit",
  }) as Promise<Review>;

describe("sponsored first shield", () => {
  test("a sponsor's yes reviews as paid by the sponsor and relays only the deposit", async () => {
    const activity = memoryActivityLog(() => 1_700_000_000_000);
    const run = harness({ activity });
    const review = (await shield(run.handler)).strk20Preparation;
    expect(review.route).toBe("sponsored-relay");
    expect(review.sponsor).toEqual({ estimatedNetworkFeeFri: "0x10", name: "Starknet Foundation" });
    expect(review.poolFeeFri).toBe("0x1");
    expect(review.networkFee).toBeUndefined();
    expect(review.authorization).toMatchObject({ caller: "0x99", publicCallCount: 1 });
    expect(review.summaries[1]).toContain("Starknet Foundation pays the pool fee");
    expect(run.asked).toHaveLength(1);

    await expect(executeStrk20Preparation(run.handler, review.id)).resolves.toEqual({
      ok: true,
      transactionHash: "0x333",
    });
    expect(run.prepared).toHaveLength(0);
    expect(run.sponsored).toHaveLength(1);
    const relayed = run.sponsored[0];
    // The deposit approval only: the relay pays the pool, so no STRK fee approval.
    expect(relayed?.calls?.slice(0, -1)).toEqual([...deposits]);
    expect(relayed?.calls?.at(-1)?.entrypoint).toBe("apply_actions");
    expect(relayed?.relay).toEqual(RELAY);
    expect(relayed?.plan.mode).toBe("sponsored-deposit");
    const row = (await activity.list()).find((entry) => entry.hash === "0x333");
    expect(row).toMatchObject({
      feePayer: "sponsor",
      hash: "0x333",
      summary: `Shield 1.5 ${token.symbol}`,
    });
  });

  test("a sponsored first shield registers in the same relayed batch (#789)", async () => {
    const activity = memoryActivityLog(() => 1_700_000_000_000);
    const run = harness({ activity, registered: false });
    const review = (await shield(run.handler)).strk20Preparation;
    expect(review.route).toBe("sponsored-relay");
    expect(review.summaries[0]).toBe(`Activate private balances and shield 1.5 ${token.symbol}`);
    expect(run.activations).toEqual([true]);
    await expect(executeStrk20Preparation(run.handler, review.id)).resolves.toMatchObject({
      ok: true,
      transactionHash: "0x333",
    });
    expect(run.sponsored).toHaveLength(1);
    const row = (await activity.list()).find((entry) => entry.hash === "0x333");
    expect(row).toMatchObject({
      feePayer: "sponsor",
      summary: `Activate private balances and shield 1.5 ${token.symbol}`,
    });
  });

  test("a sponsored first shield refuses at execution if the account registered meanwhile", async () => {
    const run = harness({ registered: false });
    const review = (await shield(run.handler)).strk20Preparation;
    expect(review.route).toBe("sponsored-relay");
    run.registered.value = true;
    await expect(executeStrk20Preparation(run.handler, review.id)).resolves.toMatchObject({
      error: "Private balances changed. Review the shield again.",
    });
    expect(run.sponsored).toHaveLength(0);
    expect(run.prepared).toHaveLength(0);
  });

  test("a sponsor's refusal or silence leaves the self-paid route, unannounced", async () => {
    for (const answer of [
      () => envelope({ error: { code: 163, message: "first shield already sponsored" } }),
      () => new Response("", { status: 404 }),
      () => envelope({ result: { ...sponsoredQuote, fee_action: { type: "withdraw" } } }),
    ]) {
      const run = harness({ answer });
      const review = (await shield(run.handler)).strk20Preparation;
      expect(review.route).toBe("public-account");
      expect(review.sponsor).toBeUndefined();
      expect(review.networkFee).toBeDefined();
      expect(run.asked).toHaveLength(1);
      await expect(executeStrk20Preparation(run.handler, review.id)).resolves.toMatchObject({
        ok: true,
      });
      expect(run.sponsored).toHaveLength(0);
      expect(run.prepared).toHaveLength(1);
    }
  });

  test("is never asked while off, or for a deposit into someone else's balance", async () => {
    const off = harness({ networks: {} });
    expect((await shield(off.handler)).strk20Preparation.route).toBe("public-account");
    expect(off.asked).toHaveLength(0);
    const thirdParty = harness();
    expect((await shield(thirdParty.handler, STRK20_RECIPIENT)).strk20Preparation.route).toBe(
      "public-account",
    );
    expect(thirdParty.asked).toHaveLength(0);
  });

  test("a lost relay answer is status unknown and never falls back to self-paid", async () => {
    const run = harness({
      relayed: () => Promise.reject(new IndeterminateRpcWriteError("lost")),
    });
    const review = (await shield(run.handler)).strk20Preparation;
    const outcome = (await executeStrk20Preparation(run.handler, review.id)) as Record<
      string,
      unknown
    >;
    expect(outcome["submissionUnknown"]).toBe(true);
    expect(run.prepared).toHaveLength(0);
    expect(run.sponsored).toHaveLength(1);
  });

  test("a sponsor that declines at broadcast says so, and never pays self-paid instead", async () => {
    const run = harness({
      bundled: true,
      relayed: () => Promise.reject(new WalletError(SPONSORED_SHIELD_DECLINED)),
    });
    const review = (await shield(run.handler)).strk20Preparation;
    expect(review.route).toBe("sponsored-relay");
    await expect(executeStrk20Preparation(run.handler, review.id)).resolves.toEqual({
      error: SPONSORED_SHIELD_DECLINED,
    });
    expect(SPONSORED_SHIELD_DECLINED).toBe("The sponsor declined this shield. Nothing was sent.");
    expect(run.sponsored).toHaveLength(1);
    expect(run.sponsored[0]?.relay).toEqual({ url: BUNDLED_SEPOLIA });
    expect(run.prepared).toHaveLength(0);
  });
});

describe("sponsored first shield against the bundled gateway", () => {
  const expectSelfPaid = async (run: Harness) => {
    const review = (await shield(run.handler)).strk20Preparation;
    expect(review.route).toBe("public-account");
    expect(review.sponsor).toBeUndefined();
    expect(review.networkFee).toBeDefined();
    await expect(executeStrk20Preparation(run.handler, review.id)).resolves.toMatchObject({
      ok: true,
    });
    expect(run.sponsored).toHaveLength(0);
    expect(run.prepared).toHaveLength(1);
  };

  test("asks only the active network's route, and a switched-off gateway (404) is self-paid", async () => {
    for (const status of [404, 429, 503]) {
      const run = harness({ answer: () => new Response("", { status }), bundled: true });
      await expectSelfPaid(run);
      expect(run.urls).toEqual([BUNDLED_SEPOLIA]);
    }
  });

  test("a sponsor's yes from the gateway relays through that same route", async () => {
    const run = harness({ bundled: true });
    const review = (await shield(run.handler)).strk20Preparation;
    expect(review.route).toBe("sponsored-relay");
    await executeStrk20Preparation(run.handler, review.id);
    expect(run.urls).toEqual([BUNDLED_SEPOLIA]);
    expect(run.sponsored[0]?.relay).toEqual({ url: BUNDLED_SEPOLIA });
  });

  test("an unreachable gateway is self-paid, unannounced", async () => {
    const run = harness({
      answer: () => Promise.reject(new TypeError("fetch failed")),
      bundled: true,
    });
    await expectSelfPaid(run);
    expect(run.urls).toEqual([BUNDLED_SEPOLIA]);
  });

  test("a gateway that hangs is cut off at the paymaster deadline and is self-paid", async () => {
    const realTimeout = AbortSignal.timeout;
    const deadlines: number[] = [];
    // The real deadline, run fast: record what was asked for, fire at once.
    AbortSignal.timeout = (ms: number) => {
      deadlines.push(ms);
      return realTimeout.call(AbortSignal, 1);
    };
    try {
      const run = harness({
        answer: (init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) reject(signal.reason);
            signal?.addEventListener("abort", () => reject(signal.reason));
          }),
        bundled: true,
      });
      await expectSelfPaid(run);
      expect(run.urls).toEqual([BUNDLED_SEPOLIA]);
    } finally {
      AbortSignal.timeout = realTimeout;
    }
    expect(deadlines).toContain(PAYMASTER_TIMEOUT_MS);
  });
});

describe("sponsored shield commitment", () => {
  const base = {
    actions: [],
    allowanceGrants: [],
    amount: "1",
    amountRaw: "0x1",
    calls: [],
    kind: "deposit",
    plan: { mode: "account", poolFeeFri: "0x1" },
    poolAddress: POOL,
    proof: { data: "AA", output: [], proof_facts: [] },
    recipient: account.address,
    summaries: [],
    token,
  } as unknown as Omit<Strk20DepositPreparation, "context" | "id">;
  const sponsorship = {
    plan: {
      authorization: {
        caller: "0x99",
        executeAfter: "0x1",
        executeBefore: "0x2",
        publicCallCount: 1,
      },
      mode: "sponsored-deposit" as const,
      sponsor: "Starknet Foundation",
      typedData: { primaryType: "OutsideExecution" },
    },
    relay: RELAY,
  };

  test("binds the sponsor's plan and relay into the approval digest", () => {
    const payload = strk20WalletPreparationPayload({ ...base, sponsorship }) as Record<
      string,
      unknown
    >;
    expect(payload["sponsorship"]).toEqual(sponsorship);
    expect(payload["networkFee"]).toBeUndefined();
    const other = strk20WalletPreparationPayload({
      ...base,
      sponsorship: { ...sponsorship, relay: { url: "https://other.test" } },
    });
    expect(other).not.toEqual(payload);
  });

  test("leaves a self-paid deposit's payload exactly as before", () => {
    const networkFee = { overallFee: "0x1", unit: "FRI" as const };
    const payload = strk20WalletPreparationPayload({ ...base, networkFee }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload)).not.toContain("sponsorship");
    expect(payload["networkFee"]).toEqual(networkFee);
  });
});

describe("sponsored shield affordability", () => {
  const check = (balance: string | null, amountRaw: string) =>
    assertSponsoredDepositAffordable(
      {
        runtimeRpc: {
          async getTokenBalances({ tokens }: { readonly tokens: readonly { address: string }[] }) {
            return balance === null ? [] : tokens.map((entry) => ({ ...entry, balance }));
          },
        },
      } as never,
      { accountContext: { account, rpcUrls: [] }, token } as never,
      amountRaw,
    );

  test("needs only the deposited amount, no STRK for fees", async () => {
    await expect(check("1000", "0x3e8")).resolves.toBeUndefined();
  });

  test("refuses a short or unreadable balance", async () => {
    await expect(check("999", "0x3e8")).rejects.toThrow(token.symbol);
    await expect(check(null, "0x1")).rejects.toThrow("confirm");
    await expect(check("1e3", "0x1")).rejects.toThrow("confirm");
  });
});
