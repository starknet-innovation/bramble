/**
 * The four ways value moves between a public and a private balance, and the
 * gates each one has to clear before it can be composed.
 *
 * Shielding and unshielding are sends: a source bucket, a destination bucket,
 * and a recipient. Expressing all four combinations as one table means the
 * submission route, the fee source, and the on-chain disclosure are answered by
 * data rather than by three parallel flows that each re-derive them. Pure and
 * dependency-free on purpose, so the side panel and the background can gate
 * against the same rules.
 *
 * Out of scope: network gas. The account route's gas is estimated by the
 * existing review path and warned about by the fee-affordability guard; only
 * the pool's per-batch STRK charge is reasoned about here.
 */

import {
  isNonZeroStarkFieldElement,
  STRK_TOKEN_ADDRESS,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";

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
 * Everything a route decision depends on. Balances are raw token units;
 * `sourceStrkBalanceRaw` is the STRK held in the *source* bucket, which is what
 * the pool fee is charged against, and equals `sourceTokenBalanceRaw` when the
 * token being sent is STRK.
 *
 * Either balance may be `null`, meaning not known yet — the account's balances
 * have not loaded, or the selected asset is absent from the list. A required
 * unknown balance blocks as pending: review cannot claim affordability until
 * the account- and network-scoped balance has hydrated.
 */
export type SendRouteInput = {
  readonly amountRaw: bigint;
  readonly destination: ValueBucket;
  readonly poolFeeFri: bigint | null;
  readonly recipient: string | null;
  readonly recipientRegistration: PoolRegistration;
  readonly relayConfigured: boolean;
  readonly senderAddress: string;
  readonly senderRegistration: PoolRegistration;
  readonly source: ValueBucket;
  readonly sourceStrkBalanceRaw: bigint | null;
  readonly sourceTokenBalanceRaw: bigint | null;
  readonly tokenAddress: string;
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

// The pool fee is charged in STRK out of the source bucket. When the token being
// sent is not STRK, the fee competes with a different balance, so it gets its own
// check and its own wording.
const feeBlocker = (
  input: SendRouteInput,
  poolFeeFri: bigint,
  tokenIsStrk: boolean,
): SendRouteBlocker | null => {
  if (tokenIsStrk) {
    return null;
  }
  if (input.sourceStrkBalanceRaw === null) {
    return wait(`Checking your ${input.source === "private" ? "private " : ""}STRK balance…`);
  }
  if (!shortOf(input.sourceStrkBalanceRaw, poolFeeFri)) {
    return null;
  }
  return refuse(
    input.source === "private"
      ? "Not enough private STRK to cover the pool fee"
      : "Not enough STRK to cover the pool fee",
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
      ? refuse(shortfall(input, route))
      : null;
  }
  if (input.poolFeeFri === null) {
    // The fee is governance-set and read live, so an unknown fee cannot be
    // reasoned about: block until it lands rather than compose an amount that
    // the pool would reject.
    return wait("Checking the pool fee…");
  }
  const tokenIsStrk = sameFelt(input.tokenAddress, STRK_TOKEN_ADDRESS);
  // The fee always leaves the source bucket, so when the token *is* STRK the
  // amount and the fee come out of one pot and must fit together.
  const needed = input.amountRaw + (tokenIsStrk ? input.poolFeeFri : 0n);
  if (shortOf(input.sourceTokenBalanceRaw, needed)) {
    return refuse(shortfall(input, route));
  }
  return feeBlocker(input, input.poolFeeFri, tokenIsStrk);
};

const shortfall = (input: SendRouteInput, route: SendRoute): string => {
  const asset = input.source === "private" ? `private ${input.tokenSymbol}` : input.tokenSymbol;
  return route.poolFeeRequired && sameFelt(input.tokenAddress, STRK_TOKEN_ADDRESS)
    ? `Not enough ${asset} for this amount plus the pool fee`
    : `Not enough ${asset}`;
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
  input: Pick<SendRouteInput, "poolFeeFri" | "sourceTokenBalanceRaw" | "tokenAddress">,
): bigint | null => {
  if (input.sourceTokenBalanceRaw === null) {
    return null;
  }
  if (!route.poolFeeRequired) {
    return input.sourceTokenBalanceRaw;
  }
  if (input.poolFeeFri === null) {
    return null;
  }
  if (!sameFelt(input.tokenAddress, STRK_TOKEN_ADDRESS)) {
    return input.sourceTokenBalanceRaw;
  }
  const spendable = input.sourceTokenBalanceRaw - input.poolFeeFri;
  return spendable > 0n ? spendable : 0n;
};
