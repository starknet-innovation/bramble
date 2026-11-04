/**
 * Native staking from the background (issue 750): the pool is resolved and
 * verified on chain before anything is built, calls are rebuilt from
 * wallet-side facts on every request, a stake approves exactly what it
 * stakes, a submit needs the reviewed fee, and a lost reply is "status
 * unknown" with the signed hash.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
} from "@bramble/starknet/provider";
import type { InvokeInput } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import {
  invokeAccount,
  invokeExtensionSender,
  invokeVaultPassphrase,
  invokeWalletStub,
} from "../../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import {
  makeStakingChain,
  STAKER,
  STAKING_POOL,
  type StakingChainState,
  stakingReader,
  testStakingNetworks,
  VALIDATOR_ID,
} from "../../support/staking-chain";

const NOW_SECONDS = 1_800_000_000;
const FEE = { overallFee: "1", unit: "FRI" } as const;

const harness = async (
  options: {
    readonly chain?: StakingChainState;
    readonly enabled?: boolean;
    readonly submit?: RuntimeRpc["submitInvokeTransaction"];
  } = {},
) => {
  const chain = options.chain ?? makeStakingChain();
  const session = createUnlockSession();
  session.unlock(invokeVaultPassphrase);
  const activity = memoryActivityLog();
  const allowanceStore = memoryAllowanceStore();
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const estimated: InvokeInput[] = [];
  const submitted: InvokeInput[] = [];
  const runtimeRpc = makeRuntimeRpc({
    async estimateInvokeFee(input) {
      estimated.push(input);
      return FEE;
    },
    readAtPinnedBlock: stakingReader(chain),
    async submitInvokeTransaction(input) {
      submitted.push(input);
      return options.submit
        ? options.submit(input)
        : { calls: input.calls, transactionHash: "0x5ab" };
    },
  });
  const handler = createMessageHandler(invokeWalletStub([invokeAccount]), testExtension, {
    activity,
    allowanceStore,
    now: () => NOW_SECONDS * 1000,
    preferencesStore,
    runtimeRpc,
    session,
    ...(options.enabled === false ? {} : { stakingNetworks: testStakingNetworks }),
  });
  const preferences = await preferencesStore.read();
  const strk = preferences.tokens.find(
    (token) => token.networkId === "SN_MAIN" && sameFelt(token.address, STRK_TOKEN_ADDRESS),
  );
  const send = (message: Record<string, unknown>) => handler(message, invokeExtensionSender);
  // Runs the two-step review: the first request returns the fee, the second
  // carries it and submits.
  const act = async (fields: Record<string, unknown>) => {
    const message = {
      tokenId: strk?.id ?? "",
      type: "wallet.stakingAction",
      validatorId: VALIDATOR_ID,
      ...fields,
    };
    const review = await send(message);
    if (!("feeReview" in review)) return { review, submit: null };
    return { review, submit: await send({ ...message, reviewedFee: review.feeReview }) };
  };
  return { act, activity, allowanceStore, chain, estimated, send, submitted };
};

const member = (overrides: Partial<NonNullable<StakingChainState["member"]>> = {}) => ({
  amount: 5n * 10n ** 18n,
  rewardAddress: invokeAccount.address,
  unclaimed: 0n,
  unpoolAmount: 0n,
  unpoolTime: null,
  ...overrides,
});

describe("staking overview", () => {
  test("is unavailable while the network is switched off", async () => {
    const { send } = await harness({ enabled: false });
    expect(await send({ type: "wallet.stakingOverview" })).toEqual({
      error: "Staking isn't available on this network.",
    });
  });

  test("lists the verified pool with the account's position and the chain's exit window", async () => {
    const chain = makeStakingChain();
    chain.member = member({ unclaimed: 25n * 10n ** 16n });
    const { send } = await harness({ chain });
    const response = await send({ type: "wallet.stakingOverview" });
    expect(response).toMatchObject({
      ok: true,
      staking: {
        exitWindowSeconds: 604_800,
        rows: [
          {
            accepting: true,
            commission: "10%",
            delegated: "1000",
            staked: "5",
            state: "staked",
            symbol: "STRK",
            unclaimed: "0.25",
            validatorId: VALIDATOR_ID,
            validatorName: "Test Validator",
          },
        ],
      },
    });
  });

  test("shows a refusal, not figures, when the pool names another staker", async () => {
    const chain = makeStakingChain();
    chain.poolStaker = "0x999";
    const { send } = await harness({ chain });
    const response = await send({ type: "wallet.stakingOverview" });
    expect(response).toMatchObject({
      staking: { rows: [{ refusal: "Couldn't verify this validator on chain." }] },
    });
  });
});

describe("staking actions", () => {
  test("a first stake approves exactly the amount and enters the verified pool", async () => {
    const { act, activity, allowanceStore, estimated, submitted } = await harness();
    const { review, submit } = await act({ action: "stake", amount: "5" });
    expect(review).toEqual({ feeReview: FEE, ok: true });
    expect(submit).toEqual({ ok: true, transactionHash: "0x5ab" });
    const amount = `0x${(5n * 10n ** 18n).toString(16)}`;
    for (const input of [...estimated, ...submitted]) {
      expect(input.calls).toEqual([
        {
          calldata: [STAKING_POOL, amount, "0x0"],
          contractAddress: STRK_TOKEN_ADDRESS,
          entrypoint: "approve",
        },
        {
          calldata: [invokeAccount.address, amount],
          contractAddress: STAKING_POOL,
          entrypoint: "enter_delegation_pool",
        },
      ]);
    }
    expect(submitted[0]?.reviewedFee).toEqual(FEE);
    expect(await activity.list()).toMatchObject([
      { hash: "0x5ab", kind: "invoke", summary: "Stake 5 STRK with Test Validator" },
    ]);
    expect(await allowanceStore.list()).toMatchObject([{ spender: STAKING_POOL }]);
  });

  test("an existing member adds to the pool instead of entering it again", async () => {
    const chain = makeStakingChain();
    chain.member = member();
    const { act, submitted } = await harness({ chain });
    await act({ action: "stake", amount: "1.5" });
    expect(submitted[0]?.calls[1]?.entrypoint).toBe("add_to_delegation_pool");
  });

  test("nothing is estimated or signed when the pool cannot be verified", async () => {
    const chain = makeStakingChain();
    chain.poolStaker = "0x999";
    const { act, estimated, submitted } = await harness({ chain });
    const { review } = await act({ action: "stake", amount: "5" });
    expect(review).toEqual({ error: "Couldn't verify this validator on chain." });
    expect(estimated).toEqual([]);
    expect(submitted).toEqual([]);
  });

  test("a validator that is leaving takes no new stake but still lets members exit", async () => {
    const chain = makeStakingChain();
    chain.stakerLeaving = true;
    chain.member = member();
    const { act, submitted } = await harness({ chain });
    expect((await act({ action: "stake", amount: "1" })).review).toEqual({
      error: "This validator is leaving staking.",
    });
    await act({ action: "unstake", amount: "2" });
    expect(submitted.map((input) => input.calls[0]?.entrypoint)).toEqual([
      "exit_delegation_pool_intent",
    ]);
  });

  test("an unstake larger than the stake is refused", async () => {
    const chain = makeStakingChain();
    chain.member = member();
    const { act } = await harness({ chain });
    expect((await act({ action: "unstake", amount: "6" })).review).toEqual({
      error: "That's more than you have staked.",
    });
  });

  test("withdraw waits for the exit window the chain reports", async () => {
    const chain = makeStakingChain();
    chain.member = member({ amount: 0n, unpoolAmount: 5n, unpoolTime: NOW_SECONDS + 60 });
    const { act, submitted } = await harness({ chain });
    expect((await act({ action: "withdraw" })).review).toEqual({ error: "Not withdrawable yet." });
    chain.member = member({ amount: 0n, unpoolAmount: 5n, unpoolTime: NOW_SECONDS });
    await act({ action: "withdraw" });
    expect(submitted[0]?.calls).toEqual([
      {
        calldata: [invokeAccount.address],
        contractAddress: STAKING_POOL,
        entrypoint: "exit_delegation_pool_action",
      },
    ]);
  });

  test("claim needs rewards to claim", async () => {
    const chain = makeStakingChain();
    chain.member = member();
    const { act } = await harness({ chain });
    expect((await act({ action: "claim" })).review).toEqual({ error: "No rewards to claim." });
  });

  test("a token the staking contract does not accept is refused", async () => {
    const chain = makeStakingChain();
    chain.activeTokens = ["0x777"];
    const { act, estimated } = await harness({ chain });
    expect((await act({ action: "stake", amount: "1" })).review).toEqual({
      error: "This token can't be staked.",
    });
    expect(estimated).toEqual([]);
  });

  test("a validator that is not on the curated list is refused, even by staker address", async () => {
    const { act } = await harness();
    expect((await act({ action: "stake", amount: "1", validatorId: "0x5a4" })).review).toEqual({
      error: "Staking option unavailable.",
    });
    // The curated validator may be named by its staker address too.
    expect((await act({ action: "stake", amount: "1", validatorId: STAKER })).review).toEqual({
      feeReview: FEE,
      ok: true,
    });
  });

  test("a lost reply is status unknown with the signed hash and a pending row", async () => {
    const { act, activity } = await harness({
      submit: async (input) => {
        await input.onSigned?.({ nonce: "0x1", senderAddress: "0x1", transactionHash: "0x5ee" });
        throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
      },
    });
    const { submit } = await act({ action: "stake", amount: "5" });
    expect(submit).toEqual({
      error: INDETERMINATE_RPC_WRITE_MESSAGE,
      submissionUnknown: true,
      transactionHash: "0x5ee",
    });
    expect(await activity.list()).toMatchObject([{ hash: "0x5ee", status: "pending" }]);
  });

  test("malformed requests are refused before any read", async () => {
    const { chain, send } = await harness();
    for (const message of [
      {
        action: "claim",
        amount: "1",
        tokenId: "x",
        type: "wallet.stakingAction",
        validatorId: VALIDATOR_ID,
      },
      { action: "stake", tokenId: "x", type: "wallet.stakingAction", validatorId: VALIDATOR_ID },
      {
        action: "stake",
        amount: "-1",
        tokenId: "x",
        type: "wallet.stakingAction",
        validatorId: VALIDATOR_ID,
      },
      { action: "burn", tokenId: "x", type: "wallet.stakingAction", validatorId: VALIDATOR_ID },
      {
        action: "claim",
        pool: STAKING_POOL,
        tokenId: "x",
        type: "wallet.stakingAction",
        validatorId: VALIDATOR_ID,
      },
    ]) {
      expect(await send(message)).toEqual({ error: "invalid staking request" });
    }
    expect(chain.reads).toEqual([]);
  });
});
