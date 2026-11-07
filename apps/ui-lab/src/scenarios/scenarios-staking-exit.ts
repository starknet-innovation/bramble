/**
 * Staking exit checkpoints: unstake, withdraw and claim rewards on one opened
 * validator. Each flow is shown at every state the real screen has: the row
 * before a tap, the fee estimate in progress, the review with its maximum fee,
 * submitting, submitted, a refusal from the background, and a confirm whose
 * outcome is unknown. Two position states sit beside them: an unstake still
 * waiting out its exit window (with its UTC unlock time) and a position with
 * nothing to claim.
 *
 * Every screen is the production staking view with the production bindings,
 * driven by fixture clients: fixed validator, amounts and times, the real
 * review sentence builder, and no network.
 */
import { stakingReviewSentence } from "@bramble/transactions/staking-review";
import { bindStaking, type StakingState } from "@bramble/wallet-ui/lab";
import { SOFTWARE_ADDRESS } from "../fixtures/fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import type { FrameContext, ScenarioCheckpoint } from "../runtime/types";
import { ROW, STAKER } from "./scenarios-staking";

type ExitAction = "claim" | "unstake" | "withdraw";
type Step = "estimating" | "ready" | "refused" | "review" | "submitted" | "submitting" | "unknown";
type Row = Extract<StakingState["validator"], { readonly rows: unknown }>["rows"][number];

// The canonical spelling the background sends: no leading zeros.
const OTHER_REWARDS = "0x5e1d3c7b9a2f4e6d8c0b2a4f6e8d0c2b4a6f8e0d2c4b6a8f0e2d4c6b8a0f2e4";

const stakedRow: Row = { ...ROW, staked: "1250", state: "staked" };
const exitPendingRow: Row = {
  ...ROW,
  staked: "1000",
  state: "exit-pending",
  unpoolAmount: "250",
  // 2027-01-15 08:00 UTC.
  unpoolTime: 1_800_000_000,
};
const withdrawableRow: Row = {
  ...exitPendingRow,
  state: "withdrawable",
  // 2026-09-21 21:46 UTC, already past.
  unpoolTime: 1_790_000_000,
};
const rewardsRow: Row = { ...stakedRow, unclaimed: "18.4421" };
const rewardsElsewhereRow: Row = { ...rewardsRow, rewardsTo: OTHER_REWARDS };

const opened = (row: Row): StakingState => ({
  directory: { entries: [], nextCursor: null },
  positions: { complete: true, rows: [row] },
  selected: { name: "Fixture Validator", staker: STAKER },
  sort: "stake",
  validator: { exitWindowSeconds: 604_800, rows: [row] },
});

const review = (action: ExitAction, amount: string | null, rewardAddress = SOFTWARE_ADDRESS) =>
  stakingReviewSentence({
    account: SOFTWARE_ADDRESS,
    action,
    amount,
    member: {
      amount: 1_250n,
      rewardAddress,
      unclaimedRewards: 0n,
      unpoolAmount: 0n,
      unpoolTime: null,
    },
    symbol: "STRK",
    validator: `validator ${STAKER}`,
  });

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
// A request that never answers, so the screen holds its in-progress state.
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

type Flow = {
  readonly action: ExitAction;
  readonly amount: string | null;
  readonly refusal: string;
  readonly review: string;
};

const drive =
  (flow: Flow, step: Step) =>
  async ({ app }: FrameContext): Promise<void> => {
    bindStaking({
      app,
      render: async () => undefined,
      wallet: {
        executeStaking: () =>
          step === "submitting"
            ? never()
            : step === "unknown"
              ? // The client's fallback for a reply it cannot read: the
                // transaction may have been sent.
                Promise.reject(new Error("staking action failed"))
              : Promise.resolve(`0x${"5ab".repeat(4)}`),
        prepareStaking: () =>
          step === "estimating"
            ? never()
            : step === "refused"
              ? Promise.reject(new Error(flow.refusal))
              : Promise.resolve({
                  id: `sha256:${"b".repeat(64)}`,
                  review: flow.review,
                  reviewedFee: { overallFee: "1840000000000000", unit: "FRI" },
                }),
      },
    });
    const field = app.querySelector<HTMLInputElement>(`[data-staking-amount^="${flow.action}|"]`);
    if (field && flow.amount) field.value = flow.amount;
    if (step === "ready") return settle();
    const control = app.querySelector<HTMLButtonElement>(`[data-staking-action="${flow.action}"]`);
    control?.click();
    await settle();
    if (step === "submitting" || step === "submitted" || step === "unknown") {
      control?.click();
      await settle();
    }
  };

type StepCopy = { readonly label: string; readonly narrative: string };

const steps = (
  flow: Flow,
  row: Row,
  name: string,
  copy: Readonly<Record<Step, StepCopy>>,
): ScenarioCheckpoint[] =>
  (Object.keys(copy) as Step[]).map((step) => ({
    content: () => walletDashboard({ staking: opened(row), view: "staking" }),
    id: `staking-${name}-${step}`,
    label: copy[step].label,
    narrative: copy[step].narrative,
    prepare: drive(flow, step),
    state: { action: flow.action, step, ...(flow.amount ? { amount: `${flow.amount} STRK` } : {}) },
  }));

const unstake: Flow = {
  action: "unstake",
  amount: "250",
  refusal: "That's more than you have staked.",
  review: review("unstake", "250"),
};
const withdraw: Flow = {
  action: "withdraw",
  amount: null,
  refusal: "Not withdrawable yet.",
  review: review("withdraw", null),
};
const claim: Flow = {
  action: "claim",
  amount: null,
  refusal: "No rewards to claim.",
  review: review("claim", null),
};
const claimElsewhere: Flow = { ...claim, review: review("claim", null, OTHER_REWARDS) };

const shared = (
  verb: string,
): Pick<Record<Step, StepCopy>, "submitted" | "submitting" | "unknown"> => ({
  submitting: {
    label: `${verb}, submitting`,
    narrative:
      "The second tap sends the reviewed transaction. The button stays down while it goes.",
  },
  submitted: {
    label: `${verb}, submitted`,
    narrative:
      "Sent: a success toast, and the line under the row points to Activity. The position updates once the chain is read again.",
  },
  unknown: {
    label: `${verb}, outcome unknown`,
    narrative:
      "The reply was lost after sending, so the wallet can't say whether it went through. Amber, not red, and the button stays down so it can't be sent twice.",
  },
});

/** The unstake, withdraw and claim checkpoints, grouped with staking. */
export const stakingExitCheckpoints: readonly ScenarioCheckpoint[] = [
  ...steps(unstake, stakedRow, "unstake", {
    ready: {
      label: "Unstake, amount",
      narrative:
        "A staked position: the amount to unstake and its button. The line above says unstaking takes 7 days with no rewards while it waits.",
    },
    estimating: {
      label: "Unstake, estimating fee",
      narrative: "The first tap asks the wallet to build and check the transaction and price it.",
    },
    review: {
      label: "Unstake, review",
      narrative:
        "What will be signed, naming the full validator address, and the maximum fee. The button now confirms at that fee.",
    },
    refused: {
      label: "Unstake, refused",
      narrative:
        "The wallet refused before anything was signed (here, more than is staked). The field is editable again.",
    },
    ...shared("Unstake"),
  }),
  {
    content: () => walletDashboard({ staking: opened(exitPendingRow), view: "staking" }),
    id: "staking-exit-pending",
    label: "Unstake waiting",
    narrative:
      "After an unstake, before the exit window ends: the amount waiting and the UTC time it can be withdrawn. No Withdraw yet; Cancel unstake is offered.",
    state: { state: "exit-pending", unlock: "2027-01-15 08:00 UTC" },
  },
  ...steps(withdraw, withdrawableRow, "withdraw", {
    ready: {
      label: "Withdraw, ready",
      narrative:
        "The exit window has passed: the amount ready to withdraw, with Withdraw and Cancel unstake.",
    },
    estimating: {
      label: "Withdraw, estimating fee",
      narrative: "The first tap builds, checks and prices the withdrawal.",
    },
    review: {
      label: "Withdraw, review",
      narrative: "What will be signed and the maximum fee; the second tap confirms.",
    },
    refused: {
      label: "Withdraw, refused",
      narrative:
        "The chain says it can't be withdrawn yet (read again when the review was built), so nothing was signed.",
    },
    ...shared("Withdraw"),
  }),
  ...steps(claim, rewardsRow, "claim", {
    ready: {
      label: "Claim rewards, ready",
      narrative: "A position with rewards: the reward amount in STRK and Claim rewards.",
    },
    estimating: {
      label: "Claim rewards, estimating fee",
      narrative: "The first tap builds, checks and prices the claim.",
    },
    review: {
      label: "Claim rewards, review",
      narrative: "What will be signed and the maximum fee; the second tap confirms.",
    },
    refused: {
      label: "Claim rewards, refused",
      narrative: "The chain shows no rewards left to claim, so nothing was signed.",
    },
    ...shared("Claim rewards"),
  }),
  {
    content: () => walletDashboard({ staking: opened(rewardsElsewhereRow), view: "staking" }),
    id: "staking-claim-elsewhere",
    label: "Claim rewards, paid elsewhere",
    narrative:
      "The position's reward address on chain is not this account. The row says where rewards go, and the review says it again before signing.",
    prepare: drive(claimElsewhere, "review"),
    state: { action: "claim", rewardsTo: "another address", step: "review" },
  },
  {
    content: () => walletDashboard({ staking: opened(stakedRow), view: "staking" }),
    id: "staking-claim-none",
    label: "Nothing to claim",
    narrative:
      "A staked position with no rewards yet: no rewards line and no Claim rewards button.",
    state: { action: "claim", rewards: "0" },
  },
];
