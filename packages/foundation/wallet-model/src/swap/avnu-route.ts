/**
 * AVNU exchange ROUTE SEMANTICS: the decoder that reads the aggregator's
 * `multi_route_swap` calldata into the handful of fields a swap review is
 * actually about, the equality set that binds those fields to the reviewed
 * intent, and the minimum-output floor that intent implies.
 *
 * Trust boundary: the calldata is UNTRUSTED text an aggregator returned, so
 * nothing here trusts a field to exist, to be a felt, or to be positioned where
 * a well-formed build would put it. Every accessor goes through the shared felt
 * network parsers (`asFelt`, `uint256Felts`, `canonicalFelt`) so an
 * absent, malformed, or over-wide limb fails closed instead of reading as zero.
 * Failure behaviour: {@link decodeAvnuRoute} returns null for ANY calldata it
 * cannot read exactly — a short header, a routes span that does not consume the
 * call, an unexpected selector — and the background build policy refuses the
 * build unsigned. Nothing here signs, fetches, or persists.
 *
 * PINNED LAYOUT. The field offsets below are read from AVNU's
 * `avnu-contracts-v2` at the exact commit this wallet reviewed,
 * `006e3ddd9ddae28be73336842684f7db55273a2f`:
 *
 *   multi_route_swap(
 *     sell_token_address: ContractAddress,   // felt 0
 *     sell_token_amount: u256,               // felts 1,2   (low, high)
 *     buy_token_address: ContractAddress,    // felt 3
 *     buy_token_amount: u256,                // felts 4,5
 *     buy_token_min_amount: u256,            // felts 6,7
 *     beneficiary: ContractAddress,          // felt 8
 *     integrator_fee_amount_bps: u128,       // felt 9
 *     integrator_fee_recipient: ContractAddress, // felt 10
 *     routes: Array<Route>,                  // felt 11 = length, then the span
 *   )
 *
 *   Route         = sell_token, buy_token, RouteSwap
 *   RouteSwap     = BRANCH_MARKER ++ BranchSwap  |  DirectSwap
 *   DirectSwap    = exchange_address, percent (u128), Array<felt252>
 *   BranchSwap    = DirectSwap, Array<AlternativeSwap>
 *   AlternativeSwap = DirectSwap's shape
 *
 * That layout is a PIN, exactly like the router address in ./avnu.ts: if the
 * exchange is upgraded to a different route encoding, this decoder stops
 * recognizing builds and every swap fails closed until the new layout is read
 * and reviewed. That is the intended direction — a wallet that guesses at an
 * unreviewed ABI is signing calldata nobody has read.
 */
import { asFelt, canonicalFelt, sameFelt, uint256Felts } from "../networks/networks";

/** Maximum felts accepted from an AVNU build, shared by both application boundaries. */
export const AVNU_MAX_CALLDATA_LENGTH = 2000;

/**
 * The single exchange entry point this wallet builds against. AVNU's exchange
 * also exposes an exact-OUT `swap_exact_token_to`, which carries a DIFFERENT
 * positional layout; the wallet only ever asks for exact-in quotes, so that
 * selector is deliberately not admitted rather than decoded speculatively.
 */
export const AVNU_MULTI_ROUTE_SWAP = "multi_route_swap";

/**
 * Ceiling on the integrator fee (basis points) a build may carry. The wallet
 * never requests an integrator fee, so any non-zero value here is unrequested;
 * the cap keeps an unrequested value from becoming a material one. Defence in
 * depth only — the exchange applies fees BEFORE its own minimum-output assert,
 * so {@link AvnuRoute.minBuyAmount} is what actually bounds the user's loss.
 */
export const AVNU_MAX_INTEGRATOR_FEE_BPS = 100n;

// Cairo short string "branch": the marker AVNU's hand-written RouteSwap Serde
// writes ahead of a Branch variant, and the only thing that distinguishes the
// two encodings. Compared exactly as the contract compares it.
const BRANCH_MARKER = 0x6272616e6368n;

const BPS_DENOMINATOR = 10_000n;

// The aggregator computes its own minimum from a float slippage over an
// 18-decimal quantity, so its result can sit a few units either side of the
// same arithmetic done in integers. One basis point of headroom keeps this
// floor rejecting a HOSTILE minimum rather than an honest rounding difference;
// it is four orders of magnitude below the value a tampered build would take.
const SLIPPAGE_ROUNDING_TOLERANCE_BPS = 1n;

// Positional field offsets of the pinned layout documented in the header.
const SELL_TOKEN_INDEX = 0;
const SELL_AMOUNT_INDEX = 1;
const BUY_TOKEN_INDEX = 3;
const BUY_AMOUNT_INDEX = 4;
const MIN_BUY_AMOUNT_INDEX = 6;
/**
 * Felt offset of `beneficiary`, the account a `multi_route_swap` pays its
 * proceeds to, in the pinned layout above. Exported so the pre-sign reviewer's
 * recipient vocabulary reads the payee from this one pin instead of a second
 * literal; it is a position only, and says nothing about whether the rest of
 * the span decodes.
 */
export const AVNU_BENEFICIARY_FELT_INDEX = 8;
const INTEGRATOR_FEE_BPS_INDEX = 9;
const INTEGRATOR_FEE_RECIPIENT_INDEX = 10;
const ROUTES_LENGTH_INDEX = 11;
const ROUTES_START_INDEX = 12;

/**
 * The security-relevant fields of one decoded AVNU route call. Addresses come
 * back in the single canonical `0x`-hex spelling, amounts as bigints, so a
 * caller compares values rather than spellings.
 */
export type AvnuRoute = {
  readonly beneficiary: string;
  readonly buyAmount: bigint;
  readonly buyToken: string;
  readonly integratorFeeBps: bigint;
  readonly integratorFeeRecipient: string;
  readonly minBuyAmount: bigint;
  readonly sellAmount: bigint;
  readonly sellToken: string;
};

/**
 * The reviewed swap, expressed in the same terms a decoded route is: what the
 * user is selling, how much of it, what they are buying, the account the
 * proceeds must land in, and the least they agreed to accept.
 */
export type AvnuRouteIntent = {
  readonly beneficiary: string;
  readonly buyToken: string;
  readonly minBuyAmount: bigint;
  readonly sellAmount: bigint;
  readonly sellToken: string;
};

const feltAt = (calldata: readonly string[], index: number): bigint | null =>
  asFelt(calldata[index]);

// One address slot, parsed through the shared felt parser first so an absent or
// empty slot fails closed instead of canonicalizing into address zero.
const addressAt = (calldata: readonly string[], index: number): string | null => {
  const raw = calldata[index];
  return raw !== undefined && asFelt(raw) !== null ? canonicalFelt(raw) : null;
};

const uint256At = (calldata: readonly string[], index: number): bigint | null =>
  uint256Felts(calldata[index], calldata[index + 1]);

// The length felt every serialized Cairo array opens with, read once for all
// three of them. A length that is absent, negative, or larger than the whole
// call can never be honoured, so it comes back as null rather than as a number
// the walkers below would then try to step over.
const spanLength = (calldata: readonly string[], offset: number): number | null => {
  const length = feltAt(calldata, offset);
  return length === null || length < 0n || length > BigInt(calldata.length) ? null : Number(length);
};

// A serialized Cairo array: a length felt then that many elements. Returns the
// offset just past it, or null when the declared length does not fit inside the
// call — that is what makes a truncated or padded span unrepresentable here.
const skipFeltSpan = (calldata: readonly string[], offset: number): number | null => {
  const length = spanLength(calldata, offset);
  if (length === null) {
    return null;
  }
  const end = offset + 1 + length;
  return end <= calldata.length ? end : null;
};

// Walks `count` consecutive values from `offset` with `skip`, or null the
// moment one of them cannot be measured — the shared step behind both the
// alternatives span and the routes span.
const skipEach = (
  calldata: readonly string[],
  offset: number,
  count: number,
  skip: (calldata: readonly string[], offset: number) => number | null,
): number | null => {
  let cursor = offset;
  for (let index = 0; index < count; index += 1) {
    const next = skip(calldata, cursor);
    if (next === null) {
      return null;
    }
    cursor = next;
  }
  return cursor;
};

// DirectSwap and AlternativeSwap share a shape: exchange_address, percent, and
// the exchange's own opaque parameters. Their contents pick pools, which the
// exchange's minimum-output assert already bounds, so only their LENGTH matters
// here — it is what keeps the header fields above provably aligned.
const skipSwapLeg = (calldata: readonly string[], offset: number): number | null =>
  skipFeltSpan(calldata, offset + 2);

const skipRouteSwap = (calldata: readonly string[], offset: number): number | null => {
  const marker = feltAt(calldata, offset);
  if (marker === null) {
    return null;
  }
  if (marker !== BRANCH_MARKER) {
    return skipSwapLeg(calldata, offset);
  }
  const principalEnd = skipSwapLeg(calldata, offset + 1);
  if (principalEnd === null) {
    return null;
  }
  const alternatives = spanLength(calldata, principalEnd);
  return alternatives === null
    ? null
    : skipEach(calldata, principalEnd + 1, alternatives, skipSwapLeg);
};

// Route = sell_token, buy_token, RouteSwap.
const skipRoute = (calldata: readonly string[], offset: number): number | null =>
  skipRouteSwap(calldata, offset + 2);

// Walks the whole routes array and reports where it ends. A build with no route
// is not a swap, so a zero length is refused here rather than downstream.
const routesEnd = (calldata: readonly string[]): number | null => {
  const count = spanLength(calldata, ROUTES_LENGTH_INDEX);
  return count === null || count < 1
    ? null
    : skipEach(calldata, ROUTES_START_INDEX, count, skipRoute);
};

/**
 * Decodes one AVNU route call into the fields the wallet reviews. Trust
 * boundary: `entrypoint` and `calldata` are untrusted aggregator output.
 * Returns null — never a partially read route — when the selector is not the
 * pinned one, when any header field is missing or not a felt, when a uint256
 * limb is out of range, or when the routes span does not consume the calldata
 * EXACTLY. Consuming it exactly is what proves the header felts really are the
 * header: trailing felts, a short span, or a padded one all mean the wallet is
 * reading a layout it has not reviewed, and the caller must fail closed.
 */
export const decodeAvnuRoute = (
  entrypoint: string,
  calldata: readonly string[],
): AvnuRoute | null => {
  if (entrypoint !== AVNU_MULTI_ROUTE_SWAP || calldata.length < ROUTES_START_INDEX) {
    return null;
  }
  const sellToken = addressAt(calldata, SELL_TOKEN_INDEX);
  const sellAmount = uint256At(calldata, SELL_AMOUNT_INDEX);
  const buyToken = addressAt(calldata, BUY_TOKEN_INDEX);
  const buyAmount = uint256At(calldata, BUY_AMOUNT_INDEX);
  const minBuyAmount = uint256At(calldata, MIN_BUY_AMOUNT_INDEX);
  const beneficiary = addressAt(calldata, AVNU_BENEFICIARY_FELT_INDEX);
  const integratorFeeBps = feltAt(calldata, INTEGRATOR_FEE_BPS_INDEX);
  const integratorFeeRecipient = addressAt(calldata, INTEGRATOR_FEE_RECIPIENT_INDEX);
  if (
    sellToken === null ||
    sellAmount === null ||
    buyToken === null ||
    buyAmount === null ||
    minBuyAmount === null ||
    beneficiary === null ||
    integratorFeeBps === null ||
    integratorFeeBps < 0n ||
    integratorFeeRecipient === null ||
    routesEnd(calldata) !== calldata.length
  ) {
    return null;
  }
  return {
    beneficiary,
    buyAmount,
    buyToken,
    integratorFeeBps,
    integratorFeeRecipient,
    minBuyAmount,
    sellAmount,
    sellToken,
  };
};

/**
 * Binds a decoded route to the reviewed intent, returning the user-facing
 * rejection for the FIRST field that disagrees, or null when every one of them
 * matches. Trust boundary: `route` is aggregator-authored and `intent` is
 * wallet-authored, so every comparison runs wallet-side; the route may never
 * supply both sides of one. Each field is a distinct message so a build refused
 * in the field can be diagnosed from a user report without re-running it.
 */
export const avnuRouteIntentError = (route: AvnuRoute, intent: AvnuRouteIntent): string | null => {
  if (!sameFelt(route.sellToken, intent.sellToken)) {
    return "swap build routed a token you are not selling";
  }
  if (route.sellAmount !== intent.sellAmount) {
    return "swap build routed an amount you did not review";
  }
  if (!sameFelt(route.buyToken, intent.buyToken)) {
    return "swap build bought a token you did not choose";
  }
  if (!sameFelt(route.beneficiary, intent.beneficiary)) {
    return "swap build routed the proceeds to another account";
  }
  if (route.minBuyAmount < intent.minBuyAmount) {
    return "swap build accepted less than the minimum you reviewed";
  }
  if (route.integratorFeeBps > AVNU_MAX_INTEGRATOR_FEE_BPS) {
    return "swap build charged an aggregator fee beyond the wallet's cap";
  }
  return null;
};

/**
 * The least the reviewed quote entitles the user to, in base units: the quoted
 * buy amount less the slippage the wallet asked the aggregator to build to.
 * This is a POLICY FLOOR, not a reproduction of the aggregator's own minimum —
 * the signed route may promise more, never less. Returns null for a
 * non-positive quote or a slippage outside (0, 1), so a caller that cannot
 * state a floor refuses the build instead of reviewing it against none.
 */
export const reviewedMinBuyAmount = (quotedBuyAmount: bigint, slippage: number): bigint | null => {
  if (quotedBuyAmount <= 0n || !Number.isFinite(slippage) || slippage <= 0 || slippage >= 1) {
    return null;
  }
  const toleranceBps =
    BigInt(Math.ceil(slippage * Number(BPS_DENOMINATOR))) + SLIPPAGE_ROUNDING_TOLERANCE_BPS;
  return toleranceBps >= BPS_DENOMINATOR
    ? null
    : (quotedBuyAmount * (BPS_DENOMINATOR - toleranceBps)) / BPS_DENOMINATOR;
};
