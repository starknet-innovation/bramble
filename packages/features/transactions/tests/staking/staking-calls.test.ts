/**
 * Staking call builders: exact-amount approvals, and each action allowed only
 * in the position state the pool accepts it in.
 */
import { describe, expect, test } from "bun:test";
import {
  buildStakingCalls,
  type StakingBuildInput,
  stakingActivitySummary,
  stakingPositionState,
} from "../../src/staking/staking-calls";
import type { PoolMember } from "../../src/staking/staking-decode";
import {
  STAKING_DIRECTORY_URLS,
  STAKING_NETWORKS,
  stakerAddress,
  stakingNetwork,
} from "../../src/staking/staking-networks";

const ACCOUNT = "0xacc";
const POOL = "0xb001";
const TOKEN = "0x7e4";
const NOW = 1_000;

const member = (overrides: Partial<PoolMember> = {}): PoolMember => ({
  amount: 10n,
  rewardAddress: ACCOUNT,
  unclaimedRewards: 0n,
  unpoolAmount: 0n,
  unpoolTime: null,
  ...overrides,
});

const build = (overrides: Partial<StakingBuildInput>) =>
  buildStakingCalls({
    account: ACCOUNT,
    action: "stake",
    amount: 5n,
    member: "none",
    nowSeconds: NOW,
    pool: { accepting: true, commission: 500, delegated: 0n, pool: POOL },
    token: TOKEN,
    ...overrides,
  });

describe("stakingPositionState", () => {
  test("follows the exit window with the injected clock", () => {
    expect(stakingPositionState("none", NOW)).toBe("none");
    expect(stakingPositionState(member(), NOW)).toBe("staked");
    expect(stakingPositionState(member({ amount: 0n }), NOW)).toBe("none");
    expect(stakingPositionState(member({ unpoolTime: NOW + 1 }), NOW)).toBe("exit-pending");
    expect(stakingPositionState(member({ unpoolTime: NOW }), NOW)).toBe("withdrawable");
  });
});

describe("buildStakingCalls", () => {
  test("a first stake is an exact approval then enter_delegation_pool", () => {
    expect(build({})).toEqual([
      { calldata: [POOL, "0x5", "0x0"], contractAddress: TOKEN, entrypoint: "approve" },
      { calldata: [ACCOUNT, "0x5"], contractAddress: POOL, entrypoint: "enter_delegation_pool" },
    ]);
  });

  test("a member's stake uses add_to_delegation_pool", () => {
    const calls = build({ member: member() });
    expect(Array.isArray(calls) && calls[1]?.entrypoint).toBe("add_to_delegation_pool");
  });

  test("stake refusals", () => {
    expect(build({ amount: 0n })).toEqual({ refusal: "Enter an amount to stake." });
    expect(build({ amount: null })).toEqual({ refusal: "Enter an amount to stake." });
    expect(build({ amount: 1n << 128n })).toEqual({ refusal: "Enter an amount to stake." });
    expect(build({ pool: { accepting: false, commission: 0, delegated: 0n, pool: POOL } })).toEqual(
      {
        refusal: "This validator is leaving staking.",
      },
    );
    // The pool accepts more stake while an exit is pending.
    const calls = build({ member: member({ unpoolTime: NOW + 5 }) });
    expect(Array.isArray(calls) && calls[1]?.entrypoint).toBe("add_to_delegation_pool");
  });

  test("claim, unstake, cancel and withdraw", () => {
    expect(build({ action: "claim", member: member({ unclaimedRewards: 3n }) })).toEqual([
      { calldata: [ACCOUNT], contractAddress: POOL, entrypoint: "claim_rewards" },
    ]);
    expect(build({ action: "claim", member: member() })).toEqual({
      refusal: "No rewards to claim.",
    });
    expect(build({ action: "unstake", amount: 10n, member: member() })).toEqual([
      { calldata: ["0xa"], contractAddress: POOL, entrypoint: "exit_delegation_pool_intent" },
    ]);
    expect(build({ action: "unstake", amount: 11n, member: member() })).toEqual({
      refusal: "That's more than you have staked.",
    });
    expect(build({ action: "unstake", amount: 1n, member: "none" })).toEqual({
      refusal: "Nothing staked to unstake.",
    });
    expect(
      build({ action: "unstake", amount: 1n, member: member({ unpoolTime: NOW + 5 }) }),
    ).toEqual({
      refusal: "Withdraw or cancel your unstake first.",
    });
    expect(build({ action: "cancel-unstake", member: member({ unpoolTime: NOW + 5 }) })).toEqual([
      { calldata: ["0x0"], contractAddress: POOL, entrypoint: "exit_delegation_pool_intent" },
    ]);
    expect(build({ action: "cancel-unstake", member: member() })).toEqual({
      refusal: "No unstake to cancel.",
    });
    expect(build({ action: "withdraw", member: member({ unpoolTime: NOW }) })).toEqual([
      { calldata: [ACCOUNT], contractAddress: POOL, entrypoint: "exit_delegation_pool_action" },
    ]);
    expect(build({ action: "withdraw", member: member({ unpoolTime: NOW + 1 }) })).toEqual({
      refusal: "Not withdrawable yet.",
    });
    expect(build({ action: "withdraw", member: member() })).toEqual({
      refusal: "Nothing to withdraw.",
    });
  });
});

describe("stakingActivitySummary", () => {
  test("names the verb the Activity classifier reads", () => {
    const base = { amount: "5", symbol: "STRK", validator: "Val" };
    expect(stakingActivitySummary({ ...base, action: "stake" })).toBe("Stake 5 STRK with Val");
    expect(stakingActivitySummary({ ...base, action: "claim", amount: null })).toBe(
      "Claim staking rewards from Val",
    );
    expect(stakingActivitySummary({ ...base, action: "unstake" })).toBe("Unstake 5 STRK from Val");
    expect(stakingActivitySummary({ ...base, action: "cancel-unstake", amount: null })).toBe(
      "Keep STRK staked with Val",
    );
    expect(stakingActivitySummary({ ...base, action: "withdraw", amount: null })).toBe(
      "Withdraw unstaked STRK from Val",
    );
  });
});

describe("staking network table", () => {
  test("ships switched off on every network", () => {
    expect(stakingNetwork("SN_MAIN")).toBeNull();
    expect(stakingNetwork("SN_SEPOLIA")).toBeNull();
    expect(stakingNetwork("SN_DEVNET")).toBeNull();
    expect(STAKING_NETWORKS.SN_MAIN?.stakingContract).toBe(
      "0x00ca1702e64c81d9a07b86bd2c540188d92a2c73cf5cc0e508d949015e7e84a7",
    );
  });

  test("no directory route is bundled: the key stays in the gateway, which does not exist yet", () => {
    expect(STAKING_DIRECTORY_URLS).toEqual({ SN_DEVNET: null, SN_MAIN: null, SN_SEPOLIA: null });
  });

  test("a switched-on network needs no validator list", () => {
    const network = { enabled: true, stakingContract: "0x1" };
    expect(stakingNetwork("SN_MAIN", { SN_DEVNET: null, SN_MAIN: network, SN_SEPOLIA: null })).toBe(
      network,
    );
    expect(
      stakingNetwork("SN_MAIN", {
        SN_DEVNET: null,
        SN_MAIN: { ...network, enabled: false },
        SN_SEPOLIA: null,
      }),
    ).toBeNull();
  });

  test("a staker address is a canonical non-zero felt or nothing", () => {
    expect(stakerAddress("0x0abc")).toBe("0xabc");
    for (const bad of ["0x0", "0xABC", "abc", "0x", 12, null, `0x${"f".repeat(64)}`]) {
      expect(stakerAddress(bad)).toBeNull();
    }
  });
});
