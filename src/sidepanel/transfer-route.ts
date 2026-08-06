/**
 * Bridges the Send form and the panel's cached state onto the pure route
 * resolver.
 *
 * Balances are read from their own source of truth rather than from whatever the
 * form currently displays — the public balance from the account's token list,
 * the private one from shielded-balance discovery. A repaint rebuilds the form
 * from the selected asset, so a route derived from the form's displayed balance
 * would flip meaning mid-edit; deriving it from state cannot.
 */

import type { TokenBalance } from "../popup/responses";
import { STRK_TOKEN_ADDRESS, sameFelt } from "../starknet/networks";
import { parseTokenAmount } from "../starknet/rpc";
import {
  type PoolRegistration,
  resolveSendRoute,
  routeFor,
  type SendRoute,
  type SendRouteInput,
  type SendRouteResolution,
  spendableForRoute,
  type ValueBucket,
} from "../starknet/send-routes";
import type { PrivacyDisclosureState } from "./privacy-model";
import type { TransferFields } from "./transfer-model";

/**
 * Everything outside the form that a route decision reads.
 */
export type TransferRouteContext = {
  readonly fields: TransferFields;
  readonly privacy: PrivacyDisclosureState;
  /** The account's public token balances, as rendered in the asset picker. */
  readonly publicBalances: readonly TokenBalance[];
  readonly recipientRegistration: PoolRegistration;
  readonly senderAddress: string;
};

const rawAmount = (amount: string, decimals: string): bigint => {
  try {
    return parseTokenAmount(amount, Number(decimals) || 0);
  } catch {
    // A half-typed amount is not an error here; the resolver reports "enter an
    // amount" for zero, and the submit path validates the text separately.
    return 0n;
  }
};

const rawBalance = (value: string | undefined): bigint => {
  try {
    return value === undefined || value === "" ? 0n : BigInt(value);
  } catch {
    return 0n;
  }
};

const privateBalanceOf = (
  privacy: PrivacyDisclosureState,
  match: (entry: { readonly token: string; readonly tokenId: string }) => boolean,
): bigint => rawBalance(privacy.value?.balances.find((entry) => match(entry))?.balance);

const publicBalanceOf = (
  balances: readonly TokenBalance[],
  match: (entry: TokenBalance) => boolean,
): bigint => rawBalance(balances.find((entry) => match(entry))?.balance);

const tokenBalanceIn = (bucket: ValueBucket, context: TransferRouteContext): bigint =>
  bucket === "private"
    ? privateBalanceOf(context.privacy, (entry) => entry.tokenId === context.fields.tokenId)
    : publicBalanceOf(context.publicBalances, (entry) => entry.id === context.fields.tokenId);

const strkBalanceIn = (bucket: ValueBucket, context: TransferRouteContext): bigint =>
  bucket === "private"
    ? privateBalanceOf(context.privacy, (entry) => sameFelt(entry.token, STRK_TOKEN_ADDRESS))
    : publicBalanceOf(context.publicBalances, (entry) =>
        sameFelt(entry.address, STRK_TOKEN_ADDRESS),
      );

const senderRegistration = (privacy: PrivacyDisclosureState): PoolRegistration => {
  if (privacy.loading || !privacy.value) {
    return "unknown";
  }
  return privacy.value.registration === "pending"
    ? "pending"
    : privacy.value.registration === "registered"
      ? "registered"
      : "unregistered";
};

/**
 * Assembles the resolver input for the currently composed send.
 *
 * `relayConfigured` is reported as available because the panel cannot see the
 * network's relay configuration; the background remains the enforcement point
 * and fails closed when no unlinkable route exists.
 */
export const sendRouteInputFor = (context: TransferRouteContext): SendRouteInput => {
  const { fields } = context;
  return {
    amountRaw: rawAmount(fields.amount, fields.tokenDecimals),
    destination: fields.destination,
    poolFeeFri: context.privacy.value?.poolFeeFri
      ? rawBalance(context.privacy.value.poolFeeFri)
      : null,
    recipient: fields.recipient || null,
    recipientRegistration: context.recipientRegistration,
    relayConfigured: true,
    senderAddress: context.senderAddress,
    senderRegistration: senderRegistration(context.privacy),
    source: fields.source,
    sourceStrkBalanceRaw: strkBalanceIn(fields.source, context),
    sourceTokenBalanceRaw: tokenBalanceIn(fields.source, context),
    tokenAddress: fields.tokenAddress,
    tokenSymbol: fields.tokenSymbol,
  };
};

/**
 * Resolves the composed send, reporting an unavailable discovery service as its
 * own refusal — the resolver reasons about protocol state, not about whether the
 * wallet managed to read it.
 */
export const resolveTransferRoute = (context: TransferRouteContext): SendRouteResolution => {
  if (context.privacy.error && context.fields.source !== "public") {
    return { blocked: { pending: false, reason: "Private balances are unavailable right now" } };
  }
  if (context.privacy.error && context.fields.destination === "private") {
    return { blocked: { pending: false, reason: "Private balances are unavailable right now" } };
  }
  return resolveSendRoute(sendRouteInputFor(context));
};

/**
 * The route the composed buckets name, regardless of whether it is currently
 * sendable. Surfaces that describe a send — review copy, fee lines, progress
 * labels — need the route even while a gate is unmet.
 */
export const transferRoute = (fields: TransferFields): SendRoute =>
  routeFor(fields.source, fields.destination);

/**
 * The selected asset's balance in one bucket, raw and formatted, for the amount
 * card's label and for Max. Absent balances read as zero rather than throwing:
 * a bucket the account holds nothing in is a real state, not an error.
 */
export const balanceInBucket = (
  bucket: ValueBucket,
  context: TransferRouteContext,
): { readonly formatted: string; readonly raw: string } => {
  if (bucket === "private") {
    const entry = context.privacy.value?.balances.find(
      (candidate) => candidate.tokenId === context.fields.tokenId,
    );
    return { formatted: entry?.formatted ?? "0", raw: rawBalance(entry?.balance).toString(10) };
  }
  const entry = context.publicBalances.find((candidate) => candidate.id === context.fields.tokenId);
  return { formatted: entry?.formatted ?? "0", raw: rawBalance(entry?.balance).toString(10) };
};

/**
 * The largest amount the composed route can send, in raw token units, or `null`
 * when a required pool fee has not been read yet.
 */
export const transferSpendable = (context: TransferRouteContext): bigint | null =>
  spendableForRoute(transferRoute(context.fields), sendRouteInputFor(context));
