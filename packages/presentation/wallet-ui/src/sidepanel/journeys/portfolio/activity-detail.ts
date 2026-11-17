/**
 * The further facts an expanded Activity row shows (mc-wallet issue 480): the
 * full counterparty address, the fee the account paid, the network, and the
 * token's contract, and what a send was worth when it was submitted. Each fact
 * comes from the stored record alone. A fact the record does not hold, such as
 * the fee on an older or discovered row, is left out rather than estimated:
 * fiat is shown only at the price the row captured on submission, never at
 * today's price.
 */
import { escapeHtml } from "@bramble/core/html";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import type { ActivityEntry } from "@bramble/transactions/activity";
import {
  DEFAULT_TRACKED_TOKENS,
  STARKNET_NETWORKS,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import { formatFiat } from "../../shared/fiat";
import { formatFri, inlineCopyButton } from "../../shared/parts";

const fact = (term: string, value: string): string =>
  `<div><dt>${escapeHtml(term)}</dt><dd>${value}</dd></div>`;

// A whole identifier with its copy control, shown in full: the expansion is
// where the user reads an address, so it is not shortened there.
const identifier = (value: string, copyLabel: string): string =>
  `<code>${escapeHtml(value)}</code>${inlineCopyButton(value, copyLabel)}`;

// The decimals of a fee token, from the bundled set or the user's tracked
// tokens. A gasless fee is stored in base units without its scale, so a token
// known to neither shows no fee rather than a guessed figure.
const feeTokenDecimals = (
  entry: ActivityEntry,
  address: string,
  tracked: readonly TokenConfig[],
): number | undefined =>
  [...DEFAULT_TRACKED_TOKENS, ...tracked].find(
    (token) => token.networkId === entry.networkId && sameFelt(token.address, address),
  )?.decimals;

/**
 * What the account paid in network fees, as recorded: "Sponsored" when someone
 * else paid, the signed token fee for a gasless transaction, or the receipt's
 * fee in its own unit. Null when the record holds none, or a gasless fee's
 * token scale is unknown. A sponsor row never carries the account's own fee:
 * reconciliation leaves `feePaid` empty there.
 */
export const activityFeeText = (
  entry: ActivityEntry,
  tracked: readonly TokenConfig[] = [],
): string | null => {
  if (entry.feePayer === "sponsor") {
    return "Sponsored";
  }
  try {
    if (entry.userFee) {
      const decimals = feeTokenDecimals(entry, entry.userFee.tokenAddress, tracked);
      return decimals === undefined
        ? null
        : `${formatTokenAmount(BigInt(entry.userFee.amount), decimals)} ${entry.userFee.token}`;
    }
    if (entry.feePaid) {
      return entry.feePaid.unit === "FRI"
        ? formatFri(entry.feePaid.amount)
        : `${formatTokenAmount(BigInt(entry.feePaid.amount), 18)} ETH`;
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * The amount's worth at the unit price captured when the row was submitted, in
 * the currency it was priced in. Null when no price was captured, or when the
 * amount is not a plain positive number.
 */
const submittedValueText = (entry: ActivityEntry): string | null => {
  const price = entry.submittedPrice;
  const amount = Number(entry.amount?.trim() || Number.NaN);
  if (!price || !Number.isFinite(amount) || amount <= 0) return null;
  return formatFiat(amount * price.unitPrice, price.currency);
};

/** The counterparty fact, with the whole address on screen and copyable. */
export const counterpartyFact = (role: string, address: string): string =>
  fact(role, identifier(address, `Copy ${role.toLowerCase()} address`));

/**
 * The value at submission, fee, network and token contract facts, each only
 * when recorded.
 * `tracked` lends a gasless fee token its scale when it is not a built-in.
 */
export const activityRecordFacts = (
  entry: ActivityEntry,
  tracked: readonly TokenConfig[] = [],
): string => {
  const fee = activityFeeText(entry, tracked);
  const network = STARKNET_NETWORKS[entry.networkId]?.name;
  const value = submittedValueText(entry);
  return [
    value === null ? "" : fact("Value at submission", escapeHtml(value)),
    fee === null ? "" : fact("Network fee", escapeHtml(fee)),
    network === undefined ? "" : fact("Network", escapeHtml(network)),
    entry.tokenAddress === undefined
      ? ""
      : fact("Token contract", identifier(entry.tokenAddress, "Copy token contract address")),
  ].join("");
};
