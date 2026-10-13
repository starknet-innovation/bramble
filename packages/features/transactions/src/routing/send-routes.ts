/**
 * The four ways value moves between a public and a private balance, and the
 * gates each one has to clear before it can be composed.
 *
 * Shielding and unshielding are sends: a source bucket, a destination bucket,
 * and a recipient. Expressing all four combinations as one table means the
 * submission route, the fee source, and the on-chain disclosure are answered by
 * data rather than by three parallel flows that each re-derive them. It does no
 * I/O and holds no state, so the side panel and the background can gate against
 * the same rules.
 *
 * Out of scope: network gas. The account route's gas is estimated by the
 * existing review path and warned about by the fee-affordability guard; only
 * the pool's per-batch STRK charge is reasoned about here.
 */

import { formatTokenAmount } from "@bramble/starknet/rpc";
import {
  isNonZeroStarkFieldElement,
  STRK_TOKEN_ADDRESS,
  sameFelt,
} from "@bramble/wallet-model/networks";

/**
 * Which balance a send reads from or writes to.
 */
export type ValueBucket = "private" | "public";

/**
 * A source/destination pair, named for stable use in copy and telemetry.
 */
export type SendRouteId = "private-private" | "private-public" | "public-private" | "public-public";

/**
 * What a route puts on chain for an observer to read.
 */
export type SendDisclosure = "amount" | "recipient" | "sender";

/**
 * Whether an address has registered its viewing key with the pool. `unknown`
 * means the answer has not arrived yet, which gates as a wait rather than a
 * refusal.
 */
export type PoolRegistration = "pending" | "registered" | "unknown" | "unregistered";

/**
 * Everything a route decision depends on. Balances are raw token units.
 *
 * `feeTokenAddress` is the token the pool fee will be charged in, as the relay
 * route selects it: the token being sent when a converted fee can be bounded,
 * otherwise the configured fee token. `poolFeeFri` is that charge when the fee
 * token is STRK, and `convertedFeeCeilingRaw` is the bounded charge in the fee
 * token's own units otherwise (`null` while it is still unknown).
 * `sourceFeeBalanceRaw` is the balance of `feeTokenAddress` in the *source*
 * bucket, and equals `sourceTokenBalanceRaw` when the fee token is the token
 * being sent.
 *
 * Either balance may be `null`, meaning not known yet — the account's balances
 * have not loaded, or the selected asset is absent from the list. A required
 * unknown balance blocks as pending: review cannot claim affordability until
 * the account- and network-scoped balance has hydrated.
 */
export type SendRouteInput = {
  readonly amountRaw: bigint;
  /**
   * The bounded converted fee in `feeTokenAddress` base units, when that token
   * is not STRK so no on-chain value denominates it. `null` while it is still
   * unknown. Ignored when the fee token is STRK, where `poolFeeFri` is exact.
   */
  readonly convertedFeeCeilingRaw: bigint | null;
  readonly destination: ValueBucket;
  /** The token the pool fee is charged in, as the relay route selects it. */
  readonly feeTokenAddress: string;
  /**
   * Decimal scale of `feeTokenAddress`, for stating a fee minimum. `null` when
   * the wallet does not know it, in which case no figure is stated.
   */
  readonly feeTokenDecimals: number | null;
  /** Display symbol of `feeTokenAddress`, for gate wording. */
  readonly feeTokenSymbol: string;
  readonly poolFeeFri: bigint | null;
  readonly recipient: string | null;
  readonly recipientRegistration: PoolRegistration;
  readonly relayConfigured: boolean;
  readonly senderAddress: string;
  readonly senderRegistration: PoolRegistration;
  readonly source: ValueBucket;
  /** The source bucket's balance of `feeTokenAddress`. */
  readonly sourceFeeBalanceRaw: bigint | null;
  readonly sourceTokenBalanceRaw: bigint | null;
  readonly tokenAddress: string;
  /** The sent token's decimal scale, used to render a required minimum. */
  readonly tokenDecimals: number;
  readonly tokenSymbol: string;
};

/**
 * A route and the properties every surface needs from it. `feeBucket` is always
 * the source bucket when a pool fee is charged — the pool pulls its STRK from
 * whoever spends — and `"none"` when no pool call is involved. The two buckets
 * are carried as data so copy can name them without parsing the id.
 */
export type SendRoute = {
  readonly destination: ValueBucket;
  readonly feeBucket: ValueBucket | "none";
  readonly id: SendRouteId;
  readonly poolFeeRequired: boolean;
  readonly reveals: readonly SendDisclosure[];
  readonly source: ValueBucket;
  readonly submission: "account" | "relay";
};

/**
 * Why a route cannot be composed yet. `pending` marks an answer still in
 * flight, which callers must not treat as a refusal: flipping an enabled
 * control off under a user because a re-check started is how a reviewed private
 * send silently became public.
 */
export type SendRouteBlocker = {
  readonly pending: boolean;
  readonly reason: string;
};

/**
 * Either the resolved route or the single reason it is unavailable.
 */
export type SendRouteResolution =
  | { readonly blocked: SendRouteBlocker; readonly route?: undefined }
  | { readonly blocked?: undefined; readonly route: SendRoute };

const ROUTES: Readonly<Record<SendRouteId, SendRoute>> = {
  // Spending private notes must never take the public account route: the pool
  // rejects it, and it would put the sender's address next to the spend.
  "private-private": {
    destination: "private",
    feeBucket: "private",
    id: "private-private",
    poolFeeRequired: true,
    reveals: [],
    source: "private",
    submission: "relay",
  },
  "private-public": {
    destination: "public",
    feeBucket: "private",
    id: "private-public",
    poolFeeRequired: true,
    reveals: ["amount", "recipient"],
    source: "private",
    submission: "relay",
  },
  // A deposit reveals who paid and how much; the note's owner stays hidden.
  "public-private": {
    destination: "private",
    feeBucket: "public",
    id: "public-private",
    poolFeeRequired: true,
    reveals: ["amount", "sender"],
    source: "public",
    submission: "account",
  },
  // A plain ERC-20 transfer: no pool call, so no pool fee.
  "public-public": {
    destination: "public",
    feeBucket: "none",
    id: "public-public",
    poolFeeRequired: false,
    reveals: ["amount", "recipient", "sender"],
    source: "public",
    submission: "account",
  },
};

/**
 * Returns the route for a source/destination pair. Total over both buckets, so
 * no caller has to handle a missing route.
 */
export const routeFor = (source: ValueBucket, destination: ValueBucket): SendRoute =>
  ROUTES[`${source}-${destination}` as SendRouteId];

const refuse = (reason: string): SendRouteBlocker => ({ pending: false, reason });
const wait = (reason: string): SendRouteBlocker => ({ pending: true, reason });

// The account's own pool registration, needed by every route that touches the
// pool — to spend notes, and to own the channel a deposit credits.
const senderBlocker = (input: SendRouteInput, route: SendRoute): SendRouteBlocker | null => {
  if (route.id === "public-public") {
    return null;
  }
  if (input.senderRegistration === "unknown") {
    return wait("Discovering your private balance…");
  }
  if (input.senderRegistration === "pending") {
    return wait("Waiting for your registration to be indexed…");
  }
  if (input.senderRegistration === "unregistered") {
    return refuse("Activate private balances before sending privately");
  }
  if (input.source === "private" && !input.relayConfigured) {
    // Without an unlinkable broadcast route there is no way to spend a note
    // without publishing the sender, so this fails closed rather than degrading.
    return refuse("No private relay is configured for this network");
  }
  return null;
};

const recipientBlocker = (input: SendRouteInput, route: SendRoute): SendRouteBlocker | null => {
  if (input.recipient === null || !isNonZeroStarkFieldElement(input.recipient)) {
    return refuse("Choose a recipient first");
  }
  const toSelf = sameFelt(input.recipient, input.senderAddress);
  if (route.id === "private-private" && toSelf) {
    return refuse("Private sends to the sending account are not supported");
  }
  // Crediting your own private balance is covered by your own registration; a
  // third party needs their own viewing key registered with the pool, for a
  // deposit exactly as for a private transfer — both write a note into the
  // recipient's channel, which is derived from that key.
  if (input.destination !== "private" || toSelf) {
    return null;
  }
  if (input.recipientRegistration === "registered") {
    return null;
  }
  if (input.recipientRegistration === "unregistered") {
    return refuse("The recipient has not activated private balances");
  }
  return wait("Checking the recipient's privacy registration…");
};

const shortOf = (balance: bigint | null, needed: bigint): boolean =>
  balance !== null && needed > balance;

// The pool fee's amount in the token it is charged in. STRK is the exact
// on-chain charge; any other token is the bounded ceiling derived from an
// independent price, so reserving it never understates what the relay may take.
const poolFeeAmountIn = (input: SendRouteInput): bigint | null =>
  sameFelt(input.feeTokenAddress, STRK_TOKEN_ADDRESS)
    ? input.poolFeeFri
    : input.convertedFeeCeilingRaw;

// The pool fee's size is unknown. The charge is governance-set and read live,
// so until it lands the gate waits rather than compose an amount the pool would
// reject. A non-STRK fee also needs a converted bound: once the pool fee itself
// has loaded, a missing bound means the fee token cannot be priced, which no
// amount of waiting fixes, so the gate refuses with the reason instead.
const unknownFeeBlocker = (input: SendRouteInput): SendRouteBlocker =>
  input.poolFeeFri !== null && !sameFelt(input.feeTokenAddress, STRK_TOKEN_ADDRESS)
    ? refuse(`The pool fee can't be priced in ${input.feeTokenSymbol} right now`)
    : wait("Checking the pool fee…");

const feeInSentToken = (input: SendRouteInput): boolean =>
  sameFelt(input.feeTokenAddress, input.tokenAddress);

const feeAssetLabel = (input: SendRouteInput): string =>
  `${input.source === "private" ? "private " : ""}${input.feeTokenSymbol}`;

// The pool fee leaves the source bucket in `feeTokenAddress`. When that is the
// token being sent, the amount and the fee come out of one pot and are checked
// together in `amountBlocker`; otherwise the fee competes with a different
// balance, so it gets its own check and its own wording.
const feeBlocker = (input: SendRouteInput, feeAmount: bigint): SendRouteBlocker | null => {
  if (feeInSentToken(input)) {
    return null;
  }
  if (input.sourceFeeBalanceRaw === null) {
    return wait(`Checking your ${feeAssetLabel(input)} balance…`);
  }
  if (!shortOf(input.sourceFeeBalanceRaw, feeAmount)) {
    return null;
  }
  const shortOfFee = `Not enough ${feeAssetLabel(input)} to cover the pool fee`;
  // The figure is the fee in its own token, the same charge the review states,
  // and is only given where that token's scale is known.
  return input.feeTokenDecimals === null
    ? refuse(shortOfFee)
    : refuse(
        `${shortOfFee}. You need at least ${formatTokenAmount(feeAmount, input.feeTokenDecimals)} ${input.feeTokenSymbol}.`,
      );
};

const amountBlocker = (input: SendRouteInput, route: SendRoute): SendRouteBlocker | null => {
  if (input.amountRaw <= 0n) {
    return refuse(
      "Enter an amount to send. Toggle the public/private button to shield or unshield.",
    );
  }
  if (input.sourceTokenBalanceRaw === null) {
    return wait(
      `Checking your ${input.source === "private" ? "private " : ""}${input.tokenSymbol} balance…`,
    );
  }
  if (!route.poolFeeRequired) {
    return shortOf(input.sourceTokenBalanceRaw, input.amountRaw)
      ? refuse(shortfall(input, route, input.amountRaw))
      : null;
  }
  const feeAmount = poolFeeAmountIn(input);
  if (feeAmount === null) {
    return unknownFeeBlocker(input);
  }
  // The fee always leaves the source bucket. When it is charged in the token
  // being sent, the amount and the fee come out of one pot and must fit
  // together; otherwise only the amount is checked here and the fee balance is
  // checked on its own.
  const samePot = feeInSentToken(input);
  const needed = input.amountRaw + (samePot ? feeAmount : 0n);
  if (shortOf(input.sourceTokenBalanceRaw, needed)) {
    return refuse(shortfall(input, route, needed));
  }
  return samePot ? null : feeBlocker(input, feeAmount);
};

// A refusal names the figure the user has to reach: the amount plus the pool fee
// when that fee leaves the same balance, otherwise the amount alone. Stating the
// minimum is what turns "not enough" into something the user can act on. The fee
// is the one the gate reserves in the token it is charged in, so the figure is
// exactly what the gate needs, whatever token pays the fee.
const shortfall = (input: SendRouteInput, route: SendRoute, needed: bigint): string => {
  const asset = input.source === "private" ? `private ${input.tokenSymbol}` : input.tokenSymbol;
  const minimum = `You need at least ${formatTokenAmount(needed, input.tokenDecimals)} ${input.tokenSymbol}.`;
  return route.poolFeeRequired && feeInSentToken(input)
    ? `Not enough ${asset} for this amount plus the pool fee. ${minimum}`
    : `Not enough ${asset}. ${minimum}`;
};

/**
 * Resolves a composed send into its route, or the one reason it cannot proceed.
 *
 * Gates run in the order a user meets them — who they are, who they are paying,
 * then how much — so the surfaced reason is the next thing to act on rather than
 * whichever check happened to fail first.
 */
export const resolveSendRoute = (input: SendRouteInput): SendRouteResolution => {
  const route = routeFor(input.source, input.destination);
  const blocked =
    senderBlocker(input, route) ?? recipientBlocker(input, route) ?? amountBlocker(input, route);
  return blocked ? { blocked } : { route };
};

/**
 * The largest amount this route can send, in raw token units: the source
 * balance, less the pool fee when that fee is charged in the same token. Returns
 * `null` when a required fee is not known yet, so Max stays unavailable rather
 * than offering an amount the pool would reject.
 *
 * Network gas is deliberately not reserved — the account route's estimate lands
 * later in review, and reserving a guess here would understate the balance.
 */
export const spendableForRoute = (
  route: SendRoute,
  input: Pick<
    SendRouteInput,
    | "convertedFeeCeilingRaw"
    | "feeTokenAddress"
    | "poolFeeFri"
    | "sourceTokenBalanceRaw"
    | "tokenAddress"
  >,
): bigint | null => {
  if (input.sourceTokenBalanceRaw === null) {
    return null;
  }
  if (!route.poolFeeRequired) {
    return input.sourceTokenBalanceRaw;
  }
  const feeAmount = sameFelt(input.feeTokenAddress, STRK_TOKEN_ADDRESS)
    ? input.poolFeeFri
    : input.convertedFeeCeilingRaw;
  if (feeAmount === null) {
    return null;
  }
  if (!sameFelt(input.feeTokenAddress, input.tokenAddress)) {
    return input.sourceTokenBalanceRaw;
  }
  const spendable = input.sourceTokenBalanceRaw - feeAmount;
  return spendable > 0n ? spendable : 0n;
};
