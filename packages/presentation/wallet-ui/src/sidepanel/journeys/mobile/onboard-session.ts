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

import { isNonZeroStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import { isMlDsa65PublicKey, isMlDsa65Signature } from "@mc-wallet/wallet-model/signing";

/**
 * What the user types or pastes into the enrollment form.
 */
export type MobilePqEnrollDraft = {
  readonly classHash: string;
  readonly deviceId: string;
  readonly publicKey: string;
  readonly signature: string;
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
  | { readonly kind: "enrolling" }
  | { readonly kind: "error"; readonly message: string };

/**
 * The full enrollment view: the phase and the challenge the device must sign.
 * `null` means the journey is closed.
 */
export type MobilePqEnrollView = {
  readonly challenge: string;
  readonly phase: MobilePqEnrollPhase;
};

/**
 * Collaborators the controller drives, all injected so the flow runs with no
 * phone and no network: `challenge` fetches a fresh proof-of-possession
 * challenge, `enroll` performs the background round-trip, `onEnrolled` lets the
 * shell refresh once an account exists, and `render` receives the current view
 * or `null` when the journey closes.
 */
export type MobilePqEnrollControllerDeps = {
  readonly challenge: () => Promise<string>;
  readonly enroll: (draft: MobilePqEnrollDraft & { readonly challenge: string }) => Promise<void>;
  readonly onEnrolled?: () => Promise<void>;
  readonly render: (view: MobilePqEnrollView | null) => void;
};

/**
 * Drives one enrollment at a time.
 */
export type MobilePqEnrollController = {
  readonly cancel: () => void;
  readonly open: () => Promise<void>;
  readonly submit: (draft: MobilePqEnrollDraft) => Promise<void>;
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
 * Copy shown when the pasted class hash is not a usable felt.
 */
export const MOBILE_PQ_CLASS_INVALID =
  "That is not a class hash. Declare the account class for this key, then paste its hash.";

/**
 * Copy shown when no device label was given.
 */
export const MOBILE_PQ_DEVICE_INVALID = "Give this device a name so you can recognise it later.";

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

const draftError = (draft: MobilePqEnrollDraft): string | null => {
  if (draft.deviceId.length === 0) {
    return MOBILE_PQ_DEVICE_INVALID;
  }
  if (!isMlDsa65PublicKey(draft.publicKey)) {
    return MOBILE_PQ_KEY_INVALID;
  }
  if (!isNonZeroStarkFieldElement(draft.classHash)) {
    return MOBILE_PQ_CLASS_INVALID;
  }
  return isMlDsa65Signature(draft.signature) ? null : MOBILE_PQ_POP_INVALID;
};

/**
 * Creates the enrollment controller.
 */
export const createMobilePqEnrollController = (
  deps: MobilePqEnrollControllerDeps,
): MobilePqEnrollController => {
  const { challenge: fetchChallenge, enroll, onEnrolled, render } = deps;
  let challenge: string | null = null;
  let phase: MobilePqEnrollPhase = { kind: "loading" };

  const paint = (): void => {
    render(challenge === null ? null : { challenge, phase });
  };

  const fail = (message: string): void => {
    phase = { kind: "error", message };
    paint();
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
    async submit(draft) {
      const active = challenge;
      if (active === null || phase.kind === "enrolling") {
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
    },
  };
};
