/**
 * Review sentences: what a call does and why it is risky, as the user reads
 * them before signing.
 *
 * The verifier decides each sentence and its facts (amounts, symbols,
 * addresses, ids) as a {@link MessageRef}; English is rendered from this
 * catalog for activity, logs and refusals, and the wallet UI renders the same
 * reference in the reader's language. A translation can only rearrange the
 * facts, never restate them: every fact is filled in by code.
 *
 * Trust boundary: these are security text. Each translation is pinned to the
 * English it was made from (`tests/routing/review-message-pins.ts`), so a
 * changed English sentence fails the test until its translation is redone.
 */
import {
  type Catalog,
  isMessageRef,
  type MessageRef,
  type Placeholders,
  renderMessageRef,
} from "@bramble/core/i18n";

const en = {
  "review.amount.units": "{amount} units",
  "review.amount.unitsOf": "{amount} units of {token}",
  "review.call.allow": "Allow {party} to spend {amount}",
  "review.call.allowMore": "Allow {party} to spend {amount} more",
  "review.call.grantOperator":
    "Allow {party} to transfer EVERY item you own in collection {collection}",
  "review.call.nftApproval": "Allow {party} to transfer NFT #{id} of collection {collection}",
  "review.call.revokeOperator":
    "Revoke {party}'s permission to transfer every item in collection {collection}",
  "review.call.safeTransferNft": "Safe transfer of NFT #{id} to {to}",
  "review.call.send": "Send {amount} to {to}",
  "review.call.sendBatchMany": "Send {count} token ids of collection {collection} to {to}",
  "review.call.sendBatchOne": "Send {count} token id of collection {collection} to {to}",
  "review.call.sendFrom": "Send {amount} from {from} to {to}",
  "review.call.sendNft": "Send NFT #{id} to {to}",
  "review.call.sendNftEditions": "Send {count} of NFT #{id} to {to}",
  "review.call.swap": "Swap {sell} for at least {floor}, paid to {payee}",
  "review.call.unknown": "Call {entrypoint} on {contract}",
  "review.call.unknownApproval":
    "Authorize {party} for amount or NFT #{amount} on unknown contract {contract}",
  "review.flag.addressPoisoning":
    "The recipient closely mimics an address you saved or paid but is a different account. Re-check every character before sending.",
  "review.flag.foreignBeneficiary":
    "This swap pays its proceeds to {payee}, not to this account. Reject it unless you meant to send them there.",
  "review.flag.operatorApproval":
    "This lets one address transfer EVERY item you own in this collection, including ones you acquire later, until you revoke it. Grant it only to a marketplace you trust.",
  "review.flag.selfTransfer": "The recipient is this wallet's own address.",
  "review.flag.tokenContractRecipient":
    "This is a token contract, not a wallet. Tokens sent here are usually lost.",
  "review.flag.undecodedSwap":
    "The wallet could not read this swap's payee or minimum output. Reject it unless you trust this site.",
  "review.flag.unknownContract":
    "{contract} is not a token or contact this wallet knows. Verify the contract before continuing.",
  "review.flag.unlimitedApproval":
    "This grants an effectively unlimited spending allowance. Approve only the amount you intend to spend.",
} as const;

/** English and Simplified Chinese review sentences. */
export const reviewMessages = {
  en,
  "zh-Hans": {
    "review.amount.units": "{amount} 个最小单位",
    "review.amount.unitsOf": "{amount} 个最小单位的 {token}",
    "review.call.allow": "允许 {party} 花费 {amount}",
    "review.call.allowMore": "允许 {party} 再花费 {amount}",
    "review.call.grantOperator": "允许 {party} 转移你在合集 {collection} 中拥有的全部物品",
    "review.call.nftApproval": "允许 {party} 转移合集 {collection} 中的 NFT #{id}",
    "review.call.revokeOperator": "撤销 {party} 转移合集 {collection} 中全部物品的权限",
    "review.call.safeTransferNft": "安全转移 NFT #{id} 至 {to}",
    "review.call.send": "发送 {amount} 至 {to}",
    "review.call.sendBatchMany": "将合集 {collection} 中的 {count} 个代币 ID 发送至 {to}",
    "review.call.sendBatchOne": "将合集 {collection} 中的 {count} 个代币 ID 发送至 {to}",
    "review.call.sendFrom": "从 {from} 发送 {amount} 至 {to}",
    "review.call.sendNft": "发送 NFT #{id} 至 {to}",
    "review.call.sendNftEditions": "发送 {count} 份 NFT #{id} 至 {to}",
    "review.call.swap": "用 {sell} 兑换至少 {floor}，支付给 {payee}",
    "review.call.unknown": "在 {contract} 上调用 {entrypoint}",
    "review.call.unknownApproval": "授权 {party} 使用未知合约 {contract} 上的金额或 NFT #{amount}",
    "review.flag.addressPoisoning":
      "收款地址与你保存或付过款的某个地址极为相似，但属于另一个账户。发送前逐个字符核对。",
    "review.flag.foreignBeneficiary":
      "此兑换将所得支付给 {payee}，而不是此账户。除非你本意如此，否则拒绝。",
    "review.flag.operatorApproval":
      "这将允许一个地址转移你在此合集中拥有的全部物品，包括以后获得的，直到你撤销。只授权给你信任的市场。",
    "review.flag.selfTransfer": "收款地址是此钱包自己的地址。",
    "review.flag.tokenContractRecipient": "这是代币合约，不是钱包。发送到这里的代币通常会丢失。",
    "review.flag.undecodedSwap":
      "钱包无法读取此兑换的收款方或最低兑得数量。除非你信任此网站，否则拒绝。",
    "review.flag.unknownContract": "{contract} 不是此钱包已知的代币或联系人。继续前先核实该合约。",
    "review.flag.unlimitedApproval": "这将授予几乎无限的花费额度。只批准你打算花费的数额。",
  } satisfies Catalog<keyof typeof en>,
};

/** A review sentence id. */
export type ReviewMessageKey = keyof typeof en;

/** Whether a string names a review sentence. */
export const isReviewMessageKey = (key: string): key is ReviewMessageKey => Object.hasOwn(en, key);

/**
 * A review sentence as data. Facts are display strings the verifier already
 * formatted, or one nested review message (an amount in raw units).
 */
export type ReviewText = MessageRef;

/**
 * Builds a review sentence reference. Typed by the English template, so a
 * missing or extra fact is a compile error.
 */
export const reviewText = <K extends ReviewMessageKey>(
  key: K,
  ...args: [Placeholders<(typeof en)[K]>] extends [never]
    ? []
    : [facts: Readonly<Record<Placeholders<(typeof en)[K]>, string | ReviewText>>]
): ReviewText => ({ key, facts: args[0] ?? {} });

/** The English rendering every non-UI consumer (activity, refusals) uses. */
export const reviewEnglish = (text: ReviewText): string =>
  renderMessageRef(text, (key) => (isReviewMessageKey(key) ? en[key] : undefined));

/**
 * Validates a review sentence reference from another extension context. Only
 * keys this catalog defines pass; see `isMessageRef` for the bounds.
 */
export const isReviewText = (value: unknown): value is ReviewText =>
  isMessageRef(value, isReviewMessageKey);
