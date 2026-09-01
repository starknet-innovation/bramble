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
  STRK20_INSUFFICIENT_BALANCE,
  STRK20_PRIVACY_LEAK,
  STRK20_SERVICE_UNAVAILABLE,
  type Strk20AccountContext,
  type Strk20Service,
  submitStrk20Actions,
  summarizeStrk20Action,
  summarizeStrk20Plan,
  unavailableStrk20Service,
} from "@mc-wallet/privacy/service";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";

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
  async submitSignHash() {
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
  async subaccountCommitment() {
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
    expect(summarizeStrk20Plan({ mode: "account", poolFeeFri: "0x1" })).toContain(
      "Public account pool fee 0x1",
    );
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
      unavailableStrk20Service.subaccountCommitment({ ...context, dappName: "test" }),
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
        type: "subaccount_invoke",
      }),
    ).toContain("terminal");
    expect(
      summarizeStrk20Action({ calldata: [], contract: "0x123456789", type: "invoke" }),
    ).toContain("Private invoke");
  });
});
