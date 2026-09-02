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

import { isMlDsa65PublicKey, isMlDsa65Signature } from "@mc-wallet/wallet-model/signing";
import { fromBase64Url, toBase64Url } from "./wire-encoding";

/**
 * What the user types or pastes into the enrollment form.
 */
export type MobilePqEnrollDraft = {
  readonly deviceId: string;
  readonly publicKey: string;
  readonly signature: string;
};

/*
 * ---------------------------------------------------------------------------
 * The pairing wire shapes
 * ---------------------------------------------------------------------------
 *
 * Kept in this module rather than their own: this controller is the only
 * consumer, and it already owns the view model the offer is rendered from.
 */
/**
 * Pairing envelope version. The phone refuses a version it does not recognise
 * rather than guessing at fields, so this moves whenever a shape below changes.
 */
export const MOBILE_PQ_PAIRING_VERSION = 1;

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
 * What the phone sends back: the name it gave the key, the public key, and the
 * signature over the challenge.
 */
export type MobilePqPairingResult = {
  readonly deviceId: string;
  readonly publicKey: string;
  readonly signature: string;
};

/**
 * Decodes a pasted pairing response, or null when it is not one.
 *
 * Shape only: the lengths of the key and the signature, and the signature
 * itself, are checked by the enrollment controller and the background. This
 * refuses anything that is not the right *kind* of value so the caller can say
 * "that is not a response from the app" rather than "invalid public key".
 */
export const decodeMobilePqPairingResult = (pasted: string): MobilePqPairingResult | null => {
  const json = fromBase64Url(pasted);
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
  const { deviceId, publicKey, signature, version } = record;
  if (
    version !== MOBILE_PQ_PAIRING_VERSION ||
    typeof deviceId !== "string" ||
    deviceId.trim().length === 0 ||
    typeof publicKey !== "string" ||
    typeof signature !== "string"
  ) {
    return null;
  }
  return { deviceId: deviceId.trim(), publicKey, signature };
};

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
  readonly challenge: () => Promise<string>;
  readonly enroll: (draft: MobilePqEnrollDraft & { readonly challenge: string }) => Promise<void>;
  readonly networkId: () => string;
  readonly onEnrolled?: () => Promise<void>;
  readonly render: (view: MobilePqEnrollView | null) => void;
};

/**
 * Drives one enrollment at a time.
 */
export type MobilePqEnrollController = {
  readonly cancel: () => void;
  readonly open: () => Promise<void>;
  /** Sends the offer over Bluetooth and enrolls whatever comes back. */
  readonly sendOverBluetooth: () => Promise<void>;
  readonly submit: (pasted: string) => Promise<void>;
  /** Switches transport without touching the outstanding challenge. */
  readonly useTransport: (transport: MobilePqEnrollTransport) => void;
};

/**
 * Copy shown when a pasted public key is not a well-formed ML-DSA-65 key.
 */
export const MOBILE_PQ_KEY_INVALID =
  "That is not an ML-DSA-65 public key. Paste the whole 1952-byte value the app reported.";

/**
 * Copy shown when a pasted proof-of-possession response is malformed.
 */
export const MOBILE_PQ_POP_INVALID =
  "That is not a signature from the app. Sign the challenge above and paste the whole response.";

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

// The device name is not checked here: it comes from inside the reply, so an
// empty one means a malformed reply rather than a field the user left blank, and
// the decoder refuses it before this runs.
const draftError = (draft: MobilePqEnrollDraft): string | null => {
  if (!isMlDsa65PublicKey(draft.publicKey)) {
    return MOBILE_PQ_KEY_INVALID;
  }
  return isMlDsa65Signature(draft.signature) ? null : MOBILE_PQ_POP_INVALID;
};

/**
 * Creates the enrollment controller.
 */
export const createMobilePqEnrollController = (
  deps: MobilePqEnrollControllerDeps,
): MobilePqEnrollController => {
  const { challenge: fetchChallenge, enroll, networkId, onEnrolled, render } = deps;
  let challenge: string | null = null;
  let phase: MobilePqEnrollPhase = { kind: "loading" };
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
    const invalid = draftError(draft);
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
      paint();
    },
    async open() {
      phase = { kind: "loading" };
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
