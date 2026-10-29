/**
 * The shared entry gate of the three pool routes (shield, private send,
 * unshield): parse the destination, resolve the active privacy context for the
 * chosen token, then apply the recipient policy. Split from ./strk20-send-ops
 * so the deposit route, which runs as a tracked job in its own module, opens
 * exactly the same gate as the relayed routes without an import cycle.
 */

import { canonicalFelt, isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import { activeAccountContext } from "../runtime/runtime-state";
import {
  type ActivePrivacyContext,
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";
import { refusePoisonedStrk20Recipients } from "./strk20-recipient-policy";

// The shared recipient policy, applied to the three pool routes before anything
// is prepared. It is the same function the dapp-facing prepare and invoke routes
// apply, so the two halves of the privacy product line cannot drift apart.
// Refusing at preparation means a poisoned recipient never reaches a reviewed,
// digested preparation the user could confirm — so a preparation that exists is
// one whose recipient passed.
const refusePoisonedPoolRecipient = (
  context: ActivePrivacyContext,
  recipient: string,
): { readonly error: string } | null =>
  refusePoisonedStrk20Recipients(context.accountContext.account, context.preferences, [
    { recipient, token: context.token.address },
  ]);

/**
 * One entry gate for the three pool routes: parse the destination felt, resolve
 * the active privacy context for the chosen token, then apply the shared
 * recipient policy — in that order, so no route can be prepared for an address
 * the wallet refuses to pay. Returns the resolved context and canonical
 * recipient, or the error response the caller returns unchanged.
 */
export const openPoolRoute = async (
  deps: Strk20WalletOpsDeps,
  input: { readonly recipient: string; readonly tokenId: string },
): Promise<
  | { readonly context: ActivePrivacyContext; readonly recipient: string }
  | { readonly error: string }
> => {
  const recipient = canonicalFelt(input.recipient);
  if (recipient === null || !isNonZeroStarkFieldElement(recipient)) {
    return { error: "Enter a valid Starknet address" };
  }
  // User-initiated: the user composed a send and asked for a preparation.
  const context = await resolvePrivacyContext(deps, {
    active: await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    tokenId: input.tokenId,
  });
  if ("error" in context) return context;
  return refusePoisonedPoolRecipient(context, recipient) ?? { context, recipient };
};
