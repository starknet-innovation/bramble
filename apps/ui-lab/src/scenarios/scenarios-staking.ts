/**
 * Staking screen checkpoints (issue 750): the validator list from Starkscan
 * with the paste field, the list while Starkscan reports it incomplete, one
 * validator opened (a new position, a staked position with rewards and an exit
 * pending, and a pool that could not be verified), and the two-tap review. The
 * directory entries are schema-derived fixtures, not a live capture. The
 * bindings run against fixture clients, so no checkpoint reaches a network.
 */
import { bindStaking, bindStakingDirectory, type StakingState } from "@bramble/wallet-ui/lab";
import { statusFor } from "../fixtures/fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import type { FrameContext, ScenarioCheckpoint } from "../runtime/types";

const STAKER = "0x3a5c1f0e9b2d47a8c6e1f3b5d7a9c2e4f6b8d0a1c3e5f7a9b2c4d6e8f0a1b3c";

const ROW = {
  accepting: true,
  commission: "10%",
  delegated: "7,438,192.55",
  staked: "0",
  staker: STAKER,
  state: "none" as const,
  symbol: "STRK",
  tokenId: "SN_MAIN:STRK",
  unclaimed: "0",
  unpoolAmount: "0",
};

const ENTRY = {
  commission: "10%",
  commissionPpm: 100_000,
  name: "Fixture Validator",
  pools: [{ delegated: "7,438,192.55", symbol: "STRK" }],
  staker: STAKER,
  uptime: "99.82%",
  uptimePpm: 998_200,
  website: "validator.example",
};

const list: StakingState = {
  directory: {
    entries: [
      ENTRY,
      {
        ...ENTRY,
        commission: "5%",
        commissionPpm: 50_000,
        name: "Second Fixture Validator With A Long Name",
        pools: [
          { delegated: "1,204,551", symbol: "STRK" },
          { delegated: "212.08", symbol: "WBTC" },
        ],
        staker: "0x71b2e4c6a8d0f2b4c6e8a0d2f4b6c8e0a2c4e6f8b0d2f4a6c8e0b2d4f6a8c0e",
        website: null,
      },
      {
        ...ENTRY,
        commission: null,
        commissionPpm: null,
        name: null,
        pools: [{ delegated: null, symbol: "STRK" }],
        staker: "0x2c4e6a8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4",
        uptime: null,
        uptimePpm: null,
        website: null,
      },
    ],
    nextCursor: "fixture-cursor",
  },
  selected: null,
  sort: "stake",
  validator: { loading: true },
};

const incomplete: StakingState = { ...list, directory: { incomplete: true } };

const opened: StakingState = {
  ...list,
  selected: { name: "Fixture Validator", staker: STAKER },
  validator: {
    exitWindowSeconds: 604_800,
    rows: [
      {
        ...ROW,
        staked: "1,250",
        state: "exit-pending",
        unclaimed: "18.4421",
        unpoolAmount: "250",
        unpoolTime: 1_800_000_000,
      },
      { ...ROW, delegated: "212.08", symbol: "WBTC", tokenId: "SN_MAIN:WBTC" },
      {
        refusal: "This validator has no pool for this token.",
        staker: STAKER,
        symbol: "ETH",
        tokenId: "SN_MAIN:ETH",
      },
    ],
  },
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const bindList = ({ app }: FrameContext): Promise<void> => {
  let state = list;
  bindStakingDirectory({
    app,
    render: async () => undefined,
    setState: (next) => {
      state = next;
    },
    state: () => state,
    status: () => statusFor(),
    wallet: { loadStakingDirectory: async () => ({ off: true }) },
  });
  return settle();
};

const review = async ({ app }: FrameContext): Promise<void> => {
  bindStaking({
    app,
    render: async () => undefined,
    wallet: {
      executeStaking: async () => "0x5ab",
      prepareStaking: async () => ({
        id: `sha256:${"a".repeat(64)}`,
        review: `Stake 500 STRK with validator ${STAKER}. This approves exactly 500 STRK for its pool.`,
        reviewedFee: { overallFee: "1840000000000000", unit: "FRI" },
      }),
    },
  });
  const field = app.querySelector<HTMLInputElement>('[data-staking-amount^="stake|"]');
  if (field) field.value = "500";
  app.querySelector<HTMLButtonElement>('[data-staking-action="stake"]')?.click();
  await settle();
};

/** The staking checkpoints, grouped with the settings journey. */
export const stakingCheckpoints: readonly ScenarioCheckpoint[] = [
  {
    content: () => walletDashboard({ staking: list, view: "staking" }),
    id: "staking",
    label: "Staking",
    narrative:
      "Validators from Starkscan's directory (schema-derived fixtures), with their addresses, commission, 30-day uptime and delegated totals; unknown figures say unknown. A pasted address always works.",
    prepare: bindList,
    state: { directory: "ready", validators: 3 },
  },
  {
    content: () => walletDashboard({ staking: incomplete, view: "staking" }),
    id: "staking-incomplete",
    label: "Staking list incomplete",
    narrative:
      "Starkscan reports its snapshot incomplete, so no validator is offered; pasting still works.",
    state: { directory: "incomplete" },
  },
  {
    content: () => walletDashboard({ staking: opened, view: "staking" }),
    id: "staking-validator",
    label: "Staking validator",
    narrative:
      "One validator opened: its full address, and each tracked token's pool and position read on chain, with only the actions that position allows.",
    state: { exitWindow: "7 days", tokens: 3 },
  },
  {
    content: () => walletDashboard({ staking: opened, view: "staking" }),
    id: "staking-review",
    label: "Staking review",
    narrative:
      "The first tap shows exactly what will be signed, naming the full validator address, and the maximum fee; the second confirms.",
    prepare: review,
    state: { amount: "500 STRK", step: "review" },
  },
];
