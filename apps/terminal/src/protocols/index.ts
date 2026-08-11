/**
 * Barrel for the trade terminal's protocol integrations. The five protocol
 * modules share function names (quoteSwap/buildSwapCalls across ekubo and avnu),
 * so each is re-exported as a namespace: import { ekubo, avnu, vesu, privacy,
 * extended } from "./index". Shared types and constants are
 * re-exported flat.
 */
export * as avnu from "./avnu/avnu";
export * from "./constants";
export * as ekubo from "./ekubo/ekubo";
export * as extended from "./extended/extended";
export * as privacy from "./privacy/privacy";
export * from "./types";
export * as vesu from "./vesu/vesu";
export {
  buildVesuRewardClaimCalls,
  buildVesuVaultClaimCalls,
  buildVesuVaultDepositCalls,
  buildVesuVaultRedeemCalls,
} from "./vesu/vesu-actions";
export {
  buildVesuMultiplyCloseCalls,
  buildVesuMultiplyIncreaseCalls,
  parseVesuMultiplyExactOutQuote,
  quoteVesuMultiplyClose,
  quoteVesuMultiplyIncrease,
  type VesuMultiplyExactOutQuote,
} from "./vesu/vesu-multiply";
