/**
 * Side-panel consumer that fulfils a background paired-phone sign request end to
 * end over the clipboard transport.
 *
 * The service worker cannot reach a phone, so it parks each signature as a
 * pending request and waits for the panel to carry it across. This controller is
 * that consumer: given one pending request it renders the envelope to copy,
 * accepts the signature the user pastes back, and reports the outcome to the
 * background queue.
 *
 * Fail-closed and abortive by construction: nothing is submitted until the panel
 * reports a signature, and it only ever reports what the phone produced — the
 * mandatory verify-against-the-enrolled-key gate runs in the background before
 * broadcast, so this module never re-implements it. A paste that is not a
 * well-formed ML-DSA-65 signature is refused here, before the round trip, so the
 * user is told "that is not a signature" rather than "verification failed" —
 * which would be indistinguishable from a wrong device. The parked request stays
 * parked until the user retries or cancels, and a cancel reports a clean
 * rejection so the dapp or transfer promise settles rather than hanging.
 *
 * A phone round-trip is slow and interruptible by construction: the user must
 * notice the prompt, pick up the phone, unlock it, open the app, authenticate,
 * and confirm. The background queue bounds that with its own timeout; when it
 * expires the request simply stops being pending and this controller dismisses.
 */

import { isMlDsa65Signature } from "@mc-wallet/wallet-model/signing";
import type { MobilePqSignRequestSummary } from "../../../popup/responses/responses";
import { encodeMobilePqSignEnvelope } from "./sign-envelope";

/**
 * The panel's reply to one pending phone sign: either the encoded signature for
 * the queue id, or a rejection reason the background queue propagates as a
 * fail-closed error. A discriminated union so a caller cannot report both a
 * signature and a rejection for the same id.
 */
export type MobilePqSignOutcome =
  | { readonly id: string; readonly signature: string }
  | { readonly error: string; readonly id: string };

/**
 * The phase the panel renders for the active request. `handoff` is the working
 * state: the envelope is on screen to copy and the paste field is open, because
 * with a clipboard transport those are one continuous action rather than two
 * steps the controller should sequence. `submitting` covers the report round
 * trip, and `error` carries recovery copy for a paste that is not a signature or
 * a background queue that refused it.
 */
type MobilePqSignPhase =
  | { readonly kind: "handoff" }
  | { readonly kind: "submitting" }
  | { readonly kind: "error"; readonly message: string };

/**
 * The full prompt view: the phase, the request it is for, and the envelope
 * string to hand the phone. `null` (passed to the renderer) means no prompt.
 */
export type MobilePqSignView = {
  readonly envelope: string;
  readonly phase: MobilePqSignPhase;
  readonly request: MobilePqSignRequestSummary;
};

/**
 * Collaborators the controller drives, all injected so the flow runs with no
 * phone: the queue `report` callback (the panel to background round trip) and a
 * `render` sink called with the current view, or `null` when the prompt
 * dismisses.
 */
export type MobilePqSignControllerDeps = {
  readonly render: (view: MobilePqSignView | null) => void;
  readonly report: (outcome: MobilePqSignOutcome) => Promise<void>;
};

/**
 * Drives one parked request at a time. `present` is idempotent for the request
 * already showing, so a re-poll never resets a prompt the user is part-way
 * through; a different id replaces it, because the queue only ever surfaces the
 * one the panel should be working on.
 */
export type MobilePqSignController = {
  readonly cancel: () => Promise<void>;
  readonly present: (request: MobilePqSignRequestSummary) => void;
  readonly retry: () => void;
  readonly submit: (pasted: string) => Promise<void>;
};

/**
 * Copy shown when a paste is not a well-formed ML-DSA-65 signature. Refused here
 * rather than passed on, so the user is told the response is wrong rather than
 * that verification failed — which would read as a wrong device.
 */
export const MOBILE_PQ_PASTE_INVALID =
  "That does not look like a signature from the app. Copy the whole response and paste it again.";

/**
 * Rejection reported to the background when the user cancels the prompt, so the
 * held dapp or transfer promise settles rather than hanging until the timeout.
 */
export const MOBILE_PQ_CANCELLED = "mobile-sign-cancelled";

/**
 * Creates the paired-phone signing controller.
 */
export const createMobilePqSignController = (
  deps: MobilePqSignControllerDeps,
): MobilePqSignController => {
  const { render, report } = deps;
  let active: MobilePqSignRequestSummary | null = null;
  let phase: MobilePqSignPhase = { kind: "handoff" };

  const paint = (): void => {
    render(
      active === null
        ? null
        : { envelope: encodeMobilePqSignEnvelope(active), phase, request: active },
    );
  };

  const dismiss = (): void => {
    active = null;
    phase = { kind: "handoff" };
    paint();
  };

  return {
    async cancel() {
      const request = active;
      if (!request) {
        return;
      }
      // Dismiss first: the prompt is the user's, and a slow or failing report
      // must not leave a cancelled takeover on screen. The queue rejects the
      // parked request either way, and a report that fails leaves it parked
      // until its own timeout, which is the fail-closed outcome.
      dismiss();
      await report({ error: MOBILE_PQ_CANCELLED, id: request.id });
    },
    present(request) {
      if (active?.id === request.id) {
        return;
      }
      active = request;
      phase = { kind: "handoff" };
      paint();
    },
    retry() {
      if (!active) {
        return;
      }
      phase = { kind: "handoff" };
      paint();
    },
    async submit(pasted) {
      const request = active;
      if (!request || phase.kind === "submitting") {
        return;
      }
      const signature = pasted.trim();
      if (!isMlDsa65Signature(signature)) {
        phase = { kind: "error", message: MOBILE_PQ_PASTE_INVALID };
        paint();
        return;
      }
      phase = { kind: "submitting" };
      paint();
      try {
        await report({ id: request.id, signature });
      } catch (error) {
        // The background refused it — a stale id, a lock during the round trip,
        // or a signature that did not verify against the enrolled key. Keep the
        // prompt up with the reason rather than dismissing: nothing was
        // submitted, and the user can retry from the same parked request.
        phase = { kind: "error", message: error instanceof Error ? error.message : String(error) };
        paint();
        return;
      }
      dismiss();
    },
  };
};
