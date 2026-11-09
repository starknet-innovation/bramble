/**
 * Staking decoders pinned to live Mainnet answers, and the pool verification
 * rule that every staking call depends on.
 */
import { describe, expect, test } from "bun:test";
import {
  decodeActiveTokens,
  decodeExitWindow,
  decodePoolMember,
  decodePoolParameters,
  decodeStakerPoolInfo,
  decodeStakerStatus,
  verifyStakingPool,
} from "../../src/staking/staking-decode";

// Answers read from Starknet Mainnet on 2026-11-04 (staking contract
// 0x00ca1702…84a7, staker 0x36963c7b…9090), kept verbatim so the decoders are
// pinned to the deployed serialization rather than to a hand-written guess.
const STAKER = "0x36963c7b56f08105ffdd7f12560924bdc0cb29ce210417ecbc8bf3c7e4b9090";
const STAKING = "0xca1702e64c81d9a07b86bd2c540188d92a2c73cf5cc0e508d949015e7e84a7";
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const STRK_POOL = "0x362dc7da60bfddc8e3146028dfd94941c6e22403c98b5947104e637543b475d";
const LIVE_STAKER_POOL_INFO = [
  "0x0",
  "0x3e8",
  "0x5",
  STRK_POOL,
  STRK,
  "0x624edf011c0d20f91b6bf4",
  "0x2ea6a4ffce4c5e779451e043a9a24c9c0b0f784d9cc0f393bc1c801e3f8f2e3",
  "0x3fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
  "0x1c0f10e1",
  "0x750b4ecd1eef45cc74db3538277a869ced288f813e2faa00e0a5ae46243bbaa",
  "0x4daa17763b286d1e59b97c283c0b8c949994c361e426a28f743c67bdfe9a32f",
  "0x6cc451630eaf",
  "0x262f5a1240bf2d61ca36c4eb3a57ff4ae0a183046d3dcab35d0880b7d1776dd",
  "0x593e034dda23eea82d2ba9a30960ed42cf4a01502cc2351dc9b9881f9931a68",
  "0x1e78f5074069ea",
  "0x7ce7161e46e796e6034e3ead311d431567654116f3cffacefe37a2e17464a8f",
  "0x36834a40984312f7f7de8d31e3f6305b325389eaeea5b1c0664b2fb936461a4",
  "0x79e",
];
const LIVE_STAKER_INFO = [
  "0x0",
  STAKER,
  "0x54f4784af6820c8feef75e87ede8c5dd53a65f33bcbe6714b5684448650a7db",
  "0x1",
  "0x43c33c1937564800000",
  "0x4ea0a66f000d7c59fcd",
  "0x0",
  STRK_POOL,
  "0x624edf011c0d20f91b6bf4",
  "0x3e8",
];
const LIVE_STAKING_PARAMETERS = [
  "0x43c33c1937564800000",
  STRK,
  "0x10398fe631af9ab2311840432d507bf7ef4b959ae967f1507928f5afe888a99",
  "0x69565cd9bd273116d8829ba461298a04bfe09adb0c4ac470e7bb66bcae84ab5",
  "0x9035556d1ee136e7722ae4e78f92828553a45eed3bc9b2aba90788ec2ca112",
  "0x93a80",
];

describe("staking decoders against live Mainnet answers", () => {
  test("staker_pool_info: commission and one pool per token", () => {
    const info = decodeStakerPoolInfo(LIVE_STAKER_POOL_INFO);
    expect(info?.commission).toBe(1000);
    expect(info?.pools).toHaveLength(5);
    expect(info?.pools[0]).toEqual({
      amount: 0x624edf011c0d20f91b6bf4n,
      pool: STRK_POOL,
      token: STRK,
    });
  });

  test("get_staker_info_v1: an active staker", () => {
    expect(decodeStakerStatus(LIVE_STAKER_INFO)).toBe("active");
  });

  test("get_pool_member_info_v1: a member with a pending exit", () => {
    // Pool 0x362dc7da…475d, member 0x7f278354…6748.
    const live = [
      "0x0",
      "0x7f278354a8ca237b1e1f2276b5c11b8886ed1b8d6a09e12ad019d583f3d6748",
      "0x0",
      "0x21093ea939d0f8",
      "0x3e8",
      "0xde0b6b3a7640000",
      "0x0",
      "0x6af4388e",
    ];
    expect(decodePoolMember(live)).toEqual({
      amount: 0n,
      rewardAddress: "0x7f278354a8ca237b1e1f2276b5c11b8886ed1b8d6a09e12ad019d583f3d6748",
      unclaimedRewards: 0x21093ea939d0f8n,
      unpoolAmount: 10n ** 18n,
      unpoolTime: 0x6af4388e,
    });
  });

  test("contract_parameters_v1: the 7-day exit window", () => {
    expect(decodeExitWindow(LIVE_STAKING_PARAMETERS)).toBe(604_800);
  });
});

describe("staking decoders refuse malformed answers", () => {
  test("a pool span whose length disagrees with its count", () => {
    expect(decodeStakerPoolInfo(LIVE_STAKER_POOL_INFO.slice(0, -1))).toBeNull();
    expect(decodeStakerPoolInfo(["0x2", "0x0"])).toBeNull();
  });

  test("a commission above u16 or a non-felt", () => {
    expect(decodeStakerPoolInfo(["0x0", "0x10000", "0x0"])).toBeNull();
    expect(decodeStakerPoolInfo(["0x0", "1000", "0x0"])).toBeNull();
  });

  test("a staker that is leaving, unknown, or malformed", () => {
    const leaving = [...LIVE_STAKER_INFO];
    leaving.splice(3, 1, "0x0", "0x6a000000");
    expect(decodeStakerStatus(leaving)).toBe("leaving");
    expect(decodeStakerStatus(["0x1"])).toBe("unknown");
    expect(decodeStakerStatus(["0x1", "0x2"])).toBeNull();
    expect(decodeStakerStatus(["0x2"])).toBeNull();
  });

  test("pool membership: none, pending exit, and trailing data", () => {
    expect(decodePoolMember(["0x1"])).toBe("none");
    expect(decodePoolMember(["0x0", "0xa", "0x5", "0x1", "0x3e8", "0x2", "0x0", "0x64"])).toEqual({
      amount: 5n,
      rewardAddress: "0xa",
      unclaimedRewards: 1n,
      unpoolAmount: 2n,
      unpoolTime: 100,
    });
    expect(
      decodePoolMember(["0x0", "0xa", "0x5", "0x1", "0x3e8", "0x2", "0x1", "0x64"]),
    ).toBeNull();
    expect(decodePoolMember(["0x0", "0x0", "0x5", "0x1", "0x3e8", "0x2", "0x1"])).toBeNull();
  });

  test("pool parameters and active tokens", () => {
    expect(decodePoolParameters([STAKER, "0x2", STAKING, STRK, "0x0"])).toBeNull();
    expect(decodePoolParameters([STAKER, "0x0", STAKING, STRK])).toBeNull();
    expect(decodeActiveTokens(["0x1", STRK])).toEqual([STRK]);
    expect(decodeActiveTokens(["0x2", STRK])).toBeNull();
    expect(decodeActiveTokens(["0x1", "0x0"])).toBeNull();
  });
});

describe("verifyStakingPool", () => {
  const poolInfo = decodeStakerPoolInfo(LIVE_STAKER_POOL_INFO);
  const parameters = {
    commission: 1000,
    staker: STAKER,
    stakerRemoved: false,
    stakingContract: STAKING,
    token: STRK,
  };
  const expected = { staker: STAKER, stakingContract: STAKING, token: STRK };

  test("accepts the pool the staking contract lists and the pool itself confirms", () => {
    expect(verifyStakingPool({ parameters, poolInfo, status: "active" }, expected)).toEqual({
      accepting: true,
      commission: 1000,
      delegated: 0x624edf011c0d20f91b6bf4n,
      pool: STRK_POOL,
    });
  });

  test("refuses a pool that names another staker, staking contract, or token", () => {
    for (const changed of [
      { ...parameters, staker: "0x1" },
      { ...parameters, stakingContract: "0x1" },
      { ...parameters, token: "0x1" },
    ]) {
      expect(
        verifyStakingPool({ parameters: changed, poolInfo, status: "active" }, expected),
      ).toEqual({
        refusal: "Couldn't verify this validator on chain.",
      });
    }
  });

  test("refuses a token the staker has no pool for, and an unreadable staker", () => {
    expect(
      verifyStakingPool({ parameters, poolInfo, status: "active" }, { ...expected, token: "0x1" }),
    ).toEqual({
      refusal: "This validator has no pool for this token.",
    });
    expect(verifyStakingPool({ parameters, poolInfo, status: "unknown" }, expected)).toEqual({
      refusal: "Couldn't verify this validator on chain.",
    });
  });

  test("a leaving or removed validator stays verified but takes no new stake", () => {
    expect(verifyStakingPool({ parameters, poolInfo, status: "leaving" }, expected)).toMatchObject({
      accepting: false,
    });
    expect(
      verifyStakingPool(
        { parameters: { ...parameters, stakerRemoved: true }, poolInfo, status: "active" },
        expected,
      ),
    ).toMatchObject({ accepting: false });
  });
});
