/**
 * The AVNU build-output policy gate: the one place that decides whether a call
 * set the aggregator returned is the swap the user reviewed.
 *
 * Trust boundary: `built` is UNTRUSTED — it is whatever /swap/v3/build replied,
 * narrowed to felts and entrypoint identifiers by `@bramble/transactions/avnu` and
 * nothing more — while `intent` is wallet-side throughout: the pair comes from
 * the user's TRACKED token registry, the beneficiary from the unlocked account,
 * the counterparty from the network's pin, and the minimum from the reviewed
 * quote. No equality here has both sides chosen by the response. Pure: no
 * clock, no network, no storage, no signing. Failure behaviour: every rejection
 * is a string the caller returns unsigned, and an admitted build comes back
 * with its DECODED route so the confirm receipt can state what was bound rather
 * than what was hoped for.
 */
import { isAvnuSwapEntrypoint, MAX_SWAP_CALLS } from "@bramble/transactions/avnu";
import {
  type AvnuRoute,
  avnuRouteIntentError,
  decodeAvnuRoute,
} from "@bramble/transactions/avnu-route";
import type { DecodedCall } from "@bramble/transactions/verify";
import { isApproveEntrypoint } from "@bramble/transactions/verify-selectors";
import { sameFelt, uint256Felts } from "@bramble/wallet-model/networks";

/**
 * One call exactly as the aggregator returned it, already narrowed to felts and
 * an entrypoint identifier by `@bramble/transactions/avnu`.
 */
export type BuiltCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

/**
 * The intent the user reviewed and the build must stay inside: this account
 * selling exactly this amount of this token for at least this much of that
 * token, into its own address, against the counterparty the WALLET pinned for
 * the active network (never one the aggregator named).
 */
export type SwapIntent = {
  readonly buyTokenAddress: string;
  readonly minBuyAmount: bigint;
  readonly routerAddress: string;
  readonly sellAmount: string;
  readonly sellTokenAddress: string;
  readonly takerAddress: string;
};

/**
 * Either a rejection (nothing is frozen for review) or the decoded route the
 * admitted build carries, which is what the confirm receipt then states.
 */
export type BuildPolicyResult =
  | { readonly error: string; readonly route?: never }
  | { readonly error?: never; readonly route: AvnuRoute };

// Per-approval part of the gate: approvals only ever on the sell token, for the
// exact quoted amount, naming the pinned router as spender. Returns the
// rejection, or null when the call is not an approval or is an acceptable one.
const approvalCallPolicyError = (call: BuiltCall, intent: SwapIntent): string | null => {
  // Which selectors grant spend is defined once, by the call verifier
  // (isApproveEntrypoint): a spelling the reviewer decodes as an approve must be
  // a spelling this policy gate sees as one, or a build could route an approval
  // past the sell-token restriction under a selector only one of them knows.
  if (!isApproveEntrypoint(call.entrypoint)) {
    return null;
  }
  // Additive allowance selectors cannot encode the exact reviewed post-state:
  // the response does not control (or even report) the existing allowance.
  if (call.entrypoint !== "approve") {
    return "swap build requested an additive token allowance";
  }
  if (!sameFelt(call.contractAddress, intent.sellTokenAddress)) {
    return "swap build touched an unexpected token approval";
  }
  // Through the one shared uint256 join, never a local `<< 128n`: the limb pair
  // this gate compares must be read exactly as the allowance decoder and the
  // reviewer read it, and a missing or malformed limb has to fail closed here
  // rather than read as zero and let a `(0, huge)` spelling of an approval past
  // the quoted-amount check.
  const allowance = uint256Felts(call.calldata[1], call.calldata[2]);
  if (call.calldata.length !== 3 || allowance === null || allowance !== BigInt(intent.sellAmount)) {
    return "swap build requested an unexpected token allowance";
  }
  if (!sameFelt(call.calldata[0] ?? "0x0", intent.routerAddress)) {
    return "swap build approved an unexpected spender";
  }
  return null;
};

// Positive allowlist for everything that is not the approval: the pinned AVNU
// router, through its pinned swap entry point. A negative rule ("not a
// transfer") is not a description of a swap — it admits set_approval_for_all,
// burn, upgrade, and every other selector.
const routeCounterpartyError = (call: BuiltCall, intent: SwapIntent): string | null => {
  if (!sameFelt(call.contractAddress, intent.routerAddress)) {
    return "swap build called a contract that is not the AVNU router";
  }
  return isAvnuSwapEntrypoint(call.entrypoint)
    ? null
    : "swap build called an entrypoint that is not an AVNU swap";
};

// The half that makes the review mean something: the admitted call's CALLDATA,
// decoded against the pinned exchange ABI and bound field by field to the
// reviewed intent. Contract and selector alone leave the aggregator naming the
// account the proceeds land in and the minimum the chain will enforce, both
// invisible behind an identical "Call multi_route_swap on 0x…" line. Judged
// only after the counterparty rule has cleared every non-approval call, so an
// injected call on a foreign contract is still reported as the foreign contract
// it is.
const routeIntentPolicy = (call: BuiltCall, intent: SwapIntent): BuildPolicyResult => {
  const route = decodeAvnuRoute(call.entrypoint, call.calldata);
  if (route === null) {
    return { error: "swap build returned a route the wallet could not decode" };
  }
  const mismatch = avnuRouteIntentError(route, {
    beneficiary: intent.takerAddress,
    buyToken: intent.buyTokenAddress,
    minBuyAmount: intent.minBuyAmount,
    sellAmount: BigInt(intent.sellAmount),
    sellToken: intent.sellTokenAddress,
  });
  return mismatch === null ? { route } : { error: mismatch };
};

// The spend half of the gate: exactly one approval, on the sell token, for the
// quoted amount, naming the pinned router — and no direct transfer anywhere in
// the build. The wallet always asks for the approval (`includeApprove`), and it
// is what states the exact spend the user is consenting to, so a build without
// one is a build with no reviewable spend boundary. The transfer rule reads the
// verifier's own decode, so every transfer spelling it knows is covered without
// a second list; it is defence in depth behind the route allowlist, never the
// only gate.
const approvalSetError = (
  built: readonly BuiltCall[],
  decoded: readonly DecodedCall[],
  intent: SwapIntent,
): string | null => {
  for (const call of built) {
    const error = approvalCallPolicyError(call, intent);
    if (error) {
      return error;
    }
  }
  const approvals = built.filter((call) => isApproveEntrypoint(call.entrypoint));
  if (approvals.length > 1) {
    return "swap build returned multiple token approvals";
  }
  if (approvals.length === 0) {
    return "swap build omitted the sell token approval";
  }
  return decoded.some((call) => call.kind === "transfer")
    ? "swap build requested a direct token transfer"
    : null;
};

/**
 * The build-output policy gate. The aggregator's response is UNTRUSTED and the
 * wallet asked it for ONE swap of one exact amount, so the COMPLETE returned
 * call set is judged against that intent: the approval set above, plus exactly
 * one swap call, on the network's PINNED router (`@bramble/transactions/avnu`), through
 * its pinned entry point, whose calldata DECODES against the pinned exchange
 * ABI and names the reviewed sell token and amount, the reviewed buy token,
 * this account as the beneficiary, and a minimum output no worse than the
 * reviewed quote allows. Counterparty, selector, and every economically
 * meaningful field of the route are therefore checked against a WALLET-side
 * intent, never inferred from the response. The residual an aggregator keeps is
 * which pools the route hops — a choice the exchange's own minimum-output
 * assert already bounds. A second swap call could only be a duplicate demand on
 * the one reviewed allowance, which no receipt can honestly describe, so it is
 * refused. Anything outside the admitted shape fails closed with a rejection.
 */
export const buildPolicy = (
  built: readonly BuiltCall[],
  decoded: readonly DecodedCall[],
  intent: SwapIntent,
): BuildPolicyResult => {
  if (built.length > MAX_SWAP_CALLS) {
    return { error: "swap build returned too many calls" };
  }
  const spendError = approvalSetError(built, decoded, intent);
  if (spendError) {
    return { error: spendError };
  }
  const route = built.filter((call) => !isApproveEntrypoint(call.entrypoint));
  const only = route[0];
  if (only === undefined) {
    return { error: "swap build returned no swap call" };
  }
  for (const call of route) {
    const error = routeCounterpartyError(call, intent);
    if (error) {
      return { error };
    }
  }
  if (route.length > 1) {
    return { error: "swap build returned more than one swap call" };
  }
  return routeIntentPolicy(only, intent);
};
