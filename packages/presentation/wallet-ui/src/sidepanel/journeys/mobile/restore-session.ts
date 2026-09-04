/**
 * Restoring accounts this wallet has lost but the phone still holds keys for.
 *
 * The key *is* the account: an address is derived from a public key, so a wallet
 * whose storage is gone can recover every account a phone signs for by being
 * told the keys it already has. Pairing cannot do that — pairing asks the phone
 * to create a key, which mints a new one and therefore a different address.
 *
 * Two exchanges, and the split is forced by frame size rather than chosen. A
 * reply carrying one public key and one signature measures 14,126 bytes, 86% of
 * `PQ_MAX_PAYLOAD_BYTES`; two of them do not fit. So the phone is asked once for
 * the accounts the user picked, then once per account for its proof.
 *
 * That shape buys two things beyond fitting. Each account is verified and stored
 * on arrival, so a refusal part way through costs that one account and the rest
 * still restore. And the per-account reply is byte for byte a pairing reply,
 * which means the wallet enrolls a restored key through the path it already has
 * — including the proof-of-possession gate, which is the only thing standing
 * between a public key and an address nobody can spend from.
 *
 * Every account needs its own biometric approval on the phone. That is not a
 * choice either: the keys are gated per use, fixed at the moment they were
 * generated, and a key that already exists cannot be re-policied.
 */

import {
  decodeMobilePqPairingResult,
  type MobilePqEnrollDraft,
  mobilePqDraftError,
} from "./pairing-reply";
import { fromBase64Url, toBase64Url } from "./wire-encoding";

/**
 * Restore wire version, separate from the pairing one because the shapes are
 * separate. The phone refuses a version it does not recognise rather than
 * guessing at fields.
 */
export const MOBILE_PQ_RESTORE_VERSION = 1;

/**
 * Encodes the request that opens the picker on the phone.
 *
 * No challenge. Nothing is signed in this exchange, and the wallet keeps exactly
 * one challenge outstanding — issuing one here would spend it on a round trip
 * that cannot use it, and leave two live values with one name.
 */
export const encodeMobilePqRestoreOffer = (input: { readonly networkId: string }): string =>
  toBase64Url(
    JSON.stringify({
      networkId: input.networkId,
      version: MOBILE_PQ_RESTORE_VERSION,
    }),
  );

/**
 * Encodes the request for one account's proof.
 *
 * `deviceId` is the phone's own name for the key, which is what the picker
 * returned. The phone refuses any name the user did not pick, so this cannot
 * reach past the selection.
 */
export const encodeMobilePqRestoreKeyOffer = (input: {
  readonly challenge: string;
  readonly deviceId: string;
  readonly networkId: string;
}): string =>
  toBase64Url(
    JSON.stringify({
      challenge: input.challenge,
      deviceId: input.deviceId,
      networkId: input.networkId,
      version: MOBILE_PQ_RESTORE_VERSION,
    }),
  );

/**
 * Decodes the picker's answer: the phone's names for the accounts the user
 * chose, in the order they were shown.
 *
 * Shape only, and deliberately strict about the names. An empty or non-string
 * entry would become an account nobody could ask for, and a duplicate would make
 * the run ask the same account twice and report the second as already present.
 */
export const decodeMobilePqRestoreList = (payload: string): readonly string[] | null => {
  const json = fromBase64Url(payload);
  if (json === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const { deviceIds, version } = record;
  if (version !== MOBILE_PQ_RESTORE_VERSION || !Array.isArray(deviceIds)) {
    return null;
  }
  const names = deviceIds.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (names.some((name) => name.length === 0) || new Set(names).size !== names.length) {
    return null;
  }
  return names;
};

/**
 * How one picked account turned out.
 *
 * `present` is not a failure: restoring into a wallet that already holds the
 * account is the expected outcome of running a restore twice, and reporting it
 * as an error would tell the user something is wrong when nothing is.
 */
type MobilePqRestoreOutcome = "restored" | "skipped" | "present";

/**
 * One account in a restore, and where it got to. `outcome` is absent while the
 * account is still being asked about.
 */
export type MobilePqRestoreEntry = {
  readonly deviceId: string;
  readonly outcome?: MobilePqRestoreOutcome;
  readonly reason?: string;
};

/**
 * The two restore exchanges over a connection that is already open.
 */
export type MobilePqRestoreDeviceCalls = {
  readonly restore: (offer: string) => Promise<string>;
  readonly restoreKey: (offer: string) => Promise<string>;
};

/** Copy shown when the phone's picker answer is not readable. */
export const MOBILE_PQ_RESTORE_LIST_INVALID =
  "The app did not send a readable list of accounts. Update the app and try again.";

/** Copy shown when the phone answers about an account that was not asked for. */
export const MOBILE_PQ_RESTORE_WRONG_ACCOUNT =
  "The app answered for a different account than the one requested.";

/**
 * What the vault says when the account is already in this wallet.
 *
 * Matched on the message because that is the only signal the background gives —
 * `storeMobilePqAccount` throws a plain `WalletError`. Single-sourced here so
 * the two spellings cannot drift apart silently; if the vault ever grows a code
 * for this, that is what should be read instead.
 */
export const MOBILE_PQ_ALREADY_STORED = "Account already exists";

/**
 * The run in one line, for the toast the panel leaves behind when it closes.
 *
 * Lives here rather than in the views because two surfaces say it — the toast
 * and, while the run is going, the progress screen — and two spellings of the
 * same tally would eventually disagree about what "restored" counts.
 */
export const mobilePqRestoreSummary = (entries: readonly MobilePqRestoreEntry[]): string => {
  const count = (outcome: MobilePqRestoreOutcome): number =>
    entries.filter((entry) => entry.outcome === outcome).length;
  const parts = [`Restored ${count("restored")} of ${entries.length}`];
  if (count("present") > 0) {
    parts.push(`${count("present")} already in this wallet`);
  }
  if (count("skipped") > 0) {
    parts.push(`${count("skipped")} skipped`);
  }
  return `${parts.join(", ")}.`;
};

/**
 * Every account and what became of it, one per line.
 *
 * Carried as the toast's `details` so the reasons survive the panel closing.
 * Without it a skipped account would be visible only as one that is not there,
 * and the reason — a declined approval, a dropped link, a refused proof — would
 * be gone with the screen.
 */
export const mobilePqRestoreDetail = (entries: readonly MobilePqRestoreEntry[]): string =>
  [
    mobilePqRestoreSummary(entries),
    ...entries.map(
      (entry) =>
        `${entry.deviceId}: ${entry.outcome ?? "not asked"}${
          entry.reason === undefined ? "" : ` — ${entry.reason}`
        }`,
    ),
  ].join("\n");

const settle = (
  entries: readonly MobilePqRestoreEntry[],
  deviceId: string,
  outcome: MobilePqRestoreOutcome,
  reason?: string,
): readonly MobilePqRestoreEntry[] =>
  entries.map((entry) =>
    entry.deviceId === deviceId
      ? { deviceId, outcome, ...(reason === undefined ? {} : { reason }) }
      : entry,
  );

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs one restore, start to finish, over a connection the caller has opened.
 *
 * Reports progress after every step, because each account costs the user a
 * biometric approval on the phone and a screen that does not move while they are
 * approving looks like one that has stopped.
 *
 * Never throws for a single account. Only a picker answer that cannot be read
 * ends the run — at that point there is no list to work through.
 */
export const runMobilePqRestore = async (deps: {
  readonly challenge: () => Promise<string>;
  readonly device: MobilePqRestoreDeviceCalls;
  readonly enroll: (draft: MobilePqEnrollDraft & { readonly challenge: string }) => Promise<void>;
  readonly networkId: string;
  readonly onProgress: (entries: readonly MobilePqRestoreEntry[]) => void;
}): Promise<readonly MobilePqRestoreEntry[]> => {
  const listed = decodeMobilePqRestoreList(
    await deps.device.restore(encodeMobilePqRestoreOffer({ networkId: deps.networkId })),
  );
  if (listed === null) {
    throw new Error(MOBILE_PQ_RESTORE_LIST_INVALID);
  }
  let entries: readonly MobilePqRestoreEntry[] = listed.map((deviceId) => ({ deviceId }));
  deps.onProgress(entries);

  for (const deviceId of listed) {
    try {
      // A fresh challenge per account, immediately before it is used. The
      // wallet keeps one outstanding and consumes it on use, so a challenge
      // reused across accounts would enroll the first and be refused as expired
      // for every one after it. Issuing it late also keeps the window between
      // issue and use down to one round trip.
      const challenge = await deps.challenge();
      const reply = await deps.device.restoreKey(
        encodeMobilePqRestoreKeyOffer({ challenge, deviceId, networkId: deps.networkId }),
      );
      const draft = decodeMobilePqPairingResult(reply);
      if (draft === null) {
        entries = settle(entries, deviceId, "skipped", MOBILE_PQ_RESTORE_LIST_INVALID);
        continue;
      }
      // The phone must answer about the account it was asked about. Without this
      // a mismatched reply would be stored under the requested name while
      // carrying another key's material, and the wallet would call one account
      // by another's name.
      if (draft.deviceId !== deviceId) {
        entries = settle(entries, deviceId, "skipped", MOBILE_PQ_RESTORE_WRONG_ACCOUNT);
        continue;
      }
      const invalid = mobilePqDraftError(draft);
      if (invalid !== null) {
        entries = settle(entries, deviceId, "skipped", invalid);
        continue;
      }
      await deps.enroll({ ...draft, challenge });
      entries = settle(entries, deviceId, "restored");
    } catch (error) {
      // A declined approval, a dropped link, a refused proof, or an account this
      // wallet already holds. The challenge this account spent is gone either
      // way, and the next account gets its own, so the run carries on.
      const reason = reasonOf(error);
      entries = reason.includes(MOBILE_PQ_ALREADY_STORED)
        ? settle(entries, deviceId, "present")
        : settle(entries, deviceId, "skipped", reason);
    } finally {
      // In a `finally` because the body above leaves by `continue` as well as by
      // falling through, and an account settled on one of those paths would
      // otherwise never be reported — it would sit on screen as still pending
      // while the run moved on without it.
      deps.onProgress(entries);
    }
  }
  return entries;
};
