/**
 * Staking screen checkpoints (issue 750): Mainnet when Starkscan can't be
 * read (the paste field, with one short line each and no error page), the
 * validator list from Starkscan with "Your stakes" and the paste field, both
 * while Starkscan reports them incomplete, one
 * validator opened (a new position, a staked position with rewards and an exit
 * pending, and a pool that could not be verified), and the two-tap review. The
 * directory entries and positions are schema-derived fixtures, not a live
 * capture; positions show only chain-read figures. The
 * bindings run against fixture clients, so no checkpoint reaches a network.
 */
import { bindStaking, bindStakingDirectory, type StakingState } from "@bramble/wallet-ui/lab";
import { statusFor } from "../fixtures/fixtures";
import { journeyBalances, journeyPreferences, STRK_TOKEN } from "../fixtures/journey-fixtures";
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
  tokenId: STRK_TOKEN.id,
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

const SECOND_STAKER = "0x71b2e4c6a8d0f2b4c6e8a0d2f4b6c8e0a2c4e6f8b0d2f4a6c8e0b2d4f6a8c0e";

const pasteOnly: StakingState = {
  directory: {
    unavailable: "Couldn't load the validator list. Paste a validator address instead.",
  },
  positions: { unavailable: "Couldn't load your stakes." },
  selected: null,
  sort: "stake",
  validator: { loading: true },
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
        staker: SECOND_STAKER,
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
  positions: {
    complete: true,
    rows: [
      { ...ROW, staked: "1250", state: "staked", unclaimed: "18.4421" },
      {
        ...ROW,
        staked: "0",
        staker: SECOND_STAKER,
        state: "exit-pending",
        symbol: "WBTC",
        tokenId: "SN_MAIN:WBTC",
        unpoolAmount: "0.5",
        unpoolTime: 1_800_000_000,
      },
    ],
  },
  selected: null,
  sort: "stake",
  validator: { loading: true },
};

const homeStakes: StakingState = { ...list, homeTab: "staking" };
const homeEmpty: StakingState = {
  ...list,
  homeTab: "staking",
  positions: { complete: true, rows: [] },
};
const homeUnavailable: StakingState = {
  ...list,
  homeTab: "staking",
  positions: { unavailable: "Couldn't load your stakes." },
};
const homeDashboard = (staking: StakingState): string =>
  walletDashboard({
    balanceState: { balances: journeyBalances },
    preferences: journeyPreferences,
    staking,
    view: "home",
  });

const incomplete: StakingState = {
  ...list,
  directory: { incomplete: true },
  positions: { complete: false, rows: [{ ...ROW, staked: "1250", state: "staked" }] },
};

const opened: StakingState = {
  ...list,
  selected: { name: "Fixture Validator", staker: STAKER },
  validator: {
    exitWindowSeconds: 604_800,
    rows: [
      {
        ...ROW,
        staked: "1250",
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
    content: () => homeDashboard(homeStakes),
    id: "staking-home",
    label: "Home Staking tab",
    narrative:
      'Home\'s Staking tab beside Tokens (Mainnet only): Stake first, then each confirmed position as one button that opens its validator. Under the total, "Staked" sums the confirmed stake and opens this tab; it never joins the total.',
    state: { positions: 2, tab: "staking" },
  },
  {
    content: () => homeDashboard(list),
    id: "staking-home-staked",
    label: "Home Staked line",
    narrative:
      'On the Tokens tab, the "Staked" line under the total sums confirmed stake per token and opens the Staking tab; the total itself is unchanged.',
    state: { line: "Staked", tab: "tokens" },
  },
  {
    content: () => homeDashboard(homeEmpty),
    id: "staking-home-empty",
    label: "Home Staking, no stakes",
    narrative:
      'A complete lookup with no confirmed stake: the empty line and Stake. No "Staked" line.',
    state: { positions: 0, tab: "staking" },
  },
  {
    content: () => homeDashboard(homeUnavailable),
    id: "staking-home-unavailable",
    label: "Home Staking, couldn't load",
    narrative:
      '"Your stakes" couldn\'t be read: one line, never "no stakes", and Stake still works.',
    state: { positions: "unavailable", tab: "staking" },
  },
  {
    content: () => walletDashboard({ preferences: journeyPreferences, view: "settings" }),
    id: "staking-settings-row",
    label: "Staking in Settings",
    narrative:
      "Staking sits under This account, shown only on a network where staking is on (Mainnet).",
    state: { network: "SN_MAIN", section: "This account" },
  },
  {
    content: () =>
      walletDashboard({
        balanceState: { balances: journeyBalances },
        chart: [0.41, 0.42, 0.4, 0.43, 0.44, 0.43, 0.45],
        preferences: journeyPreferences,
        selectedTokenId: STRK_TOKEN.id,
        view: "token-detail",
      }),
    id: "staking-token-stake",
    label: "Stake from a token",
    narrative:
      "STRK's screen offers Stake below Send and Swap on Mainnet; it opens the staking list. Tokens staking doesn't take never show it.",
    state: { action: "Stake", symbol: "STRK" },
  },
  {
    content: () => walletDashboard({ staking: pasteOnly, view: "staking" }),
    id: "staking-paste-only",
    label: "Staking, Starkscan unavailable",
    narrative:
      'Starkscan can\'t be read: "Your stakes" says it couldn\'t load, the list says to paste an address, and the paste field works. Never an error page or "no stakes".',
    prepare: bindList,
    state: { directory: "unavailable", positions: "unavailable" },
  },
  {
    content: () => walletDashboard({ staking: list, view: "staking" }),
    id: "staking",
    label: "Staking",
    narrative:
      '"Your stakes" first: each position Starkscan listed and the chain confirmed, with chain-read figures, as one button. Then validators from Starkscan\'s directory (schema-derived fixtures), each card one button, with their addresses, commission, 30-day uptime and delegated totals; unknown figures say unknown. The paste field sits below the list as the fallback.',
    prepare: bindList,
    state: { directory: "ready", positions: 2, validators: 3 },
  },
  {
    content: () => walletDashboard({ staking: incomplete, view: "staking" }),
    id: "staking-incomplete",
    label: "Staking list incomplete",
    narrative:
      'Starkscan reports its snapshots incomplete: no validator is offered, and "Your stakes" shows what the chain confirmed and says some may not be listed, never "none". Pasting still works.',
    state: { directory: "incomplete", positions: "incomplete" },
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
