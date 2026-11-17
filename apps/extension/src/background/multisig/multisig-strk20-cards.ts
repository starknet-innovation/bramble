/**
 * Cards for the multisig private-balance panel. Each card's title and lines
 * are decoded from what the digest covers, against this wallet's own record:
 * account, network, pool function, token, amount, and recipient. A row that
 * does not bind or decode is left off the panel, so it cannot be signed.
 */

import type {
  MultisigStrk20Authorization,
  MultisigStrk20RelayRequest,
} from "@bramble/privacy/multisig-strk20";
import { isBoundToMultisig } from "@bramble/privacy/multisig-strk20-binding";
import type { MultisigStrk20RelayInvite } from "@bramble/privacy/multisig-strk20-relay-invite";
import {
  type MultisigStrk20ReviewScope,
  reviewMultisigStrk20Calls,
  reviewMultisigStrk20Relay,
  reviewMultisigStrk20TypedData,
} from "@bramble/privacy/multisig-strk20-review";
import { sameFelt } from "@bramble/wallet-model/networks";
import { multisigStrk20Binding } from "./multisig-strk20-scope";
import type { MultisigStrk20Session } from "./multisig-strk20-session";

/**
 * One card the private-balance panel can offer. `summary` and `lines` come
 * from the hashed calls or the typed data, never from a sender's label.
 */
export type MultisigStrk20PanelCard = {
  readonly id: string;
  readonly lines: readonly string[];
  readonly offer: "send" | "share" | "sign";
  readonly refresh: boolean;
  readonly summary: string;
};

const youSigned = (fragments: readonly { readonly publicKey: string }[], mine: string): boolean =>
  fragments.some((fragment) => sameFelt(fragment.publicKey, mine));

const authorizationCard = (
  row: MultisigStrk20Authorization,
  scalar: string,
  scope: MultisigStrk20ReviewScope,
  mine: string,
): MultisigStrk20PanelCard | null => {
  const review = reviewMultisigStrk20Calls(row.calls, scalar, scope);
  if (!review) return null;
  const signed = youSigned(row.fragments, mine);
  return {
    id: row.id,
    lines: review.lines,
    offer: !signed && row.state === "collecting" ? "sign" : "share",
    refresh: false,
    summary: review.title,
  };
};

const relayCard = (
  row: MultisigStrk20RelayRequest,
  scope: MultisigStrk20ReviewScope,
  mine: string,
  nowSeconds: number,
): MultisigStrk20PanelCard | null => {
  if (row.messageHash && row.typedData) {
    const review = reviewMultisigStrk20TypedData(row.typedData, row.messageHash, nowSeconds, scope);
    if (!review) return null;
    const signed = youSigned(row.fragments, mine);
    return {
      id: row.id,
      lines: review.lines,
      offer: row.state === "ready" ? "send" : signed ? "share" : "sign",
      refresh: true,
      summary: review.title,
    };
  }
  const review = reviewMultisigStrk20Relay(row, scope);
  return review
    ? { id: row.id, lines: review.lines, offer: "send", refresh: true, summary: review.title }
    : null;
};

const inviteCard = (
  row: MultisigStrk20RelayInvite,
  scope: MultisigStrk20ReviewScope,
  mine: string,
  nowSeconds: number,
): MultisigStrk20PanelCard | null => {
  const review = reviewMultisigStrk20TypedData(row.typedData, row.messageHash, nowSeconds, scope);
  if (!review) return null;
  const signed = youSigned(row.fragments, mine);
  return {
    id: row.id,
    lines: review.lines,
    offer: !signed && row.fragments.length < row.threshold ? "sign" : "share",
    refresh: false,
    summary: review.title,
  };
};

const cards = <T>(
  rows: readonly T[],
  card: (row: T) => MultisigStrk20PanelCard | null,
): readonly MultisigStrk20PanelCard[] =>
  rows.flatMap((row) => {
    const shown = card(row);
    return shown ? [shown] : [];
  });

/**
 * Panel cards for this multisig. Ready CallSet records stay visible so a
 * co-owner can return the fragment. Relays stay visible after a reload. A
 * co-owner's row must still match the live signer set to be shown.
 */
export const multisigStrk20PanelCards = async (
  session: MultisigStrk20Session,
  scalar: string,
  scope: MultisigStrk20ReviewScope,
  mine: string,
  nowSeconds: number,
): Promise<{
  readonly authorizations: readonly MultisigStrk20PanelCard[];
  readonly relays: readonly MultisigStrk20PanelCard[];
}> => {
  const binding = multisigStrk20Binding(session.context.record, session.config);
  const accountId = session.context.record.id;
  const stored = (await session.store.listAuthorizations(accountId, scalar)).filter((row) =>
    isBoundToMultisig(row, binding),
  );
  const relays = (await session.store.listRelays(accountId)).filter((row) =>
    isBoundToMultisig(row, binding),
  );
  const relayIds = new Set(relays.map((row) => row.id));
  const invites = (await session.store.listInvites(accountId)).filter(
    (row) => !relayIds.has(row.id) && isBoundToMultisig(row, binding),
  );
  return {
    authorizations: cards(stored, (row) => authorizationCard(row, scalar, scope, mine)),
    relays: [
      ...cards(relays, (row) => relayCard(row, scope, mine, nowSeconds)),
      ...cards(invites, (row) => inviteCard(row, scope, mine, nowSeconds)),
    ],
  };
};
