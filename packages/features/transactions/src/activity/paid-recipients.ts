/**
 * Recipients the user has actually paid from this wallet (audit #163), used to
 * widen the address-poisoning check beyond the address book: an attacker's
 * lookalike of an unsaved exchange deposit address is exactly as dangerous as a
 * lookalike of a saved contact.
 *
 * Trust boundary: only rows with `origin === "wallet"` count. Those are written
 * by the background when this wallet itself broadcast the transfer; rows
 * discovered from chain history or an explorer never carry the marker. Feeding
 * a chain-discovered counterparty into the trusted set would be worse than
 * useless — a planted "Sent 0 to L" row would make the lookalike L trusted and
 * flag the genuine recipient instead. Legacy rows without the marker
 * contribute nothing.
 */
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import type { ActivityEntry } from "./activity";

/**
 * An address scoped to the network it belongs to.
 */
export type NetworkAddress = {
  readonly address: string;
  readonly networkId: StarknetNetworkId;
};

/**
 * Per-network cap on remembered recipients: bounds the verifier's work and the
 * window an old, forgotten payee stays "known".
 */
export const MAX_PAID_RECIPIENTS_PER_NETWORK = 50;

/**
 * Returns the distinct counterparties of wallet-submitted rows, newest first,
 * at most {@link MAX_PAID_RECIPIENTS_PER_NETWORK} per network. Any kind counts
 * (ERC20 transfers, NFT sends and single-payment multisig intents all record a
 * counterparty) because `origin` is writer-controlled, so relaxing the kind
 * adds no attacker input. Pure; a row that is not wallet-origin with a valid
 * non-zero felt counterparty is skipped, never trusted.
 */
export const walletPaidRecipients = (
  entries: readonly ActivityEntry[],
): readonly NetworkAddress[] => {
  const seen = new Set<string>();
  const perNetwork = new Map<StarknetNetworkId, number>();
  const result: NetworkAddress[] = [];
  const newestFirst = [...entries].sort((left, right) => right.submittedAt - left.submittedAt);
  for (const entry of newestFirst) {
    if (entry.origin !== "wallet" || !entry.counterparty) {
      continue;
    }
    const address = canonicalFelt(entry.counterparty);
    if (address === null || !isNonZeroStarkFieldElement(address)) {
      continue;
    }
    const key = `${entry.networkId}:${address}`;
    const count = perNetwork.get(entry.networkId) ?? 0;
    if (seen.has(key) || count >= MAX_PAID_RECIPIENTS_PER_NETWORK) {
      continue;
    }
    seen.add(key);
    perNetwork.set(entry.networkId, count + 1);
    result.push({ address, networkId: entry.networkId });
  }
  return result;
};
