/**
 * STRK20 review sentences: what a private action, a shadow-account invoke, a
 * fee route or a disclosure does, as the user reads it before approving.
 *
 * Each producer decides its sentence as a reference (a key and its facts); the
 * English it has always shown is rendered from this catalog, and the wallet UI
 * renders the same reference in the reader's language. Facts (amounts,
 * symbols, addresses, nonces, counts, origins, deadlines) are filled in by
 * code; a translation can only rearrange them.
 *
 * Trust boundary: these are security text. Each translation is pinned to the
 * English it was made from (`tests/policy/review-message-pins.ts`).
 */
import {
  type Catalog,
  isMessageRef,
  type MessageRef,
  type Placeholders,
  renderMessageRef,
} from "@bramble/core/i18n";

const en = {
  "strk20Review.action.deposit": "Deposit {amount} to private balance ({token})",
  "strk20Review.action.invoke": "Private invoke on {contract}",
  "strk20Review.action.pay": "Pay {amount} privately to {recipient} ({token})",
  "strk20Review.action.shadowInvoke": "Private {dapp} shadow account invoke ({count} calls)",
  "strk20Review.action.transfer": "Transfer {amount} privately to {recipient} ({token})",
  "strk20Review.action.withdraw": "Withdraw {amount} to {recipient} ({token})",
  "strk20Review.amount.openNote": "an open note",
  "strk20Review.balances.all": "Share all private token balances",
  "strk20Review.balances.many": "Share private balances for {count} tokens",
  "strk20Review.balances.one": "Share private balances for {count} token",
  "strk20Review.balances.token": "Token {token}",
  "strk20Review.fee.raw": "{amount} ({token})",
  "strk20Review.plan.account":
    "Public account pool fee {fee} — first deposits are linked to this wallet",
  "strk20Review.plan.relay": "Private relay fee {fee}",
  "strk20Review.plan.relayAuthMany":
    "Private relay fee {fee} · outside execution by {caller} from {after} until {before} for {count} public approval calls",
  "strk20Review.plan.relayAuthOne":
    "Private relay fee {fee} · outside execution by {caller} from {after} until {before} for {count} public approval call",
  "strk20Review.plan.relayCapped": "Private relay fee {fee} · capped at {ceiling}",
  "strk20Review.plan.relayCappedAuthMany":
    "Private relay fee {fee} · capped at {ceiling} · outside execution by {caller} from {after} until {before} for {count} public approval calls",
  "strk20Review.plan.relayCappedAuthOne":
    "Private relay fee {fee} · capped at {ceiling} · outside execution by {caller} from {after} until {before} for {count} public approval call",
  "strk20Review.prepare.proof": "Generate a submittable private proof for this site",
  "strk20Review.prepare.simulate": "Simulate only — no submittable proof",
  "strk20Review.register.activate": "Activate private balances for this account",
  "strk20Review.register.channel": "Opens this account's own private channel",
  "strk20Review.register.commitment": "Publishes a viewing-key commitment, never the viewing key",
  "strk20Review.register.pool": "Privacy pool {address}",
  "strk20Review.register.poolFee": "Approve and pay the reviewed {fee} pool fee",
  "strk20Review.register.preflightToken": "Registration preflight token {token}",
  "strk20Review.shadow.anonymizer": "Shadow account anonymizer {address}",
  "strk20Review.shadow.collectsAllTo":
    "This shadow account's whole {tokens} balance goes to {recipient}",
  "strk20Review.shadow.control":
    "Only this wallet can move what the calls leave in the shadow account: through this site, or with Sweep in Settings → Shadow accounts.",
  "strk20Review.shadow.runsMany":
    "Runs {count} calls through your shadow account #{nonce} for {origin}",
  "strk20Review.shadow.runsOne":
    "Runs {count} call through your shadow account #{nonce} for {origin}",
  "strk20Review.shadow.settles": "Settles {tokens} back into private notes",
  "strk20Review.shadow.settlesNothing": "Nothing settles back into private notes",
  "strk20Review.shadow.settlesTo": "Settles {tokens} into a private note for {recipient}",
  "strk20Review.shadow.sweep": "Sweep your shadow account #{nonce} for {origin}",
  "strk20Review.shadowShare.commitment": "Share a private shadow account commitment for {origin}",
  "strk20Review.shadowShare.label": "Site-chosen scope label {label}",
  "strk20Review.shadowShare.nonce": "Nonce {nonce}",
  "strk20Review.sponsored.estimateMany":
    "{sponsor} pays the pool fee {fee} and the network fee (about {network}). Its payment is public and names this account · outside execution by its relay for {count} public approval calls",
  "strk20Review.sponsored.estimateOne":
    "{sponsor} pays the pool fee {fee} and the network fee (about {network}). Its payment is public and names this account · outside execution by its relay for {count} public approval call",
  "strk20Review.sponsored.many":
    "{sponsor} pays the pool fee {fee} and the network fee. Its payment is public and names this account · outside execution by its relay for {count} public approval calls",
  "strk20Review.sponsored.one":
    "{sponsor} pays the pool fee {fee} and the network fee. Its payment is public and names this account · outside execution by its relay for {count} public approval call",
  "strk20Review.wallet.activateShield": "Activate private balances and shield {value}",
  "strk20Review.wallet.depositOtherNote":
    "The deposit is public: your address and the amount are on chain, and only the recipient stays hidden",
  "strk20Review.wallet.depositSelfNote":
    "The deposit is public; the resulting balance can be spent privately",
  "strk20Review.wallet.register": "Register this account with the privacy pool",
  "strk20Review.wallet.registerFee":
    "Approve and pay the reviewed {fee} pool fee from this account",
  "strk20Review.wallet.registerPublic":
    "Registration is public and links this wallet address to its viewing key",
  "strk20Review.wallet.send": "Send {amount} {symbol} privately to {recipient}",
  "strk20Review.wallet.sendNote":
    "The transfer moves shielded balance; the amount and recipient stay off-chain",
  "strk20Review.wallet.shield": "Shield {value}",
  "strk20Review.wallet.shieldTo": "Shield {value} into {recipient}'s private balance",
  "strk20Review.wallet.unshieldNote":
    "The withdrawal is public: the amount and destination become visible on-chain",
  "strk20Review.wallet.unshieldSelf": "Unshield {amount} {symbol} to this account",
  "strk20Review.wallet.unshieldTo": "Unshield {amount} {symbol} to {recipient}",
} as const;

/** English and Simplified Chinese STRK20 review sentences. */
export const strk20ReviewMessages = {
  en,
  "zh-Hans": {
    "strk20Review.action.deposit": "将 {amount} 存入隐私余额（{token}）",
    "strk20Review.action.invoke": "在 {contract} 上进行隐私调用",
    "strk20Review.action.pay": "向 {recipient} 隐私支付 {amount}（{token}）",
    "strk20Review.action.shadowInvoke": "{dapp} 影子账户隐私调用（{count} 个调用）",
    "strk20Review.action.transfer": "向 {recipient} 隐私转账 {amount}（{token}）",
    "strk20Review.action.withdraw": "将 {amount} 提取至 {recipient}（{token}）",
    "strk20Review.amount.openNote": "一张开放票据",
    "strk20Review.balances.all": "共享所有代币的隐私余额",
    "strk20Review.balances.many": "共享 {count} 个代币的隐私余额",
    "strk20Review.balances.one": "共享 {count} 个代币的隐私余额",
    "strk20Review.balances.token": "代币 {token}",
    "strk20Review.fee.raw": "{amount}（{token}）",
    "strk20Review.plan.account": "公开账户隐私池费用 {fee} — 首次存入会与此钱包关联",
    "strk20Review.plan.relay": "隐私中继费 {fee}",
    "strk20Review.plan.relayAuthMany":
      "隐私中继费 {fee} · 由 {caller} 在 {after} 之后、{before} 之前进行外部执行，涉及 {count} 个公开批准调用",
    "strk20Review.plan.relayAuthOne":
      "隐私中继费 {fee} · 由 {caller} 在 {after} 之后、{before} 之前进行外部执行，涉及 {count} 个公开批准调用",
    "strk20Review.plan.relayCapped": "隐私中继费 {fee} · 上限为 {ceiling}",
    "strk20Review.plan.relayCappedAuthMany":
      "隐私中继费 {fee} · 上限为 {ceiling} · 由 {caller} 在 {after} 之后、{before} 之前进行外部执行，涉及 {count} 个公开批准调用",
    "strk20Review.plan.relayCappedAuthOne":
      "隐私中继费 {fee} · 上限为 {ceiling} · 由 {caller} 在 {after} 之后、{before} 之前进行外部执行，涉及 {count} 个公开批准调用",
    "strk20Review.prepare.proof": "为此网站生成可提交的隐私证明",
    "strk20Review.prepare.simulate": "仅模拟 — 不生成可提交的证明",
    "strk20Review.register.activate": "为此账户启用隐私余额",
    "strk20Review.register.channel": "开通此账户自己的隐私通道",
    "strk20Review.register.commitment": "发布查看密钥的承诺，绝不发布查看密钥本身",
    "strk20Review.register.pool": "隐私池 {address}",
    "strk20Review.register.poolFee": "批准并支付已审核的 {fee} 隐私池费用",
    "strk20Review.register.preflightToken": "注册预检代币 {token}",
    "strk20Review.shadow.anonymizer": "影子账户匿名器 {address}",
    "strk20Review.shadow.collectsAllTo": "此影子账户的全部 {tokens} 余额都归 {recipient}",
    "strk20Review.shadow.control":
      "只有此钱包能转移这些调用留在影子账户中的资产：通过此网站，或在设置 → 影子账户中使用清扫。",
    "strk20Review.shadow.runsMany": "通过你的影子账户 #{nonce} 为 {origin} 执行 {count} 个调用",
    "strk20Review.shadow.runsOne": "通过你的影子账户 #{nonce} 为 {origin} 执行 {count} 个调用",
    "strk20Review.shadow.settles": "将 {tokens} 结算回隐私票据",
    "strk20Review.shadow.settlesNothing": "没有任何资产结算回隐私票据",
    "strk20Review.shadow.settlesTo": "将 {tokens} 结算为 {recipient} 的隐私票据",
    "strk20Review.shadow.sweep": "为 {origin} 清扫你的影子账户 #{nonce}",
    "strk20Review.shadowShare.commitment": "为 {origin} 共享一个隐私影子账户承诺",
    "strk20Review.shadowShare.label": "网站选择的范围标签 {label}",
    "strk20Review.shadowShare.nonce": "Nonce {nonce}",
    "strk20Review.sponsored.estimateMany":
      "{sponsor} 支付隐私池费用 {fee} 和网络费（约 {network}）。其付款是公开的，并会显示此账户 · 由其中继进行外部执行，涉及 {count} 个公开批准调用",
    "strk20Review.sponsored.estimateOne":
      "{sponsor} 支付隐私池费用 {fee} 和网络费（约 {network}）。其付款是公开的，并会显示此账户 · 由其中继进行外部执行，涉及 {count} 个公开批准调用",
    "strk20Review.sponsored.many":
      "{sponsor} 支付隐私池费用 {fee} 和网络费。其付款是公开的，并会显示此账户 · 由其中继进行外部执行，涉及 {count} 个公开批准调用",
    "strk20Review.sponsored.one":
      "{sponsor} 支付隐私池费用 {fee} 和网络费。其付款是公开的，并会显示此账户 · 由其中继进行外部执行，涉及 {count} 个公开批准调用",
    "strk20Review.wallet.activateShield": "启用隐私余额并将 {value} 转入隐私余额",
    "strk20Review.wallet.depositOtherNote":
      "存入是公开的：你的地址和金额会上链，只有收款人保持隐藏",
    "strk20Review.wallet.depositSelfNote": "存入是公开的；所得余额可以隐私地花费",
    "strk20Review.wallet.register": "将此账户注册到隐私池",
    "strk20Review.wallet.registerFee": "从此账户批准并支付已审核的 {fee} 隐私池费用",
    "strk20Review.wallet.registerPublic": "注册是公开的，并会将此钱包地址与其查看密钥关联",
    "strk20Review.wallet.send": "向 {recipient} 隐私发送 {amount} {symbol}",
    "strk20Review.wallet.sendNote": "此转账转移的是隐私余额；金额和收款人都不会上链",
    "strk20Review.wallet.shield": "将 {value} 转入隐私余额",
    "strk20Review.wallet.shieldTo": "将 {value} 转入 {recipient} 的隐私余额",
    "strk20Review.wallet.unshieldNote": "提取是公开的：金额和目标地址会在链上可见",
    "strk20Review.wallet.unshieldSelf": "将 {amount} {symbol} 转出隐私余额至此账户",
    "strk20Review.wallet.unshieldTo": "将 {amount} {symbol} 转出隐私余额至 {recipient}",
  } satisfies Catalog<keyof typeof en>,
};

/** A STRK20 review sentence id. */
export type Strk20ReviewKey = keyof typeof en;

/** Whether a string names a STRK20 review sentence. */
export const isStrk20ReviewKey = (key: string): key is Strk20ReviewKey => Object.hasOwn(en, key);

/**
 * Builds a STRK20 review reference, typed by its English template. A fact is
 * display text or one nested STRK20 reference (an amount, a raw fee).
 */
export const strk20Text = <K extends Strk20ReviewKey>(
  key: K,
  ...args: [Placeholders<(typeof en)[K]>] extends [never]
    ? []
    : [facts: Readonly<Record<Placeholders<(typeof en)[K]>, string | MessageRef>>]
): MessageRef => ({ key, facts: args[0] ?? {} });

/** The English of a STRK20 review reference, as producers have always shown it. */
export const strk20English = (text: MessageRef): string =>
  renderMessageRef(text, (key) => (isStrk20ReviewKey(key) ? en[key] : undefined));

/** Validates a STRK20 review reference from another extension context. */
export const isStrk20ReviewText = (value: unknown): value is MessageRef =>
  isMessageRef(value, isStrk20ReviewKey);

/**
 * Lines as their English plus, when every line's reference would pass the
 * panel's validator, the references index for index. A list carries no
 * references at all rather than an unpaired one.
 */
export const strk20Lines = (
  texts: readonly MessageRef[],
): { readonly summaries: string[]; readonly summaryTexts?: readonly MessageRef[] } => ({
  summaries: texts.map(strk20English),
  ...(texts.every(isStrk20ReviewText) ? { summaryTexts: texts } : {}),
});
