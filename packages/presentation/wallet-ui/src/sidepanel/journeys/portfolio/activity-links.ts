/**
 * Render-time linking between a local "signed for relay" row and the on-chain
 * execution a scan found for it. The two stay distinct stored rows
 * (authorisation vs. submission); this only pairs them for display, and only
 * when the pairing is unambiguous.
 *
 * A pair must share account, network, SNIP-9 revision and nonce. A nonce can in
 * principle be signed twice, so a group with more than one signed row, or more
 * than one execution, is left unlinked rather than guessing which execution
 * belongs to which authorisation. Pure — no DOM, no clock.
 */
import type { ActivityEntry } from "@bramble/transactions/activity";
import { canonicalFelt } from "@bramble/wallet-model/networks";

/**
 * The counterpart of a linked relay pair: what the other row is.
 */
export type RelayLink = {
  readonly counterpart: ActivityEntry;
  readonly kind: "execution" | "signed";
};

const isSignedRow = (entry: ActivityEntry): boolean => entry.kind === "relay-signed";

const isExecutionRow = (entry: ActivityEntry): boolean => entry.origin === "relay";

/**
 * The pairing key for a relay row, or null when the row is not part of a relay
 * pair or carries no SNIP-9 detail. Field separators are NUL escapes (never a
 * raw control byte in source) so no felt-derived value can alias another key.
 */
export const relayLinkKey = (entry: ActivityEntry): string | null => {
  const detail = entry.snip9;
  if (detail === undefined || (!isSignedRow(entry) && !isExecutionRow(entry))) {
    return null;
  }
  const nonce = canonicalFelt(detail.nonce) ?? detail.nonce;
  return `${entry.networkId}\u0000${entry.accountId}\u0000${detail.revision}\u0000${nonce}`;
};

/**
 * Pairs signed-for-relay rows with the execution that carried them. Only a
 * group with exactly one signed row and exactly one execution links; anything
 * ambiguous stays unlinked, and the two rows keep rendering independently.
 */
export const relayLinks = (
  entries: readonly ActivityEntry[],
): ReadonlyMap<ActivityEntry, RelayLink> => {
  const groups = new Map<
    string,
    { readonly executions: ActivityEntry[]; readonly signed: ActivityEntry[] }
  >();
  for (const entry of entries) {
    const key = relayLinkKey(entry);
    if (key === null) {
      continue;
    }
    const group = groups.get(key) ?? { executions: [], signed: [] };
    (isSignedRow(entry) ? group.signed : group.executions).push(entry);
    groups.set(key, group);
  }
  const links = new Map<ActivityEntry, RelayLink>();
  for (const group of groups.values()) {
    const [signedRow] = group.signed;
    const [executionRow] = group.executions;
    if (group.signed.length !== 1 || group.executions.length !== 1) {
      continue;
    }
    if (signedRow === undefined || executionRow === undefined) {
      continue;
    }
    links.set(signedRow, { counterpart: executionRow, kind: "execution" });
    links.set(executionRow, { counterpart: signedRow, kind: "signed" });
  }
  return links;
};
