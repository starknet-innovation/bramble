/**
 * STRK20 wallet-level policy tests around balance and privacy checks.
 */
import { describe, expect, test } from "bun:test";
import {
  prepareStrk20CallAndProof,
  quoteStrk20Actions,
  quoteStrk20Plan,
  readStrk20Balances,
  readStrk20RegistrationStatus,
  registerStrk20Account,
  STRK20_FEE_ABOVE_CEILING,
  STRK20_INSUFFICIENT_BALANCE,
  STRK20_PRIVACY_LEAK,
  STRK20_SERVICE_UNAVAILABLE,
  type Strk20AccountContext,
  type Strk20Service,
  submitStrk20Actions,
  summarizeStrk20Action,
  summarizeStrk20Plan,
  unavailableStrk20Service,
} from "@bramble/privacy/service";
import type { AccountRef } from "@bramble/wallet-model/accounts";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1",
  classHash: "0x2",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1",
  networkId: "SN_MAIN",
  publicKeyX: "0x3",
  publicKeyY: "0x4",
};
const context: Strk20AccountContext = {
  account,
  config: null,
  isAuthorized: () => true,
  rpcUrls: ["https://rpc.example"],
  async signHash() {
    return { publicKey: "0x3", r: "0x1", s: "0x2" };
  },
  async viewingKey() {
    return "0x5";
  },
};
const reviewedFee = { overallFee: "1000", unit: "FRI" } as const;
const callAndProof = {
  call: { calldata: ["0x1"], contract_address: "0x10", entry_point: "apply_actions" },
  proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
} as const;
const plan = {
  feeAction: { amount: "0x1", recipient: "0x5", token: "0x6", type: "withdraw" },
} as const;

const service = (over: Partial<Strk20Service> = {}): Strk20Service => ({
  async prepare() {
    return callAndProof;
  },
  async privateBalances({ tokens }) {
    return tokens.map((token) => ({ balance: "0x64", token }));
  },
  async poolFee() {
    return "0x1";
  },
  async quoteActions() {
    return plan;
  },
  async shadowAccountCommitment() {
    return "0x7";
  },
  async submitActions() {
    return { transactionHash: "0x8" };
  },
  async submitPrepared() {
    return { transactionHash: "0x9" };
  },
  ...over,
});

describe("STRK20 wallet policy", () => {
  test("passes empty all-token balance queries through", async () => {
    expect(await readStrk20Balances(service(), { ...context, tokens: [] })).toEqual([]);
  });

  test("prepares a sufficient action batch", async () => {
    await expect(
      prepareStrk20CallAndProof(service(), {
        ...context,
        actions: [{ amount: "0x10", recipient: "0x9", token: "0x8", type: "transfer" }],
        simulate: false,
      }),
    ).resolves.toEqual(callAndProof);
  });

  test("rejects insufficient private balance before proving", async () => {
    await expect(
      prepareStrk20CallAndProof(
        service({
          async privateBalances({ tokens }) {
            return tokens.map((token) => ({ balance: "0x1", token }));
          },
        }),
        {
          ...context,
          actions: [{ amount: "0x2", recipient: "0x9", token: "0x8", type: "withdraw" }],
          simulate: false,
        },
      ),
    ).rejects.toThrow(STRK20_INSUFFICIENT_BALANCE);
  });

  test("rejects a correlated public deposit and withdrawal", async () => {
    await expect(
      prepareStrk20CallAndProof(service(), {
        ...context,
        actions: [
          { amount: "0x1", token: "0x8", type: "deposit" },
          { amount: "0x1", recipient: "0x9", token: "0x8", type: "withdraw" },
        ],
        simulate: false,
      }),
    ).rejects.toThrow(STRK20_PRIVACY_LEAK);
  });

  test("submits the reviewed plan only after the same policy checks", async () => {
    await expect(
      submitStrk20Actions(service(), {
        ...context,
        actions: [{ amount: "OPEN", recipient: "0x9", token: "0x8", type: "transfer" }],
        plan,
      }),
    ).resolves.toEqual({ transactionHash: "0x8" });
  });

  test("submits a converted fee that is inside its reviewed ceiling", async () => {
    await expect(
      submitStrk20Actions(service(), {
        ...context,
        actions: [{ amount: "OPEN", recipient: "0x9", token: "0x8", type: "transfer" }],
        plan: { ...plan, feeCeiling: { ceiling: "0x2", reference: "0x1" } },
      }),
    ).resolves.toEqual({ transactionHash: "0x8" });
  });

  // The plan is bound into the approval digest, so a fee above its reviewed
  // ceiling should be unreachable. Submission re-checks it anyway: this is the
  // last point before a shielded balance is spent on a number the user never
  // saw, and the check costs one comparison.
  test("refuses a fee above the ceiling the user reviewed", async () => {
    await expect(
      submitStrk20Actions(service(), {
        ...context,
        actions: [{ amount: "OPEN", recipient: "0x9", token: "0x8", type: "transfer" }],
        plan: {
          ...plan,
          feeAction: { ...plan.feeAction, amount: "0x9" },
          feeCeiling: { ceiling: "0x2", reference: "0x1" },
        },
      }),
    ).rejects.toThrow(STRK20_FEE_ABOVE_CEILING);
  });

  test("refuses a plan whose recorded ceiling cannot be read", async () => {
    await expect(
      submitStrk20Actions(service(), {
        ...context,
        actions: [{ amount: "OPEN", recipient: "0x9", token: "0x8", type: "transfer" }],
        plan: { ...plan, feeCeiling: { ceiling: "not-a-felt", reference: "0x1" } },
      }),
    ).rejects.toThrow(STRK20_FEE_ABOVE_CEILING);
  });

  test("quotes a dapp invoke without reading private balances before approval", async () => {
    let privateReads = 0;
    const quoted = service({
      async privateBalances() {
        privateReads += 1;
        throw new Error("private state must remain untouched");
      },
    });

    await expect(
      quoteStrk20Plan(quoted, {
        ...context,
        actions: [{ amount: "0x1", recipient: "0x9", token: "0x8", type: "withdraw" }],
      }),
    ).resolves.toEqual(plan);
    expect(privateReads).toBe(0);
  });

  // Now that the fee follows the token being sent, spend and fee share a
  // balance: sending the whole of it no longer leaves the fee payable. The
  // refusal must come before proving, not from a reverted transaction.
  test("refuses a batch that spends the balance the same-token fee also needs", async () => {
    await expect(
      submitStrk20Actions(service(), {
        ...context,
        // The stub reports a balance of 0x64 for every token; the fee is 0x1
        // of token 0x6, so spending all 0x64 of 0x6 overdraws by exactly one.
        actions: [{ amount: "0x64", recipient: "0x9", token: "0x6", type: "transfer" }],
        plan,
      }),
    ).rejects.toThrow(STRK20_INSUFFICIENT_BALANCE);
  });

  test("allows a same-token batch that leaves room for its fee", async () => {
    await expect(
      submitStrk20Actions(service(), {
        ...context,
        actions: [{ amount: "0x63", recipient: "0x9", token: "0x6", type: "transfer" }],
        plan,
      }),
    ).resolves.toEqual({ transactionHash: "0x8" });
  });

  test("rejects an unaffordable relay fee before approval and before submission", async () => {
    let quoted = false;
    let submitted = false;
    const insufficientFeeService = service({
      async privateBalances({ tokens }) {
        return tokens.map((token) => ({ balance: token === "0x6" ? "0x1" : "0x64", token }));
      },
      async quoteActions() {
        quoted = true;
        return {
          feeAction: { amount: "0x2", recipient: "0x5", token: "0x6", type: "withdraw" },
        };
      },
      async submitActions() {
        submitted = true;
        return { transactionHash: "0x8" };
      },
    });
    const actions = [{ amount: "0x1", recipient: "0x9", token: "0x8", type: "withdraw" }] as const;

    await expect(
      quoteStrk20Actions(insufficientFeeService, { ...context, actions }),
    ).rejects.toThrow(STRK20_INSUFFICIENT_BALANCE);
    expect(quoted).toBe(true);
    await expect(
      submitStrk20Actions(insufficientFeeService, {
        ...context,
        actions,
        plan: {
          feeAction: { amount: "0x2", recipient: "0x5", token: "0x6", type: "withdraw" },
        },
      }),
    ).rejects.toThrow(STRK20_INSUFFICIENT_BALANCE);
    expect(submitted).toBe(false);
  });

  test("counts same-token private spend and relay fee together", async () => {
    const sameTokenPlan = {
      feeAction: { amount: "0x2", recipient: "0x5", token: "0x8", type: "withdraw" },
    } as const;
    const actions = [{ amount: "0x3", recipient: "0x9", token: "0x8", type: "withdraw" }] as const;
    const limited = service({
      async privateBalances({ tokens }) {
        return tokens.map((token) => ({ balance: "0x4", token }));
      },
      async quoteActions() {
        return sameTokenPlan;
      },
    });

    await expect(quoteStrk20Actions(limited, { ...context, actions })).rejects.toThrow(
      STRK20_INSUFFICIENT_BALANCE,
    );
  });

  test("always uses the public account route for deposit-only entry into the pool", async () => {
    let relayQuotes = 0;
    const noRelay = service({
      async quoteActions() {
        relayQuotes += 1;
        return plan;
      },
    });
    const deposit = [{ amount: "0x3", token: "0x8", type: "deposit" }] as const;

    await expect(quoteStrk20Actions(noRelay, { ...context, actions: deposit })).resolves.toEqual({
      mode: "account",
      poolFeeFri: "0x1",
    });
    await expect(
      submitStrk20Actions(noRelay, {
        ...context,
        actions: deposit,
        plan: { mode: "account", poolFeeFri: "0x1" },
      }),
    ).rejects.toThrow("network fee was not reviewed");
    await expect(
      submitStrk20Actions(noRelay, {
        ...context,
        actions: deposit,
        plan: { mode: "account", poolFeeFri: "0x1", reviewedFee },
      }),
    ).resolves.toEqual({ transactionHash: "0x8" });
    await expect(
      submitStrk20Actions(noRelay, {
        ...context,
        actions: [{ amount: "0x1", recipient: "0x9", token: "0x8", type: "transfer" }],
        plan: { mode: "account", poolFeeFri: "0x1" },
      }),
    ).rejects.toThrow(STRK20_PRIVACY_LEAK);
    expect(relayQuotes).toBe(0);
    expect(summarizeStrk20Plan({ mode: "account", poolFeeFri: "0x53444835ec580000" })).toContain(
      "Public account pool fee 6 STRK",
    );
  });

  /**
   * The fee is the one number on the review surface a user can sanity-check,
   * and a raw felt against a raw contract address is not checkable. These pin
   * the readable rendering and the honest fallback when the token is unknown.
   */
  test("renders a converted relay fee and its ceiling in the token's own units", () => {
    const summary = summarizeStrk20Plan(
      {
        feeAction: { amount: "0x124f80", recipient: "0x5", token: "0x6", type: "withdraw" },
        feeCeiling: { ceiling: "0x249f00", reference: "0x124f80" },
      },
      { decimals: 6, symbol: "USDC" },
    );

    expect(summary).toBe("Private relay fee 1.2 USDC · capped at 2.4 USDC");
  });

  test("omits a ceiling on the STRK route, which is matched exactly instead", () => {
    expect(
      summarizeStrk20Plan(
        { feeAction: { amount: "0x124f80", recipient: "0x5", token: "0x6", type: "withdraw" } },
        { decimals: 6, symbol: "USDC" },
      ),
    ).toBe("Private relay fee 1.2 USDC");
  });

  test("falls back to the raw felt and address for a token it cannot describe", () => {
    expect(
      summarizeStrk20Plan({
        feeAction: { amount: "0x124f80", recipient: "0x5", token: "0x6", type: "withdraw" },
      }),
    ).toBe("Private relay fee 0x124f80 (0x6)");
  });

  test("delegates registration status and execution only when the adapter supports them", async () => {
    const ready = service({
      async register() {
        return { transactionHash: "0xa" };
      },
      async registrationStatus() {
        return "registered";
      },
    });

    await expect(readStrk20RegistrationStatus(ready, { ...context, token: "0x8" })).resolves.toBe(
      "registered",
    );
    await expect(registerStrk20Account(ready, { ...context, poolFeeFri: "0x1" })).resolves.toEqual({
      transactionHash: "0xa",
    });
    await expect(
      readStrk20RegistrationStatus(service(), { ...context, token: "0x8" }),
    ).rejects.toThrow(STRK20_SERVICE_UNAVAILABLE);
    await expect(
      registerStrk20Account(service(), { ...context, poolFeeFri: "0x1" }),
    ).rejects.toThrow(STRK20_SERVICE_UNAVAILABLE);
  });

  test("refuses registration when the pool fee changed after review", async () => {
    let registrations = 0;
    const changed = service({
      async poolFee() {
        return "0x2";
      },
      async register() {
        registrations += 1;
        return { transactionHash: "0xa" };
      },
    });

    await expect(registerStrk20Account(changed, { ...context, poolFeeFri: "0x1" })).rejects.toThrow(
      "Private pool fee changed",
    );
    expect(registrations).toBe(0);
  });

  test("the unavailable implementation fails every operation closed", async () => {
    await expect(
      unavailableStrk20Service.privateBalances({ ...context, tokens: [] }),
    ).rejects.toThrow(STRK20_SERVICE_UNAVAILABLE);
    await expect(
      unavailableStrk20Service.prepare({ ...context, actions: [], simulate: true }),
    ).rejects.toThrow(STRK20_SERVICE_UNAVAILABLE);
    await expect(
      unavailableStrk20Service.quoteActions({ ...context, actions: [] }),
    ).rejects.toThrow(STRK20_SERVICE_UNAVAILABLE);
    await expect(
      unavailableStrk20Service.registrationStatus?.({ ...context, token: "0x8" }),
    ).rejects.toThrow(STRK20_SERVICE_UNAVAILABLE);
    await expect(
      unavailableStrk20Service.register?.({ ...context, poolFeeFri: "0x1" }),
    ).rejects.toThrow(STRK20_SERVICE_UNAVAILABLE);
    await expect(
      unavailableStrk20Service.shadowAccountCommitment({ ...context, dappName: "test" }),
    ).rejects.toThrow(STRK20_SERVICE_UNAVAILABLE);
    await expect(
      unavailableStrk20Service.submitActions({ ...context, actions: [], plan }),
    ).rejects.toThrow(STRK20_SERVICE_UNAVAILABLE);
    await expect(
      unavailableStrk20Service.submitPrepared({
        ...context,
        call: { calldata: [], contractAddress: "0x1", entrypoint: "apply_actions" },
        proof: callAndProof.proof,
      }),
    ).rejects.toThrow(STRK20_SERVICE_UNAVAILABLE);
  });

  test("summaries cover private invoke variants without exposing secrets", () => {
    expect(
      summarizeStrk20Action({
        calls: [{ calldata: [], contract_address: "0x8", entry_point: "swap" }],
        collect_policy: { type: "all" },
        dapp_name: "terminal",
        nonce: "0x1",
        type: "shadow_account_invoke",
      }),
    ).toContain("terminal");
    expect(
      summarizeStrk20Action({ calldata: [], contract: "0x123456789", type: "invoke" }),
    ).toContain("Private invoke");
  });
});
