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

import { strk20SendFeeModel } from "@bramble/privacy/fee-bound";
import { formatTokenAmount, parseTokenAmount } from "@bramble/starknet/rpc";
import {
  type PoolRegistration,
  poolFeeAmountIn,
  resolveSendRoute,
  routeFor,
  type SendRoute,
  type SendRouteInput,
  type SendRouteResolution,
  spendableForRoute,
  type ValueBucket,
} from "@bramble/transactions/send-routes";
import { STRK_TOKEN_ADDRESS, STRK_TOKEN_DECIMALS, sameFelt } from "@bramble/wallet-model/networks";
import type { TokenBalance } from "../../../popup/responses/responses";
import { formatFri } from "../../shared/parts";
import type { PrivacyDisclosureState } from "../privacy/privacy-model";
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

const rawBalance = (value: string | undefined): bigint | null => {
  try {
    if (value === undefined || value === "") return null;
    const balance = BigInt(value);
    return balance >= 0n ? balance : null;
  } catch {
    return null;
  }
};

// A missing entry means "not known", not "zero": the balances may not have
// loaded, and refusing a send as unaffordable on that basis would be wrong.
const privateBalanceOf = (
  privacy: PrivacyDisclosureState,
  match: (entry: { readonly token: string; readonly tokenId: string }) => boolean,
): bigint | null => {
  const entry = privacy.value?.balances.find((candidate) => match(candidate));
  return entry === undefined ? null : rawBalance(entry.balance);
};

const publicBalanceOf = (
  balances: readonly TokenBalance[],
  match: (entry: TokenBalance) => boolean,
): bigint | null => {
  const entry = balances.find((candidate) => match(candidate));
  return entry === undefined ? null : rawBalance(entry.balance);
};

const tokenBalanceIn = (bucket: ValueBucket, context: TransferRouteContext): bigint | null =>
  bucket === "private"
    ? privateBalanceOf(context.privacy, (entry) => entry.tokenId === context.fields.tokenId)
    : publicBalanceOf(context.publicBalances, (entry) => entry.id === context.fields.tokenId);

const privateEntryFor = (context: TransferRouteContext, address: string) =>
  context.privacy.value?.balances.find((entry) => sameFelt(entry.token, address));

const publicEntryFor = (context: TransferRouteContext, address: string) =>
  context.publicBalances.find((entry) => sameFelt(entry.address, address));

// The source bucket's balance of an arbitrary token — used for the pool fee's
// own token, which is not necessarily the token being sent.
const balanceOfTokenIn = (
  bucket: ValueBucket,
  address: string,
  context: TransferRouteContext,
): bigint | null =>
  bucket === "private"
    ? rawBalance(privateEntryFor(context, address)?.balance)
    : rawBalance(publicEntryFor(context, address)?.balance);

const symbolOfToken = (context: TransferRouteContext, address: string): string | null =>
  privateEntryFor(context, address)?.symbol ?? publicEntryFor(context, address)?.symbol ?? null;

// The fee token's decimal scale: STRK's is fixed, the sent token's is on the
// form, and any other comes from the public token list. Private balance entries
// carry no scale, so a token known only there stays unknown.
const decimalsOfToken = (context: TransferRouteContext, address: string): number | null => {
  if (sameFelt(address, STRK_TOKEN_ADDRESS)) return STRK_TOKEN_DECIMALS;
  if (sameFelt(address, context.fields.tokenAddress)) {
    const decimals = Number(context.fields.tokenDecimals);
    return Number.isSafeInteger(decimals) ? decimals : null;
  }
  return publicEntryFor(context, address)?.decimals ?? null;
};

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
 * Relay availability comes from the privileged account-scoped disclosure. An
 * absent disclosure therefore fails private spending closed; it never guesses
 * that a relay exists.
 *
 * The fee token follows the same preference the relay quote applies: a relayed
 * batch pays in the token being sent when an independent reference bounds the
 * conversion, otherwise in the configured fee token. The account route always
 * pays the pool's on-chain STRK charge, so its fee token is STRK.
 */
const sendRouteInputFor = (context: TransferRouteContext): SendRouteInput => {
  const { fields } = context;
  const route = routeFor(fields.source, fields.destination);
  const state = context.privacy.value;
  const fallbackFeeToken = state?.feeToken ?? STRK_TOKEN_ADDRESS;
  const feeModel =
    route.submission === "relay"
      ? strk20SendFeeModel({
          convertedCeiling: rawBalance(privateEntryFor(context, fields.tokenAddress)?.feeCeiling),
          fallbackCeiling: rawBalance(privateEntryFor(context, fallbackFeeToken)?.feeCeiling),
          fallbackFeeToken,
          token: fields.tokenAddress,
        })
      : { convertedCeiling: null, feeToken: STRK_TOKEN_ADDRESS };
  return {
    amountRaw: rawAmount(fields.amount, fields.tokenDecimals),
    convertedFeeCeilingRaw: feeModel.convertedCeiling,
    destination: fields.destination,
    feeTokenAddress: feeModel.feeToken,
    feeTokenDecimals: decimalsOfToken(context, feeModel.feeToken),
    feeTokenSymbol:
      symbolOfToken(context, feeModel.feeToken) ??
      (sameFelt(feeModel.feeToken, STRK_TOKEN_ADDRESS) ? "STRK" : "fee token"),
    poolFeeFri: state?.poolFeeFri ? rawBalance(state.poolFeeFri) : null,
    recipient: fields.recipient || null,
    recipientRegistration: context.recipientRegistration,
    relayConfigured: state?.relayConfigured ?? false,
    senderAddress: context.senderAddress,
    senderRegistration: senderRegistration(context.privacy),
    source: fields.source,
    sourceFeeBalanceRaw: balanceOfTokenIn(fields.source, feeModel.feeToken, context),
    sourceTokenBalanceRaw: tokenBalanceIn(fields.source, context),
    tokenAddress: fields.tokenAddress,
    tokenDecimals: Number(fields.tokenDecimals) || 0,
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
 * The pool fee a composed send will reserve, formatted in the token that pays
 * it: STRK's exact charge exactly as the review prints it, or a converted fee's
 * bounded ceiling in its own token, read as "up to" because the relay's quote,
 * known only at review, may be lower. `null` when the amount or the fee token's
 * scale is not known yet, so no figure is ever guessed or shown as STRK.
 */
export const transferPoolFeeAmount = (context: TransferRouteContext): string | null => {
  const input = sendRouteInputFor(context);
  const amount = poolFeeAmountIn(input);
  if (amount === null) return null;
  if (sameFelt(input.feeTokenAddress, STRK_TOKEN_ADDRESS)) return formatFri(amount.toString());
  return input.feeTokenDecimals === null
    ? null
    : `up to ${formatTokenAmount(amount, input.feeTokenDecimals)} ${input.feeTokenSymbol}`;
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
 * card's label and for Max. An absent or malformed entry remains unknown: only
 * an RPC response containing zero may be rendered or used as a zero balance.
 */
export const balanceInBucket = (
  bucket: ValueBucket,
  context: TransferRouteContext,
): { readonly formatted: string | null; readonly raw: string | null } => {
  if (bucket === "private") {
    const entry = context.privacy.value?.balances.find(
      (candidate) => candidate.tokenId === context.fields.tokenId,
    );
    const raw = rawBalance(entry?.balance);
    return { formatted: entry?.formatted ?? null, raw: raw?.toString(10) ?? null };
  }
  const entry = context.publicBalances.find((candidate) => candidate.id === context.fields.tokenId);
  const raw = rawBalance(entry?.balance);
  return { formatted: entry?.formatted ?? null, raw: raw?.toString(10) ?? null };
};

/**
 * The largest amount the composed route can send, in raw token units, or `null`
 * when a required pool fee has not been read yet.
 */
export const transferSpendable = (context: TransferRouteContext): bigint | null =>
  spendableForRoute(transferRoute(context.fields), sendRouteInputFor(context));

/**
 * The inputs a shield's STRK need is computed from (issue 665): whether the
 * shielded token is STRK itself (by its canonical address, not its symbol or
 * amount), the amount in raw STRK units at STRK's canonical 18 decimals when
 * it is (null when the typed amount cannot be read), the public STRK balance,
 * and the pool fee as quoted. Figures are passed as read; `shieldStrkNeed`
 * parses them strictly. Null off the shield route or while the pool fee is
 * unknown.
 */
export const shieldStrkFunding = (
  fields: TransferFields,
  publicBalances: readonly TokenBalance[] | undefined,
  poolFeeFri: string | undefined,
): {
  readonly amount: bigint | null;
  readonly balance: string | null;
  readonly poolFeeFri: string;
  readonly shieldsStrk: boolean;
} | null => {
  if (transferRoute(fields).id !== "public-private" || poolFeeFri === undefined) return null;
  const strk = publicBalances?.find((entry) => sameFelt(entry.address, STRK_TOKEN_ADDRESS));
  const shieldsStrk = sameFelt(fields.tokenAddress, STRK_TOKEN_ADDRESS);
  let amount: bigint | null = null;
  try {
    amount = shieldsStrk ? parseTokenAmount(fields.amount, STRK_TOKEN_DECIMALS) : 0n;
  } catch {
    amount = null;
  }
  return { amount, balance: strk?.balance ?? null, poolFeeFri, shieldsStrk };
};

/**
 * True when a shield leaves no public STRK for its network fee. A shield's
 * network fee and pool fee are both paid from public STRK whatever token it
 * shields (issue 665). For a STRK shield that is an amount at least what the
 * route can spend once the pool fee is held back, which is what Max fills in;
 * for any other token it is a public STRK balance no larger than the pool fee.
 * False on any other route, or while the spendable amount, the STRK balance or
 * the pool fee is unknown.
 */
export const shieldLeavesNoStrkForGas = (context: TransferRouteContext): boolean => {
  const { fields } = context;
  if (transferRoute(fields).id !== "public-private") {
    return false;
  }
  if (!sameFelt(fields.tokenAddress, STRK_TOKEN_ADDRESS)) {
    const input = sendRouteInputFor(context);
    return (
      input.poolFeeFri !== null &&
      input.sourceFeeBalanceRaw !== null &&
      input.sourceFeeBalanceRaw <= input.poolFeeFri
    );
  }
  const spendable = transferSpendable(context);
  return spendable !== null && rawAmount(fields.amount, fields.tokenDecimals) >= spendable;
};
