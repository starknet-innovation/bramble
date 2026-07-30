/**
 * Stable error mapping for untrusted official-SDK and service failures.
 */

import { WalletError } from "../../shared/errors";
import {
  STRK20_INSUFFICIENT_BALANCE,
  STRK20_NOT_REGISTERED,
  STRK20_PRIVACY_LEAK,
  STRK20_SERVICE_UNAVAILABLE,
} from "./service";

/**
 * Collapses protocol-specific failures into the Wallet API's reviewed error
 * surface without exposing service internals to sites or UI state.
 */
export const mapStrk20ProtocolError = (error: unknown): never => {
  if (error instanceof WalletError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : "";
  if (/not registered|registration|viewing key.*not set/i.test(message)) {
    throw new WalletError(STRK20_NOT_REGISTERED);
  }
  if (/insufficient|not enough (?:private )?(?:funds|balance|notes)/i.test(message)) {
    throw new WalletError(STRK20_INSUFFICIENT_BALANCE);
  }
  if (/USER_LINKAGE|privacy leak/i.test(message)) {
    throw new WalletError(STRK20_PRIVACY_LEAK);
  }
  throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
};
