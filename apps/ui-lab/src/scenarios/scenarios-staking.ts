/**
 * Staking screen checkpoints (issue 750): a new position, a staked position
 * with rewards and an exit pending, a validator that is leaving, one that
 * could not be verified, and the two-tap review. The bindings run against a
 * fixture client, so no checkpoint reaches a network.
 */
import { bindStaking, type StakingState } from "@bramble/wallet-ui/lab";
import { walletDashboard } from "../runtime/scenario-dashboard";
import type { FrameContext, ScenarioCheckpoint } from "../runtime/types";

const ROW = {
  accepting: true,
  commission: "10%",
  delegated: "7,438,192.55",
  staked: "0",
  state: "none" as const,
  symbol: "STRK",
  tokenId: "SN_MAIN:STRK",
  unclaimed: "0",
  unpoolAmount: "0",
  validatorId: "fixture-validator",
  validatorName: "Fixture Validator",
};

const staking: StakingState = {
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
      ...ROW,
      accepting: false,
      staked: "40",
      state: "staked",
      validatorId: "leaving",
      validatorName: "Leaving Validator",
    },
    {
      refusal: "Couldn't verify this validator on chain.",
      symbol: "STRK",
      tokenId: "SN_MAIN:STRK",
      validatorId: "unverified",
      validatorName: "Unverified Validator",
    },
  ],
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const review = async ({ app }: FrameContext): Promise<void> => {
  bindStaking({
    app,
    render: async () => undefined,
    wallet: {
      executeStaking: async () => "0x5ab",
      prepareStaking: async () => ({
        id: `sha256:${"a".repeat(64)}`,
        review:
          "Stake 500 STRK with Fixture Validator. This approves exactly 500 STRK for its pool.",
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
    content: () => walletDashboard({ staking, view: "staking" }),
    id: "staking",
    label: "Staking",
    narrative:
      "Each curated validator and token, the account's position read on chain, and only the actions that position allows.",
    state: { exitWindow: "7 days", validators: 3 },
  },
  {
    content: () => walletDashboard({ staking, view: "staking" }),
    id: "staking-review",
    label: "Staking review",
    narrative:
      "The first tap shows exactly what will be signed and the maximum fee; the second confirms.",
    prepare: review,
    state: { amount: "500 STRK", step: "review" },
  },
];
