/**
 * Signing text: the swap confirm step and the staking review line and confirm.
 * Every message here is pinned to its English (`tests/i18n/review-pins.ts`).
 */
import type { Catalog } from "@bramble/core/i18n";

const en = {
  "review.staking.confirm": "Confirm · {fee}",
  "review.staking.estimating": "Estimating the maximum fee…",
  "review.staking.failed": "Staking failed",
  "review.staking.review": "{review} Maximum network fee: {fee}.",
  "review.staking.submitted": "Staking transaction submitted",
  "review.staking.submittedFollow": "Submitted. Follow it in Activity.",
  "review.staking.submitting": "Submitting…",
  "review.swap.confirm": "Confirm swap",
  "review.swap.confirming": "Confirming…",
  "review.swap.cost": "Cost",
  "review.swap.estimatedFee": "Estimated fee",
  "review.swap.failed": "Swap failed",
  "review.swap.minimumReceived": "Minimum received",
  "review.swap.pairLabel": "What will happen",
  "review.swap.receive": "You receive",
  "review.swap.sell": "You sell",
  "review.swap.submitting": "Submitting swap…",
  "review.swap.title": "Review swap",
} as const;

/** English and Simplified Chinese swap and staking review copy. */
export const reviewStepsSwapMessages = {
  en,
  "zh-Hans": {
    "review.staking.confirm": "确认 · {fee}",
    "review.staking.estimating": "正在估算最高费用…",
    "review.staking.failed": "质押失败",
    "review.staking.review": "{review} 最高网络费：{fee}。",
    "review.staking.submitted": "质押交易已提交",
    "review.staking.submittedFollow": "已提交。在活动中跟踪它。",
    "review.staking.submitting": "正在提交…",
    "review.swap.confirm": "确认兑换",
    "review.swap.confirming": "正在确认…",
    "review.swap.cost": "费用",
    "review.swap.estimatedFee": "预估网络费",
    "review.swap.failed": "兑换失败",
    "review.swap.minimumReceived": "最少收到",
    "review.swap.pairLabel": "将会发生什么",
    "review.swap.receive": "你收到",
    "review.swap.sell": "你卖出",
    "review.swap.submitting": "正在提交兑换…",
    "review.swap.title": "检查兑换",
  } satisfies Catalog<keyof typeof en>,
};
