/**
 * Side-panel controller for enrolling a paired post-quantum device.
 *
 * The order is forced by the security property, not by taste. The wallet issues
 * a random challenge first; the device signs it; only then does the wallet learn
 * the public key it is being asked to enroll. That way the signature it verifies
 * is over bytes the wallet chose, so a key the device cannot sign for is refused
 * before an address is derived from it — an address derived from the wrong key is
 * unspendable, and anything funded there is lost with no way back.
 *
 * Everything the user supplies is pasted, because the transport is a clipboard:
 * the public key, the class hash, and the signature. That is what lets the whole
 * flow run against a fixture key from a terminal, with no phone in the loop. The
 * account's constructor argument is not asked for — it is derived from the key.
 *
 * The class hash is asked for rather than derived. The contract shares one class
 * across every user, so there will be a single hash to pin once it has a
 * reviewed release — until then the only class that exists is whichever one was
 * declared on the network being tested, and inheriting another family's class
 * would derive an address nobody holds the key for.
 *
 * Fail-closed throughout: a malformed paste is refused here, a rejected proof of
 * possession is refused by the background, and neither stores anything.
 */

import {
  decodeMobilePqPairingResult,
  MOBILE_PQ_PAIRING_VERSION,
  type MobilePqEnrollDraft,
  mobilePqDraftError,
} from "./pairing-reply";
import type { MobilePqRestoreDeviceCalls, MobilePqRestoreEntry } from "./restore-session";
import { runMobilePqRestore } from "./restore-session";
import { toBase64Url } from "./wire-encoding";

/*
 * ---------------------------------------------------------------------------
 * The pairing wire shapes
 * ---------------------------------------------------------------------------
 *
 * Kept in this module rather than their own: this controller is the only
 * consumer, and it already owns the view model the offer is rendered from.
 */
/**
 * Encodes the offer the device reads.
 *
 * `challenge` is passed through verbatim, never re-spelled. The background
 * compares the returned challenge to the outstanding one as a string, and it is
 * also the value the device pads back to 32 big-endian bytes to sign — so a
 * shorter spelling of the same felt is both a failed comparison and a different
 * signed message.
 */
export const encodeMobilePqPairingOffer = (input: {
  readonly challenge: string;
  readonly networkId: string;
}): string =>
  toBase64Url(
    JSON.stringify({
      challenge: input.challenge,
      networkId: input.networkId,
      version: MOBILE_PQ_PAIRING_VERSION,
    }),
  );

/**
 * The phase the panel renders. `collect` is the working state — the challenge is
 * on screen to copy and every field is open, because with a clipboard the user
 * moves between this screen and their device freely rather than in steps the
 * controller should sequence.
 */
type MobilePqEnrollPhase =
  | { readonly kind: "loading" }
  | { readonly kind: "collect" }
  // Distinct from `enrolling` on purpose: one is waiting on a phone across a
  // radio, the other is the background checking a proof it already has. Sharing
  // a phase made a stalled Bluetooth reply render as "verifying the signature
  // against the key you pasted", which named the wrong stage and a transport the
  // user had not used.
  | { readonly kind: "reaching" }
  | { readonly kind: "enrolling" }
  // Restore is its own phase rather than a reuse of `reaching` or `enrolling`,
  // because it is neither: it is a run over several accounts, each with its own
  // approval on the phone, and the screen has to say which one. There is no
  // finished phase — a finished run closes the panel and leaves a toast.
  | { readonly kind: "restoring" }
  | { readonly kind: "error"; readonly message: string };

/**
 * The full enrollment view: the phase and the challenge the device must sign.
 * `null` means the journey is closed.
 */
export type MobilePqEnrollView = {
  /**
   * Whether Bluetooth is reachable at all, which decides whether the screen
   * offers a choice. When it is not, the copy-and-paste path is simply the
   * screen rather than a fallback the user has to find.
   */
  readonly bluetoothAvailable: boolean;
  readonly challenge: string;
  /**
   * The whole offer as one base64url string. What the user copies: the challenge
   * alone would leave the phone guessing which network it is pairing for.
   */
  readonly offer: string;
  readonly phase: MobilePqEnrollPhase;
  /**
   * The restore in flight, or the one that just finished. Absent until the user
   * starts one — the enrollment screen is the entry point for both, and a
   * progress list on a screen nobody asked to restore from would be noise.
   */
  readonly restore?: readonly MobilePqRestoreEntry[];
  /**
   * Whether a restore can be offered at all. It needs the Bluetooth driver, so
   * a build that cannot reach a phone that way does not show the control rather
   * than showing one that fails when pressed.
   */
  readonly restoreAvailable: boolean;
  /**
   * The transport the user is on. Only in `clipboard` is the offer shown as
   * something to copy: an offer on screen beside a Bluetooth button invites
   * pasting it somewhere for no reason, and it is single-use.
   */
  readonly transport: MobilePqEnrollTransport;
};

/**
 * How the user is moving the offer and its reply.
 */
export type MobilePqEnrollTransport = "bluetooth" | "clipboard";

/**
 * Collaborators the controller drives, all injected so the flow runs with no
 * phone and no network: `challenge` fetches a fresh proof-of-possession
 * challenge, `enroll` performs the background round-trip, `onEnrolled` lets the
 * shell refresh once an account exists, and `render` receives the current view
 * or `null` when the journey closes.
 */
export type MobilePqEnrollControllerDeps = {
  /**
   * Carries the pairing offer to a phone over Bluetooth and resolves with its
   * reply. Absent when this build cannot reach a phone that way, and the journey
   * then offers only the paste path.
   */
  readonly bluetooth?: (offer: string) => Promise<string>;
  /**
   * Runs a whole restore over one connection. Absent when this build cannot
   * reach a phone over Bluetooth, and the screen then offers no restore at all:
   * a restore is many round trips, and carrying each of them by clipboard is
   * several 14 KB pastes per account.
   */
  readonly bluetoothRestore?: <T>(
    drive: (device: MobilePqRestoreDeviceCalls) => Promise<T>,
  ) => Promise<T>;
  readonly challenge: () => Promise<string>;
  readonly enroll: (draft: MobilePqEnrollDraft & { readonly challenge: string }) => Promise<void>;
  readonly networkId: () => string;
  readonly onEnrolled?: () => Promise<void>;
  /**
   * Reports a finished restore once the panel has closed. The panel is gone by
   * then, so this is the only thing left that can tell the user which accounts
   * were skipped and why.
   */
  readonly onRestoreFinished?: (entries: readonly MobilePqRestoreEntry[]) => void;
  readonly render: (view: MobilePqEnrollView | null) => void;
};

/**
 * Drives one enrollment at a time.
 */
export type MobilePqEnrollController = {
  readonly cancel: () => void;
  readonly open: () => Promise<void>;
  /** Asks the phone which accounts to restore, then restores each in turn. */
  readonly restoreAccounts: () => Promise<void>;
  /** Sends the offer over Bluetooth and enrolls whatever comes back. */
  readonly sendOverBluetooth: () => Promise<void>;
  readonly submit: (pasted: string) => Promise<void>;
  /** Switches transport without touching the outstanding challenge. */
  readonly useTransport: (transport: MobilePqEnrollTransport) => void;
};

/**
 * Appended to whatever the background refused with.
 *
 * The challenge is consumed before the proof of possession is checked, so by the
 * time any background refusal reaches here it is spent and the form on screen
 * can no longer succeed — every retry would return "enrollment challenge
 * expired" whatever the user corrects. Saying so is the difference between one
 * confusing loop and one clear restart.
 */
export const MOBILE_PQ_CHALLENGE_SPENT =
  "That challenge is now used up. Cancel and reopen to get a fresh one, then sign that.";

/**
 * Copy shown when the pasted text is not a response from the app at all — the
 * wrong thing copied, or a truncated paste.
 */
export const MOBILE_PQ_PAIRING_PASTE_INVALID =
  "That is not a response from the app. Pair on your phone, then paste the whole reply.";

/**
 * Creates the enrollment controller.
 */
export const createMobilePqEnrollController = (
  deps: MobilePqEnrollControllerDeps,
): MobilePqEnrollController => {
  const { challenge: fetchChallenge, enroll, networkId, onEnrolled, render } = deps;
  let challenge: string | null = null;
  let phase: MobilePqEnrollPhase = { kind: "loading" };
  let restore: readonly MobilePqRestoreEntry[] | null = null;
  // Bluetooth by default where it exists, because it is the path that does not
  // ask the user to carry a 14 KB string by hand.
  let transport: MobilePqEnrollTransport = deps.bluetooth ? "bluetooth" : "clipboard";

  const paint = (): void => {
    render(
      challenge === null
        ? null
        : {
            bluetoothAvailable: deps.bluetooth !== undefined,
            challenge,
            offer: encodeMobilePqPairingOffer({ challenge, networkId: networkId() }),
            phase,
            ...(restore === null ? {} : { restore }),
            restoreAvailable: deps.bluetoothRestore !== undefined,
            transport,
          },
    );
  };

  const fail = (message: string): void => {
    phase = { kind: "error", message };
    paint();
  };

  // One enrollment path for both transports: the shape checks, the enrolling
  // phase and what to do when the background refuses are identical, and the only
  // difference is how the reply arrived.
  const useReply = async (active: string, reply: string): Promise<void> => {
    // Structure first, then the field-level checks. "That is not a response from
    // the app" is a different problem from "that key is the wrong length", and
    // conflating them sends the user looking in the wrong place.
    const draft = decodeMobilePqPairingResult(reply);
    if (draft === null) {
      fail(MOBILE_PQ_PAIRING_PASTE_INVALID);
      return;
    }
    const invalid = mobilePqDraftError(draft);
    if (invalid !== null) {
      fail(invalid);
      return;
    }
    phase = { kind: "enrolling" };
    paint();
    try {
      await enroll({ ...draft, challenge: active });
    } catch (error) {
      // The background refused it: a failed proof of possession, a consumed
      // challenge, or a duplicate account. Nothing was stored. Reaching the
      // background at all spends the challenge, so the reason is reported with
      // the remedy rather than on its own.
      const reason = error instanceof Error ? error.message : String(error);
      fail(`${reason}. ${MOBILE_PQ_CHALLENGE_SPENT}`);
      return;
    }
    challenge = null;
    phase = { kind: "loading" };
    paint();
    await onEnrolled?.();
  };

  return {
    cancel() {
      challenge = null;
      phase = { kind: "loading" };
      restore = null;
      paint();
    },
    async open() {
      phase = { kind: "loading" };
      restore = null;
      challenge = "0x0";
      paint();
      try {
        challenge = await fetchChallenge();
      } catch (error) {
        // No challenge means nothing can be verified, so there is nothing safe
        // to show. Close rather than present a form that cannot succeed.
        challenge = null;
        paint();
        throw error;
      }
      phase = { kind: "collect" };
      paint();
    },
    async restoreAccounts() {
      const drive = deps.bluetoothRestore;
      if (drive === undefined || challenge === null || phase.kind === "restoring") {
        return;
      }
      restore = [];
      phase = { kind: "restoring" };
      paint();
      let finished: readonly MobilePqRestoreEntry[];
      try {
        finished = await drive((device) =>
          runMobilePqRestore({
            challenge: fetchChallenge,
            device,
            enroll,
            networkId: networkId(),
            onProgress: (entries) => {
              restore = entries;
              paint();
            },
          }),
        );
      } catch (error) {
        // Only the picker answer can fail the whole run; a single account is
        // reported against itself and never reaches here.
        restore = null;
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
      // Reported from what the run returned, not from the progress the paints
      // were driven by: the two agree today, and a report that depends on the
      // last paint having happened is a report that goes stale the moment one
      // does not.
      //
      // Closing is what ends a finished run. The accounts are in the wallet
      // behind this panel, and the run also spent the challenge this screen was
      // holding — every account issues its own, and issuing replaces whatever
      // was outstanding — so a panel left open would be showing a form that
      // could only answer "enrollment challenge expired". Reopening issues a
      // fresh one.
      challenge = null;
      restore = null;
      phase = { kind: "loading" };
      paint();
      deps.onRestoreFinished?.(finished);
      await onEnrolled?.();
    },
    async sendOverBluetooth() {
      const active = challenge;
      const send = deps.bluetooth;
      if (active === null || send === undefined || phase.kind === "enrolling") {
        return;
      }
      phase = { kind: "reaching" };
      paint();
      let reply: string;
      try {
        reply = await send(
          encodeMobilePqPairingOffer({ challenge: active, networkId: networkId() }),
        );
      } catch (error) {
        // A dismissed chooser, a phone that refused, a dropped link. The
        // challenge is still outstanding and the paste path still works for it,
        // so the journey stays open with the reason on screen.
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
      await useReply(active, reply);
    },
    useTransport(next) {
      // The challenge is untouched: it is single-use and still outstanding, so
      // switching transport must not spend it or ask the wallet for another.
      transport = next;
      paint();
    },
    async submit(pasted) {
      const active = challenge;
      if (active === null || phase.kind === "enrolling") {
        return;
      }
      await useReply(active, pasted);
    },
  };
};
