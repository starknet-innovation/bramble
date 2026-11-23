/**
 * Starkscan's staking answers (wallet-core P13 `staking::{coverage, directory, positions}`): the
 * coverage rule, a validator directory page through `wallet.stakingDirectory`, and an address's
 * positions through `wallet.stakingPositions`, each over the real Starkscan client with a
 * recording transport (see `./index.ts`). Pages are built with the schema-derived fixtures the
 * extension's own tests use.
 */
import { stakingCoverage } from "@bramble/transactions/staking-coverage";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import {
  CATCHING_UP_COVERAGE,
  DIRECTORY_BTC_TOKEN,
  directoryCoverage,
  directoryPage,
  directoryParts,
  directoryValidator,
} from "../../packages/features/transactions/tests/support/staking-directory-fixture";
import {
  position,
  positionsView,
} from "../../packages/features/transactions/tests/support/staking-positions-fixture";
import { STAKER } from "../../tests/support/staking-chain";
import { ACCOUNT, background, chainWith, member, NOW_SECONDS, plain, type Setup } from "./shared";

const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const COVERAGE_CASES: readonly (readonly [string, unknown])[] = [
  ["prepared", directoryCoverage()],
  [
    "preparedFarBehind",
    directoryCoverage({ finalizedOnly: false, gapIntervals: [{}], lagBlocks: 5000 }),
  ],
  ["catchingUp", CATCHING_UP_COVERAGE],
  ["catchingUpAtLimit", { ...CATCHING_UP_COVERAGE, lagBlocks: 100 }],
  ["catchingUpPastLimit", { ...CATCHING_UP_COVERAGE, lagBlocks: 101 }],
  ["catchingUpGap", { ...CATCHING_UP_COVERAGE, gapIntervals: [{ fromBlock: 1 }] }],
  ["catchingUpOutstanding", { ...CATCHING_UP_COVERAGE, outstandingMaterializationIntervals: [{}] }],
  ["catchingUpNotFinalized", { ...CATCHING_UP_COVERAGE, finalizedOnly: false }],
  ["unavailable", directoryCoverage({ status: "unavailable" })],
  ["unknownStatus", directoryCoverage({ status: "done" })],
  ["lagNegative", directoryCoverage({ lagBlocks: -1 })],
  ["lagFraction", directoryCoverage({ lagBlocks: 1.5 })],
  ["lagUnsafe", directoryCoverage({ lagBlocks: 2 ** 53 })],
  ["lagText", directoryCoverage({ lagBlocks: "0" })],
  ["finalizedText", directoryCoverage({ finalizedOnly: "true" })],
  ["gapsNotList", directoryCoverage({ gapIntervals: {} })],
  ["gapsOverBound", directoryCoverage({ gapIntervals: Array.from({ length: 1025 }, () => 0) })],
  [
    "outstandingMissing",
    { ...directoryCoverage(), outstandingMaterializationIntervals: undefined },
  ],
  ["notAnObject", "prepared"],
  ["null", null],
];

/** `stakingCoverage` over each block: "usable", "incomplete" or null (malformed). */
export const computeCoverage = () =>
  COVERAGE_CASES.map(([name, coverage]) => ({
    coverage: plain(coverage) ?? null,
    name,
    result: stakingCoverage(coverage),
  }));

const { pool, ratio, stake } = directoryParts;
const validator = (index: number, overrides: Readonly<Record<string, unknown>> = {}) =>
  directoryValidator(`0x5a2${index.toString(16).padStart(4, "0")}`, overrides);

/** A page exercising every rule `directoryEntries` applies, in Starkscan's order. */
const FULL_PAGE = directoryPage(
  [
    directoryValidator(STAKER),
    validator(1, { status: "inactive" }),
    validator(2, { pools: [pool(STRK_TOKEN_ADDRESS, "0x5a5", "retired")] }),
    validator(3, {
      commission: null,
      liveness30d: null,
      name: null,
      stake: [stake(STRK_TOKEN_ADDRESS, null)],
      status: "active",
      website: null,
    }),
    validator(4, {
      commission: ratio("1", "3"),
      liveness30d: ratio("2", "3"),
      name: "  Padded Name  ",
      website: "http://plain.example",
    }),
    validator(5, { website: "https://user:pw@secret.example/" }),
    validator(6, { pools: [pool(DIRECTORY_BTC_TOKEN, "0x5a6")], stake: [] }),
    validator(7, {
      pools: [pool(ETH, "0x5a7"), pool(STRK_TOKEN_ADDRESS, "0x5a8")],
      stake: [stake(ETH, "1234567890123456789"), stake(STRK_TOKEN_ADDRESS, "7")],
      website: "https://Mixed.Example:8443/x?y#z",
    }),
    validator(8, { name: "", status: null, website: "   " }),
    validator(9, { commission: ratio("0", "1"), liveness30d: ratio("1", "1"), status: "exiting" }),
  ],
  { coverage: CATCHING_UP_COVERAGE, nextCursor: "cursor-2" },
);

const page = (overrides: Readonly<Record<string, unknown>>) =>
  directoryPage([directoryValidator(STAKER)], overrides);
const oneValidator = (overrides: Readonly<Record<string, unknown>>) =>
  directoryPage([directoryValidator(STAKER, overrides)]);

const DIRECTORY_CASES: readonly (readonly [string, Setup, string?])[] = [
  ["ready.full", { starkscan: { body: FULL_PAGE } }],
  ["ready.cursorEchoed", { starkscan: { body: page({}) } }, "abc+def/=~!*'()"],
  ["ready.empty", { starkscan: { body: directoryPage([]) } }],
  [
    "incomplete.unavailable",
    { starkscan: { body: page({ coverage: directoryCoverage({ status: "unavailable" }) }) } },
  ],
  [
    "incomplete.pastLag",
    { starkscan: { body: page({ coverage: { ...CATCHING_UP_COVERAGE, lagBlocks: 101 } }) } },
  ],
  ["refused.otherChain", { starkscan: { body: page({ chainId: "SN_SEPOLIA" }) } }],
  ["refused.otherSource", { starkscan: { body: page({ source: "live" }) } }],
  [
    // The count is refused before any item is read, so the items need not be validators.
    "refused.overPageSize",
    { starkscan: { body: directoryPage(Array.from({ length: 51 }, () => ({}))) } },
  ],
  [
    "refused.duplicateStaker",
    {
      starkscan: {
        body: directoryPage([
          directoryValidator(STAKER),
          directoryValidator(STAKER.toUpperCase().replace("0X", "0x")),
        ]),
      },
    },
  ],
  ["refused.badCursor", { starkscan: { body: page({ nextCursor: "has space" }) } }],
  ["refused.coverageMissing", { starkscan: { body: page({ coverage: null }) } }],
  ["refused.zeroStaker", { starkscan: { body: directoryPage([directoryValidator("0x0")]) } }],
  [
    "refused.longAddress",
    { starkscan: { body: directoryPage([directoryValidator(`0x${"0".repeat(65)}1`)]) } },
  ],
  ["refused.unknownStatus", { starkscan: { body: oneValidator({ status: "jailed" }) } }],
  ["refused.bidiName", { starkscan: { body: oneValidator({ name: "Val‮idator" }) } }],
  ["refused.longName", { starkscan: { body: oneValidator({ name: "n".repeat(65) }) } }],
  ["refused.ratioAboveOne", { starkscan: { body: oneValidator({ commission: ratio("2", "1") }) } }],
  [
    "refused.ratioZeroDenominator",
    { starkscan: { body: oneValidator({ liveness30d: ratio("0", "0") }) } },
  ],
  [
    "refused.ratioExtraKey",
    { starkscan: { body: oneValidator({ commission: { ...ratio("1", "2"), x: 1 } }) } },
  ],
  [
    "refused.poolStatus",
    { starkscan: { body: oneValidator({ pools: [pool(STRK_TOKEN_ADDRESS, "0x5a3", "paused")] }) } },
  ],
  [
    "refused.tooManyPools",
    {
      starkscan: {
        body: oneValidator({
          pools: Array.from({ length: 33 }, () => pool(STRK_TOKEN_ADDRESS, "0x5a3")),
        }),
      },
    },
  ],
  [
    "refused.rawNotDigits",
    { starkscan: { body: oneValidator({ stake: [stake(STRK_TOKEN_ADDRESS, "1e3")] }) } },
  ],
  ["refused.status500", { starkscan: { body: { message: "down" }, status: 500 } }],
  ["refused.notJson", { starkscan: { body: "<html>", raw: true } }],
  ["invalid.cursor", { starkscan: { body: page({}) } }, "has space"],
  ["unavailable.networkOff", { enabled: false, starkscan: { body: page({}) } }],
];

/** `wallet.stakingDirectory`: the request sent, the reply given and the handler's answer. */
export const computeDirectory = async () => {
  const out: object[] = [];
  for (const [name, setup, cursor] of DIRECTORY_CASES) {
    const run = await background(setup);
    const response = await run.send({
      type: "wallet.stakingDirectory",
      ...(cursor === undefined ? {} : { cursor }),
    });
    out.push({
      cursor: cursor ?? null,
      enabled: setup.enabled !== false,
      name,
      response: plain(response),
      starkscan: run.starkscan,
    });
  }
  return out;
};

const view = (positions: readonly unknown[], overrides: Readonly<Record<string, unknown>> = {}) =>
  positionsView(ACCOUNT, positions, overrides);
const staked = chainWith({ member: member({ unclaimed: 25n * 10n ** 16n }) });
const extras = Array.from({ length: 17 }, (_, i) => `0x5c${i.toString(16).padStart(2, "0")}`);

const POSITIONS_CASES: readonly (readonly [string, Setup])[] = [
  ["ready.staked", { chain: staked, starkscan: { body: view([position(ACCOUNT, STAKER)]) } }],
  ["ready.notAMember", { starkscan: { body: view([position(ACCOUNT, STAKER)]) } }],
  ["ready.empty", { starkscan: { body: view([]) } }],
  [
    "ready.catchingUp",
    {
      chain: staked,
      starkscan: {
        body: view([position(ACCOUNT, STAKER, { pendingExitRaw: "5", status: "exiting" })], {
          coverage: CATCHING_UP_COVERAGE,
        }),
      },
    },
  ],
  [
    "incomplete.truncated",
    {
      chain: staked,
      starkscan: { body: view([position(ACCOUNT, STAKER)], { positionsTruncated: true }) },
    },
  ],
  [
    "incomplete.pastLag",
    {
      chain: staked,
      starkscan: {
        body: view([position(ACCOUNT, STAKER)], {
          coverage: { ...CATCHING_UP_COVERAGE, lagBlocks: 101 },
        }),
      },
    },
  ],
  [
    "incomplete.unverified",
    {
      chain: staked,
      starkscan: { body: view([position(ACCOUNT, STAKER), position(ACCOUNT, "0x5a2")]) },
    },
  ],
  [
    "incomplete.untrackedToken",
    {
      chain: staked,
      starkscan: { body: view([position(ACCOUNT, STAKER, { tokenAddress: DIRECTORY_BTC_TOKEN })]) },
    },
  ],
  [
    "incomplete.inactiveToken",
    {
      chain: chainWith({ member: member() }),
      starkscan: { body: view([position(ACCOUNT, STAKER, { tokenAddress: ETH })]) },
    },
  ],
  [
    "incomplete.overCheckLimit",
    {
      chain: chainWith({ member: member(), extraStakers: extras }),
      starkscan: { body: view(extras.map((staker) => position(ACCOUNT, staker))) },
    },
  ],
  ["refused.otherAddress", { starkscan: { body: positionsView("0x1", []) } }],
  ["refused.otherChain", { starkscan: { body: view([], { chainId: "SN_SEPOLIA" }) } }],
  ["refused.positionOtherAddress", { starkscan: { body: view([position("0x1", STAKER)]) } }],
  [
    "refused.duplicate",
    { starkscan: { body: view([position(ACCOUNT, STAKER), position(ACCOUNT, STAKER)]) } },
  ],
  [
    "refused.delegatedNull",
    { starkscan: { body: view([position(ACCOUNT, STAKER, { delegatedRaw: null })]) } },
  ],
  [
    "refused.status",
    { starkscan: { body: view([position(ACCOUNT, STAKER, { status: "exited" })]) } },
  ],
  [
    "refused.truncatedMissing",
    { starkscan: { body: { ...view([]), positionsTruncated: undefined } } },
  ],
  ["refused.status503", { starkscan: { body: { message: "busy" }, status: 503 } }],
  [
    "refused.chainUnreadable",
    {
      chain: chainWith({ rewardToken: ETH }),
      starkscan: { body: view([position(ACCOUNT, STAKER)]) },
    },
  ],
  ["off.explorerDisabled", { explorerFallback: false, starkscan: { body: view([]) } }],
  ["unavailable.networkOff", { enabled: false, starkscan: { body: view([]) } }],
];

/** `wallet.stakingPositions`: Starkscan's exchange, the node's traffic and the answer. */
export const computePositions = async () => {
  const out: object[] = [];
  for (const [name, setup] of POSITIONS_CASES) {
    const run = await background(setup);
    const response = await run.send({ type: "wallet.stakingPositions" });
    out.push({
      enabled: setup.enabled !== false,
      explorerFallback: setup.explorerFallback !== false,
      name,
      now: NOW_SECONDS,
      response: plain(response),
      rpc: run.rpc,
      starkscan: run.starkscan,
    });
  }
  return out;
};
