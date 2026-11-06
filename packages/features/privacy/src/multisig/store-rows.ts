/**
 * Row rules for the multisig STRK20 store: per-multisig capacity, which rows
 * may make room, and how a co-owner's copy of a round merges with this one.
 * One multisig's traffic never evicts another multisig's rows, and a round
 * still collecting or waiting to be sent is never the row dropped.
 */

import { isRecord } from "@bramble/core/json";
import { sameMultisigSignerSet } from "./binding";
import {
  type MultisigStrk20Authorization,
  type MultisigStrk20RelayRequest,
  withMultisigStrk20Fragment,
} from "./records";
import {
  type MultisigStrk20RelayInvite,
  withMultisigStrk20RelayInviteFragment,
} from "./relay-invite";

const accountOf = (row: unknown): unknown => (isRecord(row) ? row["accountId"] : undefined);

/**
 * Inserts or replaces `record` by id. A new row for a multisig already at
 * `max` rows takes the slot of that multisig's oldest row `evictable` allows.
 * Returns null when there is no such row, so the caller reports `full`.
 */
export const placeMultisigStrk20Row = (
  rows: readonly unknown[],
  record: { readonly accountId: string; readonly id: string },
  max: number,
  evictable: (row: unknown) => boolean,
): readonly unknown[] | null => {
  const index = rows.findIndex((row) => isRecord(row) && row["id"] === record.id);
  if (index >= 0) return rows.map((row, at) => (at === index ? record : row));
  const own = rows.filter((row) => accountOf(row) === record.accountId);
  if (own.length < max) return [...rows, record];
  const victim = own.find(evictable);
  if (victim === undefined) return null;
  return [...rows.filter((row) => row !== victim), record];
};

/** Rows that belong to `accountId`. */
export const isMultisigStrk20RowFor = (row: unknown, accountId: string): boolean =>
  accountOf(row) === accountId ||
  (isRecord(row) &&
    typeof row["intentId"] === "string" &&
    row["intentId"].startsWith(`${accountId}:`));

const sameSigners = (
  left: { readonly signerPublicKeys: readonly string[]; readonly threshold: number },
  right: { readonly signerPublicKeys: readonly string[]; readonly threshold: number },
): boolean =>
  left.threshold === right.threshold &&
  sameMultisigSignerSet(left.signerPublicKeys, right.signerPublicKeys);

/**
 * The union of two verified copies of one CallSet round. Co-owners who sign in
 * parallel each return a different fragment; both count. Returns null when the
 * copies are not the same round.
 */
export const mergedMultisigStrk20Authorization = (
  current: MultisigStrk20Authorization,
  record: MultisigStrk20Authorization,
): MultisigStrk20Authorization | null => {
  if (
    current.summary !== record.summary ||
    current.hash !== record.hash ||
    JSON.stringify(current.calls) !== JSON.stringify(record.calls) ||
    !sameSigners(current, record)
  ) {
    return null;
  }
  let next = current;
  for (const fragment of record.fragments) {
    if (next.state === "ready") break;
    if (next.fragments.some((existing) => existing.publicKey === fragment.publicKey)) continue;
    const added = withMultisigStrk20Fragment(next, fragment);
    if (!added) return null;
    next = added;
  }
  return next;
};

/** The union of two verified copies of one relay invite, as for a CallSet. */
export const mergedMultisigStrk20Invite = (
  current: MultisigStrk20RelayInvite,
  record: MultisigStrk20RelayInvite,
): MultisigStrk20RelayInvite | null => {
  if (
    current.messageHash !== record.messageHash ||
    JSON.stringify(current.typedData) !== JSON.stringify(record.typedData) ||
    !sameSigners(current, record)
  ) {
    return null;
  }
  let next = current;
  for (const fragment of record.fragments) {
    if (next.fragments.length >= next.threshold) break;
    if (next.fragments.some((existing) => existing.publicKey === fragment.publicKey)) continue;
    const added = withMultisigStrk20RelayInviteFragment(next, fragment);
    if (!added) return null;
    next = added;
  }
  return next;
};

/** True when a stored relay would lose fragments or proof bytes to `record`. */
export const multisigStrk20RelayConflicts = (
  current: MultisigStrk20RelayRequest,
  record: MultisigStrk20RelayRequest,
): boolean =>
  current.proof.data !== record.proof.data ||
  !current.fragments.every((fragment) =>
    record.fragments.some((item) => item.publicKey === fragment.publicKey),
  );
