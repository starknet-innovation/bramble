/**
 * Display shaping for the Activity feed. Stored summaries keep the amount at
 * full token precision (they are load-bearing: reconciliation and de-dup match
 * on them), so everything here happens at render time and never touches the
 * record: figures are trimmed to four places through the shared amount policy,
 * a row's verb, detail line, signed fiat delta, and asset amount are derived
 * from the entry, and an entry whose token or price is unknown yields no fiat
 * figure at all rather than a guessed one. Pure — no DOM, no clock.
 */
import type { DisplayCurrency, TokenConfig } from "@bramble/settings/preferences";
import type { ActivityEntry } from "@bramble/transactions/activity";
import type { IconName } from "@bramble/ui-kit/icons";
import { formatFiat, tokenFiatValue } from "../../shared/fiat";
import { accountLabel } from "../../shared/parts";
import { compactAmount } from "./token-row";

// Decimal places an activity row shows at most.
const ACTIVITY_FRACTION_PLACES = 4;

// A decimal figure: digits (optionally grouped) with a fractional part, not
// attached to a word or a hex string on either side.
const DECIMAL_FIGURE = /(?<![\w.])(\d[\d,]*\.\d+)(?![\w.])/g;

/**
 * Returns the summary with every decimal figure trimmed to at most four places.
 */
export const compactSummary = (summary: string): string =>
  summary.replace(DECIMAL_FIGURE, (figure) => {
    const [, fraction = ""] = figure.split(".");
    return fraction.length > ACTIVITY_FRACTION_PLACES
      ? compactAmount(figure.replace(/,/g, ""), ACTIVITY_FRACTION_PLACES)
      : figure;
  });

/**
 * A recorded amount for the row's asset line: the same four-place ceiling as
 * the summary, with grouped thousands, and shorter figures left as written.
 */
export const compactActivityAmount = (amount: string): string => {
  const [, fraction = ""] = amount.split(".");
  return fraction.length > ACTIVITY_FRACTION_PLACES
    ? compactAmount(amount, ACTIVITY_FRACTION_PLACES)
    : compactAmount(amount);
};

/**
 * Prices and tracked tokens the feed needs to price a row. Prices are keyed by
 * token address while an entry only records a symbol, so the tracked-token
 * list is the bridge between them.
 */
export type ActivityPricing = {
  readonly currency: DisplayCurrency;
  readonly prices: Readonly<Record<string, number>>;
  readonly tokens: readonly TokenConfig[];
};

/**
 * Classification of one entry: the glyph, the accessible kind name, the verb
 * shown as the row title, and which way value moved: `in` or `out` of the
 * account, `internal` between the owner's own public and private balances
 * (priced, but unsigned), or `null` when the entry is not a value movement —
 * an approval, a deployment, an activation — so no fiat figure is attached.
 */
export type ActivityAppearance = {
  readonly direction: "in" | "internal" | "out" | null;
  readonly icon: IconName;
  readonly label: string;
  readonly title: string;
  readonly type:
    | "approval"
    | "declare"
    | "deploy"
    | "other"
    | "private"
    | "reward"
    | "stake"
    | "swap"
    | "transfer"
    | "unstake";
};

const SWAP = /\bswap(ped|ping)?\b/;
const UNSTAKE = /\bunstak(e|ed|ing)\b|\bundelegat(e|ed|ing)\b/;
const REWARD =
  /\b(claim|claimed|claiming)\b.*\brewards?\b|\brewards?\b.*\b(claim|claimed|claiming)\b/;
const STAKE = /\bstak(e|ed|ing)\b|\bdelegat(e|ed|ing)\b/;
const PRIVATE = /\b(un)?shield(ed|ing)?\b|\bprivate(ly)?\b/;
const APPROVAL = /\b(approve|approved|approval|revoke|revoked|allow|allowance)\b/;
const RECEIVED = /\b(receive|received)\b/;

// A shield or unshield names its recipient only when that is someone else:
// "Shield 5 STRK to 0x…" / "… into 0x…'s private balance" / "Unshield 5 STRK
// to 0x…" leave the account, while "Shield 5 STRK", "Unshield 5 STRK", and
// "Unshield 5 STRK to this account" stay between the owner's own balances.
const NAMES_OTHER_PARTY = /\b(?:into|to)\s+(?!this account\b)\S/;

const privateAppearance = (summary: string): ActivityAppearance => {
  const base = { icon: "shield", label: "Private transaction", type: "private" } as const;
  const direction = NAMES_OTHER_PARTY.test(summary) ? "out" : "internal";
  if (/\bunshield/.test(summary)) return { ...base, direction, title: "Unshielded" };
  if (/\bshield/.test(summary)) return { ...base, direction, title: "Shielded" };
  if (/\bprivately\b|\bprivate transfer\b/.test(summary))
    return { ...base, direction: "out", title: "Private transfer" };
  return { ...base, direction: null, title: "Private transaction" };
};

const transferAppearance = (direction: "in" | "out"): ActivityAppearance => ({
  direction,
  icon: direction === "in" ? "arrowDownLeft" : "arrowDownRight",
  label: "Transfer",
  title: direction === "in" ? "Received" : "Sent",
  type: "transfer",
});

// The direction of a transfer row, read from what the wallet recorded rather
// than from words anywhere in the summary. A summary embeds the token symbol,
// which a third party chooses, so "SWAP" or "RECEIVED" as a symbol must not
// change the verb or the arrow (Sherlock 196). Discovered rows written before
// `direction` existed begin with the wallet's own "Received " or "Sent ".
const recordedTransferDirection = (entry: ActivityEntry): "in" | "out" | null => {
  if (entry.kind !== "transfer") return null;
  if (entry.direction !== undefined) return entry.direction;
  if (entry.origin === "wallet") return null;
  if (entry.summary.startsWith("Received ")) return "in";
  if (entry.summary.startsWith("Sent ")) return "out";
  return null;
};

/**
 * Classifies an entry. A transfer whose direction the wallet recorded reads as
 * Received or Sent from that alone. Otherwise the summary wording is the only
 * signal for swaps, staking, rewards, privacy, and approvals, and the stored
 * kind decides the rest.
 */
export const activityAppearance = (entry: ActivityEntry): ActivityAppearance => {
  const recorded = recordedTransferDirection(entry);
  if (recorded !== null) return transferAppearance(recorded);
  const summary = entry.summary.toLowerCase();
  if (SWAP.test(summary))
    return {
      direction: "out",
      icon: "arrowLeftRight",
      label: "Swap",
      title: "Swapped",
      type: "swap",
    };
  if (UNSTAKE.test(summary))
    return {
      direction: "in",
      icon: "lockKeyholeOpen",
      label: "Unstake",
      title: "Unstaked",
      type: "unstake",
    };
  if (REWARD.test(summary))
    return {
      direction: "in",
      icon: "creditCard",
      label: "Claim rewards",
      title: "Claimed rewards",
      type: "reward",
    };
  if (STAKE.test(summary))
    return {
      direction: "out",
      icon: "lockKeyhole",
      label: "Stake",
      title: "Staked",
      type: "stake",
    };
  if (PRIVATE.test(summary)) return privateAppearance(summary);
  if (APPROVAL.test(summary))
    return {
      direction: null,
      icon: "keyRound",
      label: "Approval",
      title: /\brevok/.test(summary) ? "Revoked" : "Approved",
      type: "approval",
    };
  if (entry.kind === "transfer") return transferAppearance(RECEIVED.test(summary) ? "in" : "out");
  if (entry.kind === "deploy")
    return {
      direction: null,
      icon: "rocket",
      label: "Deployment",
      title: "Deployed",
      type: "deploy",
    };
  if (entry.kind === "declare")
    return {
      direction: null,
      icon: "terminal",
      label: "Contract declaration",
      title: "Declared",
      type: "declare",
    };
  return {
    direction: null,
    icon: "layoutGrid",
    label: "Contract interaction",
    title: "Interacted",
    type: "other",
  };
};

// "Swap 1 STRK for ~2.5 USDC via avnu" → the asset pair the row title implies.
const SWAP_PAIR =
  /\bswap(?:ped|ping)?\s+~?[\d.,]*\s*([a-z0-9.$-]+)\s+for\s+(?:(?:at\s+least|~)\s*)?[\d.,]*\s*([a-z0-9.$-]+)/i;
// The verb the title already conveys, so the detail line does not repeat it.
const LEADING_VERB =
  /^(?:swap(?:ped|ping)?|unstak(?:e|ed|ing)|undelegat(?:e|ed|ing)|stak(?:e|ed|ing)|delegat(?:e|ed|ing)|claim(?:ed|ing)?(?:\s+(?:staking\s+)?rewards?)?|unshield(?:ed|ing)?|shield(?:ed|ing)?|private(?:ly)?(?:\s+transfer)?|send|sent|receiv(?:e|ed)|approv(?:e|ed)|allow|revok(?:e|ed)(?:\s+approval)?|deploy(?:ed)?|declar(?:e|ed))\b\s*/i;
// A leading "<amount> <symbol>" the asset column already shows.
const LEADING_FIGURE = /^~?\d[\d,]*(?:\.\d+)?\s+\S+\s*/;
const TRAILING_PRIVATELY = /\s+privately$/i;

/**
 * Upper-cases the first character of a display string (status words, detail
 * remainders); an empty string passes through.
 */
export const capitalise = (value: string): string =>
  value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;

// What the recorded counterparty was to this account: the sender of value that
// came in, the recipient (or spender) of value that went out or was approved,
// or simply the other party. Names both the detail line's preposition and the
// copy control's accessible name, so the two never disagree.
type CounterpartyRole = "counterparty" | "recipient" | "sender";

// The recorded counterparty of a row, with its role. Null when the record
// names none — the detail line then comes from the summary and there is no
// full address to copy.
type ActivityCounterparty = {
  readonly address: string;
  readonly role: CounterpartyRole;
};

const COUNTERPARTY_PREPOSITION: Readonly<Record<CounterpartyRole, string>> = {
  counterparty: "With",
  recipient: "To",
  sender: "From",
};

const activityCounterparty = (
  entry: ActivityEntry,
  appearance: ActivityAppearance,
): ActivityCounterparty | null => {
  const address = entry.counterparty?.trim();
  if (!address) return null;
  const role: CounterpartyRole =
    appearance.direction === "in"
      ? "sender"
      : appearance.direction === "out" || appearance.type === "approval"
        ? "recipient"
        : "counterparty";
  return { address, role };
};

// The line beneath the verb: the counterparty when one is recorded, the swap
// pair, or whatever the summary says beyond the verb (and beyond the amount
// when the asset column carries it).
const activityDetail = (
  entry: ActivityEntry,
  appearance: ActivityAppearance,
  counterparty: ActivityCounterparty | null,
  hasAmount: boolean,
): string | null => {
  if (counterparty) {
    return `${COUNTERPARTY_PREPOSITION[counterparty.role]} ${accountLabel(counterparty.address)}`;
  }
  const summary = compactSummary(entry.summary.trim());
  if (appearance.type === "swap") {
    const pair = SWAP_PAIR.exec(summary);
    if (pair?.[1] && pair[2]) return `${pair[1]} to ${pair[2]}`;
  }
  if (appearance.type === "other") return summary.length === 0 ? null : summary;
  let remainder = summary.replace(LEADING_VERB, "");
  if (remainder === summary) return summary.length === 0 ? null : summary;
  remainder = remainder.replace(TRAILING_PRIVATELY, "");
  if (hasAmount) remainder = remainder.replace(LEADING_FIGURE, "");
  remainder = remainder.trim();
  return remainder.length === 0 ? null : capitalise(remainder);
};

/**
 * Everything one Activity row displays, derived from the entry and the current
 * prices. The asset amount needs the recorded amount and symbol; the fiat
 * figure additionally needs a direction (signed in or out, unsigned when the
 * value only moved between the owner's own balances), exactly one tracked
 * token with that symbol on the entry's network (a symbol shared by two
 * tracked tokens is ambiguous and yields nothing), and a price for it.
 */
export type ActivityRowModel = ActivityAppearance & {
  readonly amount: string | null;
  readonly counterparty: ActivityCounterparty | null;
  readonly detail: string | null;
  readonly fiat: string | null;
  readonly tokenAddress: string | null;
  readonly tokenSymbol: string | null;
};

/**
 * The tracked token an entry's recorded symbol names: the one tracked token on
 * the entry's network with that symbol, or `null` when none or several match.
 * An entry records only a symbol, so an ambiguous one is never guessed.
 */
export const activityTrackedToken = (
  entry: Pick<ActivityEntry, "networkId" | "token">,
  pricing?: ActivityPricing,
): ActivityPricing["tokens"][number] | null => {
  const symbol = entry.token?.trim();
  if (!symbol || !pricing) return null;
  const matches = pricing.tokens.filter(
    (token) =>
      token.networkId === entry.networkId && token.symbol.toLowerCase() === symbol.toLowerCase(),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
};

/**
 * Builds the display model for one entry. Without `pricing` the row still
 * shows its verb, detail, and asset amount; only the fiat delta is omitted.
 */
export const activityRowModel = (
  entry: ActivityEntry,
  pricing?: ActivityPricing,
): ActivityRowModel => {
  const appearance = activityAppearance(entry);
  const symbol = entry.token?.trim() || null;
  const rawAmount = entry.amount?.trim() || null;
  const amount = symbol && rawAmount ? `${compactActivityAmount(rawAmount)} ${symbol}` : null;
  const token = activityTrackedToken(entry, pricing);
  const price = token ? pricing?.prices[token.address] : undefined;
  const value =
    appearance.direction !== null && rawAmount !== null && price !== undefined
      ? tokenFiatValue(rawAmount, price)
      : null;
  const sign = appearance.direction === "in" ? "+" : appearance.direction === "out" ? "−" : "";
  const fiat =
    value === null || pricing === undefined
      ? null
      : `${sign}${formatFiat(value, pricing.currency)}`;
  const counterparty = activityCounterparty(entry, appearance);
  return {
    ...appearance,
    amount,
    counterparty,
    detail: activityDetail(entry, appearance, counterparty, amount !== null),
    fiat,
    tokenAddress: token?.address ?? null,
    tokenSymbol: symbol,
  };
};
