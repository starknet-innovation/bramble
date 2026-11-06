/**
 * dApp-facing `wallet_addStarknetChain` handling. The wallet supports only its
 * built-in networks, so the request is validated and then answered at once: a
 * built-in chain is already added, and any other chain is unsupported. Nothing
 * is queued, prompted, or stored.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { normalizeWalletOrigin } from "@bramble/core/origin";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@bramble/permissions/blocklist";
import { networkIdForChainId } from "@bramble/wallet-model/networks";
import { isProviderChain, type ProviderChain } from "@bramble/wallet-protocol/add-chain";
import {
  type ExtensionIdentity,
  isClaimedSenderOrigin,
  type RuntimeSender,
} from "../routing/senders";
import type { RuntimeResponse } from "../runtime/runtime-types";

/**
 * Dependencies for the dapp add-chain handler.
 */
export type AddChainOpsDeps = {
  readonly extension: ExtensionIdentity;
  readonly guard?: OriginGuard;
};

// Parses a `wallet.addStarknetChain` runtime message crossed from the content
// bridge, re-validating the chain descriptor and normalizing the origin.
const readAddStarknetChainInput = (
  message: unknown,
): { readonly chain: ProviderChain; readonly origin: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["chain", "origin", "type"]) ||
    message["type"] !== "wallet.addStarknetChain" ||
    !isProviderChain(message["chain"])
  ) {
    return null;
  }
  const origin = normalizeWalletOrigin(message["origin"]);
  return origin ? { chain: message["chain"], origin } : null;
};

/**
 * Handles a dapp add-chain message; returns null for other message types. A
 * built-in chain is a no-op success with no prompt, per spec. Any other chain
 * is refused as unsupported (CHAIN_ID_NOT_SUPPORTED on the dapp wire) rather
 * than stored: the wallet has no custom-network support, so adding one could
 * only report a success the follow-up switch would contradict (issue 852).
 */
export const handleAddChainOps = async (
  deps: AddChainOpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  if (messageType !== "wallet.addStarknetChain") {
    return null;
  }
  const guard = deps.guard ?? DEFAULT_ORIGIN_GUARD;
  const input = readAddStarknetChainInput(message);
  if (!input) {
    return { error: "invalid add chain request" };
  }
  if (!isClaimedSenderOrigin(sender, deps.extension, input.origin)) {
    return { error: "sender origin mismatch" };
  }
  if (guard.isBlocked(input.origin)) {
    return { error: "origin blocked" };
  }
  // The same felt-value lookup wallet_switchStarknetChain uses, so a chain
  // reported as added is always one the follow-up switch accepts.
  return networkIdForChainId(input.chain.chainId) !== null
    ? { added: true, ok: true }
    : { error: "unsupported chain" };
};
