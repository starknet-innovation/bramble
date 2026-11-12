/**
 * Signing text: the Cost section of every pre-sign review, the fee lines and
 * shortfall warnings, the outcome receipt, and the account deployment review.
 * Pinned in `tests/i18n/review-pins.ts`: changing an English line here fails
 * the pin test until its translation is redone.
 */
import type { Catalog } from "@bramble/core/i18n";

const en = {
  "cost.confirm.accepted": "Transaction confirmed on Starknet",
  "cost.confirm.notConfirmed": "Transaction was not confirmed",
  "cost.confirm.preconfirmed": "Transaction pre-confirmed on Starknet",
  "cost.confirm.rejected": "Starknet rejected this transaction. Nothing changed.",
  "cost.confirm.reverted":
    "Starknet reverted this transaction. Review its activity details before retrying.",
  "cost.deploy.confirmedDescription": "This account is on Starknet and can submit transactions.",
  "cost.deploy.confirmedTitle": "Account deployed",
  "cost.deploy.estimating": "Estimating fee…",
  "cost.deploy.failed": "Deployment failed",
  "cost.deploy.failedTitle": "Deployment failed",
  "cost.deploy.maxFee": "Maximum network fee: {fee}",
  "cost.deploy.needsStrk": "Add STRK to this account to deploy it.",
  "cost.deploy.quoteFailed": "Could not estimate the deployment fee",
  "cost.deploy.sponsored": "Network fee: paid by the {sponsor}",
  "cost.deploy.submittedTitle": "Deployment submitted",
  "cost.deploy.submitting": "Submitting deployment…",
  "cost.fee.afterDeploy": "The network fee is estimated once this account is deployed.",
  "cost.fee.balanceShort":
    "This account's STRK balance is less than this transaction needs, including the estimated network fee. The network will likely reject it.",
  "cost.fee.bothFailed":
    "Couldn't estimate both the transaction and account deployment fees. Check your connection and retry before sending.",
  "cost.fee.deployShare": "Creating this account on Starknet is {fee} of that.",
  "cost.fee.deployShareLedger":
    "Creating this account on Starknet is {fee} of that, and your Ledger asks to sign both.",
  "cost.fee.estimated": "Estimated fee: {fee}",
  "cost.fee.estimating": "Estimating network fee…",
  "cost.fee.failed":
    "Couldn't estimate the network fee right now. Check your connection and retry before sending.",
  "cost.fee.payUpTo": "Pay up to {amount} {token}",
  "cost.fee.retry": "Retry fee estimate",
  "cost.fee.shieldShortFees":
    "This shield needs up to {need} in fees. Add {short}, then review again.",
  "cost.fee.shieldShortIncluding":
    "This shield needs up to {need}, including the amount. Add {short}, then review again.",
  "cost.fee.total": "Total fees: {fee}",
  "cost.outcome.back": "Back",
  "cost.outcome.copyHash": "Copy transaction hash",
  "cost.outcome.notConfirmed": "Not confirmed yet. Follow it in Activity.",
  "cost.outcome.transaction": "Transaction",
  "cost.outcome.tryAgain": "Try again",
  "cost.outcome.viewActivity": "View in Activity tab",
  "cost.section.cost": "Cost",
  "cost.section.costLimits": "Cost and limits",
  "cost.section.outcome": "What will happen",
  "cost.section.risk": "Risk and recovery",
} as const;

/** English and Simplified Chinese cost, fee, outcome and deployment review copy. */
export const reviewFeeMessages = {
  en,
  "zh-Hans": {
    "cost.confirm.accepted": "交易已在 Starknet 上确认",
    "cost.confirm.notConfirmed": "交易未被确认",
    "cost.confirm.preconfirmed": "交易已在 Starknet 上预确认",
    "cost.confirm.rejected": "Starknet 拒绝了这笔交易。没有任何变化。",
    "cost.confirm.reverted": "Starknet 回滚了这笔交易。重试前先查看它的活动详情。",
    "cost.deploy.confirmedDescription": "此账户已在 Starknet 上，可以提交交易。",
    "cost.deploy.confirmedTitle": "账户已部署",
    "cost.deploy.estimating": "正在估算费用…",
    "cost.deploy.failed": "部署失败",
    "cost.deploy.failedTitle": "部署失败",
    "cost.deploy.maxFee": "最高网络费：{fee}",
    "cost.deploy.needsStrk": "向此账户添加 STRK 后才能部署。",
    "cost.deploy.quoteFailed": "无法估算部署费",
    "cost.deploy.sponsored": "网络费：由 {sponsor} 支付",
    "cost.deploy.submittedTitle": "部署已提交",
    "cost.deploy.submitting": "正在提交部署…",
    "cost.fee.afterDeploy": "此账户部署后才会估算网络费。",
    "cost.fee.balanceShort":
      "此账户的 STRK 余额低于这笔交易所需的数额（含预估网络费）。网络很可能会拒绝这笔交易。",
    "cost.fee.bothFailed": "无法估算交易费和账户部署费这两项费用。发送前检查网络连接并重试。",
    "cost.fee.deployShare": "其中 {fee} 用于在 Starknet 上创建此账户。",
    "cost.fee.deployShareLedger":
      "其中 {fee} 用于在 Starknet 上创建此账户，你的 Ledger 会要求对这两笔交易都签名。",
    "cost.fee.estimated": "预估费用：{fee}",
    "cost.fee.estimating": "正在估算网络费…",
    "cost.fee.failed": "目前无法估算网络费。发送前检查网络连接并重试。",
    "cost.fee.payUpTo": "最多支付 {amount} {token}",
    "cost.fee.retry": "重新估算费用",
    "cost.fee.shieldShortFees":
      "此次转入隐私余额最多需要 {need} 的费用。先添加 {short}，然后重新检查。",
    "cost.fee.shieldShortIncluding":
      "此次转入隐私余额最多需要 {need}（含转入金额）。先添加 {short}，然后重新检查。",
    "cost.fee.total": "总费用：{fee}",
    "cost.outcome.back": "返回",
    "cost.outcome.copyHash": "复制交易哈希",
    "cost.outcome.notConfirmed": "尚未确认。在活动中跟踪进度。",
    "cost.outcome.transaction": "交易",
    "cost.outcome.tryAgain": "重试",
    "cost.outcome.viewActivity": "在活动标签页查看",
    "cost.section.cost": "费用",
    "cost.section.costLimits": "费用与限制",
    "cost.section.outcome": "将会发生什么",
    "cost.section.risk": "风险与恢复",
  } satisfies Catalog<keyof typeof en>,
};
