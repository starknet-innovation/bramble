/**
 * The staking chain reads (wallet-core P13 `staking::{decode, read, view}`): the decoders over
 * raw replies, `verifyStakingPool`'s verdicts, and `wallet.stakingOverview` over a recording node
 * through the real `readAtPinnedBlock` (see `./index.ts`).
 */
import {
  decodeActiveTokens,
  decodeExitWindow,
  decodePoolMember,
  decodePoolParameters,
  decodeStakerPoolInfo,
  decodeStakerStatus,
  verifyStakingPool,
} from "@bramble/transactions/staking-decode";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { STAKER } from "../../tests/support/staking-chain";
import {
  ACCOUNT,
  background,
  chainWith,
  member,
  NOW_SECONDS,
  plain,
  type Setup,
  STAKING_CONTRACT,
} from "./shared";

const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const POOL = "0x5a3";
const U128_MAX = `0x${"f".repeat(32)}`;
const U128_LIMIT = `0x1${"0".repeat(32)}`;
const PRIME = `0x800000000000011${"0".repeat(47)}1`;

const DECODERS = {
  activeTokens: decodeActiveTokens,
  exitWindow: decodeExitWindow,
  poolMember: decodePoolMember,
  poolParameters: decodePoolParameters,
  stakerPoolInfo: decodeStakerPoolInfo,
  stakerStatus: decodeStakerStatus,
} as const;

const DECODE_CASES: readonly (readonly [string, keyof typeof DECODERS, readonly string[]])[] = [
  [
    "poolInfo.someCommission",
    "stakerPoolInfo",
    ["0x0", "0x3e8", "0x1", POOL, STRK_TOKEN_ADDRESS, "0x64"],
  ],
  [
    "poolInfo.noCommission",
    "stakerPoolInfo",
    ["0x1", "0x2", POOL, STRK_TOKEN_ADDRESS, "0x1", "0x5a4", ETH, "0x0"],
  ],
  ["poolInfo.noPools", "stakerPoolInfo", ["0x1", "0x0"]],
  ["poolInfo.commissionOverU16", "stakerPoolInfo", ["0x0", "0x10000", "0x0"]],
  ["poolInfo.unknownVariant", "stakerPoolInfo", ["0x2", "0x0"]],
  ["poolInfo.shortSpan", "stakerPoolInfo", ["0x1", "0x1", POOL, STRK_TOKEN_ADDRESS]],
  ["poolInfo.longSpan", "stakerPoolInfo", ["0x1", "0x0", "0x1"]],
  ["poolInfo.zeroPool", "stakerPoolInfo", ["0x1", "0x1", "0x0", STRK_TOKEN_ADDRESS, "0x1"]],
  [
    "poolInfo.amountOverU128",
    "stakerPoolInfo",
    ["0x1", "0x1", POOL, STRK_TOKEN_ADDRESS, U128_LIMIT],
  ],
  ["poolInfo.countOver64", "stakerPoolInfo", ["0x1", "0x40"]],
  ["poolInfo.notAFelt", "stakerPoolInfo", ["0x1", "0x1", POOL, "0xSTRK", "0x1"]],
  ["status.active", "stakerStatus", ["0x0", STAKER, STAKER, "0x1", "0x0", "0x0", "0x1"]],
  ["status.leaving", "stakerStatus", ["0x0", STAKER, STAKER, "0x0", "0x77359400"]],
  ["status.unknown", "stakerStatus", ["0x1"]],
  ["status.unknownWithTail", "stakerStatus", ["0x1", "0x0"]],
  ["status.zeroReward", "stakerStatus", ["0x0", "0x0", STAKER, "0x1"]],
  ["status.badUnstakeVariant", "stakerStatus", ["0x0", STAKER, STAKER, "0x2"]],
  ["status.unstakeOverU64", "stakerStatus", ["0x0", STAKER, STAKER, "0x0", `0x1${"0".repeat(16)}`]],
  [
    "parameters.valid",
    "poolParameters",
    [STAKER, "0x0", STAKING_CONTRACT, STRK_TOKEN_ADDRESS, "0x3e8"],
  ],
  [
    "parameters.removed",
    "poolParameters",
    [STAKER, "0x1", STAKING_CONTRACT, STRK_TOKEN_ADDRESS, "0x0"],
  ],
  [
    "parameters.removedNotBool",
    "poolParameters",
    [STAKER, "0x2", STAKING_CONTRACT, STRK_TOKEN_ADDRESS, "0x0"],
  ],
  ["parameters.short", "poolParameters", [STAKER, "0x0", STAKING_CONTRACT, STRK_TOKEN_ADDRESS]],
  ["parameters.zeroToken", "poolParameters", [STAKER, "0x0", STAKING_CONTRACT, "0x0", "0x0"]],
  ["member.none", "poolMember", ["0x1"]],
  ["member.noneWithTail", "poolMember", ["0x1", "0x0"]],
  [
    "member.staked",
    "poolMember",
    ["0x0", ACCOUNT, "0x4563918244f40000", "0x3782dace9d90000", "0x3e8", "0x0", "0x1"],
  ],
  [
    "member.exiting",
    "poolMember",
    ["0x0", ACCOUNT, "0x0", "0x0", "0x3e8", "0x5", "0x0", "0x6b49d200"],
  ],
  [
    "member.maxAmounts",
    "poolMember",
    ["0x0", ACCOUNT, U128_MAX, U128_MAX, "0xffff", U128_MAX, "0x1"],
  ],
  ["member.amountOverU128", "poolMember", ["0x0", ACCOUNT, U128_LIMIT, "0x0", "0x0", "0x0", "0x1"]],
  [
    "member.noneTimeWithTail",
    "poolMember",
    ["0x0", ACCOUNT, "0x1", "0x0", "0x0", "0x0", "0x1", "0x0"],
  ],
  ["member.someTimeShort", "poolMember", ["0x0", ACCOUNT, "0x1", "0x0", "0x0", "0x0", "0x0"]],
  ["member.badVariant", "poolMember", ["0x2"]],
  ["member.zeroReward", "poolMember", ["0x0", "0x0", "0x1", "0x0", "0x0", "0x0", "0x1"]],
  ["activeTokens.two", "activeTokens", ["0x2", STRK_TOKEN_ADDRESS, ETH]],
  ["activeTokens.none", "activeTokens", ["0x0"]],
  ["activeTokens.countMismatch", "activeTokens", ["0x2", STRK_TOKEN_ADDRESS]],
  ["activeTokens.zero", "activeTokens", ["0x1", "0x0"]],
  ["activeTokens.prime", "activeTokens", ["0x1", PRIME]],
  ["exitWindow.week", "exitWindow", ["0x1", STRK_TOKEN_ADDRESS, "0x7", "0x8", "0x9", "0x93a80"]],
  ["exitWindow.short", "exitWindow", ["0x1", STRK_TOKEN_ADDRESS, "0x7", "0x8", "0x93a80"]],
  [
    "exitWindow.overU64",
    "exitWindow",
    ["0x1", STRK_TOKEN_ADDRESS, "0x7", "0x8", "0x9", `0x1${"0".repeat(16)}`],
  ],
];

/** Each decoder over raw replies: the decoded value, `"none"` or null as the extension gives it. */
export const computeDecodes = () =>
  DECODE_CASES.map(([name, decoder, values]) => ({
    decoder,
    name,
    result: plain(DECODERS[decoder](values)) ?? null,
    values,
  }));

const POOL_INFO = ["0x0", "0x1f4", "0x1", POOL, STRK_TOKEN_ADDRESS, "0x3635c9adc5dea00000"];
const ACTIVE = ["0x0", STAKER, STAKER, "0x1", "0x0", "0x0", "0x1"];
const LEAVING = ["0x0", STAKER, STAKER, "0x0", "0x77359400"];
const PARAMETERS = [STAKER, "0x0", STAKING_CONTRACT, STRK_TOKEN_ADDRESS, "0x3e8"];

type RawReads = {
  readonly parameters: readonly string[] | null;
  readonly poolInfo: readonly string[];
  readonly status: readonly string[];
};

const VERIFY_CASES: readonly (readonly [string, RawReads, string?])[] = [
  ["accepted", { parameters: PARAMETERS, poolInfo: POOL_INFO, status: ACTIVE }],
  ["accepted.leaving", { parameters: PARAMETERS, poolInfo: POOL_INFO, status: LEAVING }],
  [
    "accepted.removed",
    {
      parameters: [STAKER, "0x1", STAKING_CONTRACT, STRK_TOKEN_ADDRESS, "0x3e8"],
      poolInfo: POOL_INFO,
      status: ACTIVE,
    },
  ],
  [
    "accepted.poolCommission",
    {
      parameters: PARAMETERS,
      poolInfo: ["0x1", "0x1", POOL, STRK_TOKEN_ADDRESS, "0x0"],
      status: ACTIVE,
    },
  ],
  ["refused.unknownStaker", { parameters: PARAMETERS, poolInfo: ["0x1", "0x0"], status: ["0x1"] }],
  ["refused.malformedInfo", { parameters: PARAMETERS, poolInfo: ["0x5"], status: ACTIVE }],
  ["refused.malformedStatus", { parameters: PARAMETERS, poolInfo: POOL_INFO, status: ["0x7"] }],
  ["refused.noPoolForToken", { parameters: PARAMETERS, poolInfo: POOL_INFO, status: ACTIVE }, ETH],
  ["refused.noParameters", { parameters: null, poolInfo: POOL_INFO, status: ACTIVE }],
  [
    "refused.otherStaker",
    {
      parameters: ["0x999", "0x0", STAKING_CONTRACT, STRK_TOKEN_ADDRESS, "0x3e8"],
      poolInfo: POOL_INFO,
      status: ACTIVE,
    },
  ],
  [
    "refused.otherContract",
    {
      parameters: [STAKER, "0x0", "0x5a9", STRK_TOKEN_ADDRESS, "0x3e8"],
      poolInfo: POOL_INFO,
      status: ACTIVE,
    },
  ],
  [
    "refused.otherToken",
    {
      parameters: [STAKER, "0x0", STAKING_CONTRACT, ETH, "0x3e8"],
      poolInfo: POOL_INFO,
      status: ACTIVE,
    },
  ],
];

/** `verifyStakingPool` over decoded raw reads for STAKER, the test contract and a token. */
export const computeVerdicts = () =>
  VERIFY_CASES.map(([name, reads, token = STRK_TOKEN_ADDRESS]) => {
    const expected = { staker: STAKER, stakingContract: STAKING_CONTRACT, token };
    const verdict = verifyStakingPool(
      {
        parameters: reads.parameters ? decodePoolParameters(reads.parameters) : null,
        poolInfo: decodeStakerPoolInfo(reads.poolInfo),
        status: decodeStakerStatus(reads.status),
      },
      expected,
    );
    return { expected, name, reads, verdict: plain(verdict) };
  });

const OVERVIEW_CASES: readonly (readonly [string, Setup & { readonly staker?: string }])[] = [
  ["notMember", {}],
  [
    "staked",
    {
      chain: chainWith({ member: member({ unclaimed: 25n * 10n ** 16n }) }),
    },
  ],
  [
    "rewardsElsewhere",
    {
      chain: chainWith({ member: member({ rewardAddress: "0x0777", unclaimed: 1n }) }),
    },
  ],
  [
    "exitPending",
    {
      chain: chainWith({
        member: member({
          amount: 0n,
          unpoolAmount: 3n * 10n ** 18n,
          unpoolTime: NOW_SECONDS + 60,
        }),
      }),
    },
  ],
  [
    "withdrawable",
    {
      chain: chainWith({
        member: member({
          amount: 2n * 10n ** 18n,
          unpoolAmount: 3n * 10n ** 18n,
          unpoolTime: NOW_SECONDS,
        }),
      }),
    },
  ],
  [
    "leaving",
    {
      chain: chainWith({ stakerLeaving: true, commission: 1234, member: member() }),
    },
  ],
  [
    "poolOtherStaker",
    {
      chain: chainWith({ poolStaker: "0x999" }),
    },
  ],
  ["unknownStaker", { staker: "0x5a2" }],
  [
    "secondTokenNoPool",
    {
      chain: chainWith({ activeTokens: [ETH, STRK_TOKEN_ADDRESS] }),
    },
  ],
  [
    "noActiveToken",
    {
      chain: chainWith({ activeTokens: [] }),
    },
  ],
  [
    "rewardsNotStrk",
    {
      chain: chainWith({ rewardToken: ETH }),
    },
  ],
  ["stalePinOnce", { quirks: { staleCalls: 1 } }],
  ["stalePinAlways", { quirks: { staleCalls: 99 } }],
  ["networkOff", { enabled: false }],
];

/** `wallet.stakingOverview` for one staker: the node's traffic and the answer. */
export const computeOverviews = async () => {
  const out: object[] = [];
  for (const [name, setup] of OVERVIEW_CASES) {
    const run = await background(setup);
    const staker = setup.staker ?? STAKER;
    const response = await run.send({ staker, type: "wallet.stakingOverview" });
    out.push({
      enabled: setup.enabled !== false,
      name,
      now: NOW_SECONDS,
      response: plain(response),
      rpc: run.rpc,
      staker,
    });
  }
  return out;
};
