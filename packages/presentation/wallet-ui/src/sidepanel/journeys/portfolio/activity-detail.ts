/**
 * The further facts an expanded Activity row shows (mc-wallet issue 480): the
 * full counterparty address, the fee the account paid, the network, and the
 * token's contract. Each fact comes from the stored record alone. A fact the
 * record does not hold, such as the fee on an older or discovered row, is left
 * out rather than estimated, and no row shows a fiat value: today's price is
 * not what the transaction was worth.
 */
import { escapeHtml } from "@bramble/core/html";
import { APP_DIRECTORY, type AppDirectory } from "@bramble/permissions/app-directory";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import type { ActivityEntry } from "@bramble/transactions/activity";
import {
  DEFAULT_TRACKED_TOKENS,
  STARKNET_NETWORKS,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import { icon } from "../../shared/icons";
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
 * The listed app name for a row's recorded site (mc-wallet issue 749), or
 * null. Decided now, against the bundled directory, from the origin the
 * background recorded: a delisted site leaves the listing, so it loses the mark
 * on past rows too, and a row's summary text never counts.
 */
const activityListedApp = (
  entry: ActivityEntry,
  directory: AppDirectory = APP_DIRECTORY,
): string | null =>
  entry.dappOrigin === undefined ? null : (directory.listing(entry.dappOrigin)?.name ?? null);

/** The collapsed row's mark for a transaction a listed app requested. */
export const activityListedMark = (
  entry: ActivityEntry,
  directory: AppDirectory = APP_DIRECTORY,
): string => {
  const name = activityListedApp(entry, directory);
  return name === null
    ? ""
    : `<span class="tx-listed" title="${escapeHtml(`Listed app: ${name}`)}">${icon("check")}<span class="sr-only">Listed app: ${escapeHtml(name)}</span></span>`;
};

// The site a dapp transaction came from, with its listed name when it has one.
const siteFact = (entry: ActivityEntry, directory: AppDirectory): string => {
  if (entry.dappOrigin === undefined) return "";
  const name = activityListedApp(entry, directory);
  return fact(
    "Site",
    `${escapeHtml(entry.dappOrigin)}${name === null ? "" : `<span class="tx-listed-name">Listed app: ${escapeHtml(name)}</span>`}`,
  );
};

/** The counterparty fact, with the whole address on screen and copyable. */
export const counterpartyFact = (role: string, address: string): string =>
  fact(role, identifier(address, `Copy ${role.toLowerCase()} address`));

/**
 * The site, fee, network and token contract facts, each only when recorded.
 * `tracked` lends a gasless fee token its scale when it is not a built-in.
 */
export const activityRecordFacts = (
  entry: ActivityEntry,
  tracked: readonly TokenConfig[] = [],
  directory: AppDirectory = APP_DIRECTORY,
): string => {
  const fee = activityFeeText(entry, tracked);
  const network = STARKNET_NETWORKS[entry.networkId]?.name;
  return [
    siteFact(entry, directory),
    fee === null ? "" : fact("Network fee", escapeHtml(fee)),
    network === undefined ? "" : fact("Network", escapeHtml(network)),
    entry.tokenAddress === undefined
      ? ""
      : fact("Token contract", identifier(entry.tokenAddress, "Copy token contract address")),
  ].join("");
};
