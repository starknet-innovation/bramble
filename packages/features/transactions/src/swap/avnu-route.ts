/**
 * Compatibility surface for the pure AVNU decoder shared with Terminal.
 * The foundation module owns layout and intent validation; this feature keeps
 * its existing public API without introducing a second protocol definition.
 */
export {
  AVNU_MAX_INTEGRATOR_FEE_BPS,
  AVNU_MULTI_ROUTE_SWAP,
  type AvnuRoute,
  type AvnuRouteIntent,
  avnuRouteIntentError,
  decodeAvnuRoute,
  reviewedMinBuyAmount,
} from "@bramble/wallet-model/avnu-route";
