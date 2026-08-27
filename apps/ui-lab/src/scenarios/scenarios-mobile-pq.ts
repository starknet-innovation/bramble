/**
 * Both halves of the paired-phone journey — enrolling a device and approving a
 * transaction with it — rendered against deterministic fixtures. This
 * is the surface the milestone is hardest to review without: the flow needs a
 * phone with an enclave key, an app that does not exist yet, and a transport a
 * user carries by hand. Here it needs none of them.
 *
 * The envelope and public key are at real length on purpose. A stubbed 40-byte
 * key would make the copy affordance look reasonable and hide the actual
 * question this design has to answer — whether a human will carry a string this
 * size between two devices for every transaction.
 */
import type { MlDsaKind } from "@mc-wallet/wallet-model/accounts";
import type { MobilePqEnrollView, MobilePqSignView } from "@mc-wallet/wallet-ui/lab";
import {
  addAccountChooser,
  encodeMobilePqSignEnvelope,
  MOBILE_PQ_KEY_INVALID,
  mobilePqEnrollScreen,
  mobilePqSignScreen,
} from "@mc-wallet/wallet-ui/lab";
import { mobilePqAccount, statusFor } from "../fixtures/fixtures";
import type { ScenarioCheckpoint, WalletScenario } from "../runtime/types";

const mobilePqRequest = {
  accountId: mobilePqAccount.id,
  deviceId: mobilePqAccount.derivation.deviceId,
  id: "mobile-pq-sign-fixture",
  // Full-width: the takeover renders this at the padded 64 digits the phone
  // signs, so a short stub would misrepresent the block's real density.
  messageHash: "0x7d1f4b2c9e8a06d35f1c2b8e4a97d05c3e6f1a2b8c4d9e0f3a5b7c1d2e4f6a8",
  publicKey: mobilePqAccount.publicKey,
};

const mobilePqCheckpoint = (
  phase: MobilePqSignView["phase"],
  label: string,
  narrative: string,
): ScenarioCheckpoint => {
  const view: MobilePqSignView = {
    envelope: encodeMobilePqSignEnvelope(mobilePqRequest),
    phase,
    request: mobilePqRequest,
  };
  return {
    content: () => mobilePqSignScreen(view, statusFor(mobilePqAccount)),
    id: phase.kind,
    label,
    narrative,
    state: {
      fixture: true,
      phase: phase.kind,
      requestId: view.request.id,
      signatureMaterial: "never present",
    },
  };
};

/**
 * The three states one clipboard round trip can be in.
 */
export const mobilePqScenario: WalletScenario = {
  checkpoints: [
    mobilePqCheckpoint(
      { kind: "handoff" },
      "Handoff",
      "Both halves of the round trip are on screen at once: the request to carry to the phone, and the field to paste the response into. The hash is shown at full width because the phone blind-signs and cannot show the user what it is approving.",
    ),
    mobilePqCheckpoint(
      { kind: "submitting" },
      "Verifying",
      "The signature is back and the background is checking it against the account's enrolled key. Nothing is broadcast until it passes, and the copy never claims otherwise.",
    ),
    mobilePqCheckpoint(
      { kind: "error", message: "Mobile signature verification failed" },
      "Refused",
      "A signature that did not verify. The request is still parked, nothing was submitted, and retry returns to the same handoff rather than restarting the transaction.",
    ),
  ],
  description:
    "Production paired-phone sign takeover across the handoff, verification, and refusal states of one clipboard round trip.",
  id: "mobile-pq-sign",
  surface: "sidepanel",
  title: "Post-quantum phone approval",
  views: ["send"],
};

// A felt-safe challenge, shaped like one the background actually issues: 32
// random bytes with the top six bits cleared so the value always fits the Stark
// field. Rendered at full width because that is the string a user copies by hand.
const ENROLL_CHALLENGE = "0x02f4c1a83b7e6d095c2a1f8b4e7d3c60a9f5e2b8d1c4a7f03e6b9d2c5a8f1e40";

const enrollCheckpoint = (
  id: string,
  phase: MobilePqEnrollView["phase"],
  mlDsaKind: MlDsaKind,
  label: string,
  narrative: string,
  state: ScenarioCheckpoint["state"],
): ScenarioCheckpoint => ({
  content: () =>
    mobilePqEnrollScreen({ challenge: ENROLL_CHALLENGE, mlDsaKind, phase }, statusFor()),
  id,
  label,
  narrative,
  state: { ...state, fixture: true, secretsRead: false },
});

/**
 * Enrolling a paired post-quantum device, from the chooser entry point through
 * the proof-of-possession form and its refusal.
 */
export const mobilePqOnboardingScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => addAccountChooser("mobile-pq"),
      id: "method",
      label: "Choose a post-quantum device",
      narrative:
        "The post-quantum route sits beside the other signer models rather than behind a flag, because the choice a user makes here is which key signs — not which feature is enabled.",
      state: { route: "mobile-pq", selected: "mobile-pq" },
    },
    enrollCheckpoint(
      "loading",
      { kind: "loading" },
      "const",
      "Awaiting a challenge",
      "Nothing is asked of the user until the wallet has a challenge to bind the enrollment to. Without one there is nothing to verify, so the form is withheld rather than shown and later rejected.",
      { challenge: "pending" },
    ),
    enrollCheckpoint(
      "collect",
      { kind: "collect" },
      "const",
      "Prove possession",
      "The challenge is on screen first and the fields follow the order the user works in: sign it on the device, then paste back the key and the response. One screen, because a clipboard lets the user move between wallet and device freely.",
      { challenge: "issued", contract: "const", fields: 5 },
    ),
    enrollCheckpoint(
      "collect-hashkey",
      { kind: "collect" },
      "hashkey",
      "Hashed-key contract",
      "The same form with a shared-class contract selected. Only the contract choice and the class hash differ across this family — the challenge, the key, and the signature are identical, which is why one screen serves all three.",
      { challenge: "issued", contract: "hashkey", fields: 5 },
    ),
    enrollCheckpoint(
      "enrolling",
      { kind: "enrolling" },
      "const",
      "Verifying the device",
      "The signature is being checked against the pasted key before any address is derived. An address derived from a key the device cannot sign for is unspendable, so this check gates the write rather than following it.",
      { challenge: "consumed", verifying: true },
    ),
    enrollCheckpoint(
      "malformed",
      { kind: "error", message: MOBILE_PQ_KEY_INVALID },
      "const",
      "Malformed key",
      "A paste that is not an ML-DSA-65 key is refused in the panel, before the background is asked. The form stays up with the challenge intact so the user can correct one field.",
      { accountCreated: false, refusedBy: "panel" },
    ),
    enrollCheckpoint(
      "refused",
      { kind: "error", message: "Mobile device signature verification failed" },
      "const",
      "Refused enrollment",
      "A well-formed key whose signature does not verify. The background stored nothing, and because the challenge is single-use recovery is a fresh one rather than a retry of this form.",
      { accountCreated: false, challenge: "spent", refusedBy: "background" },
    ),
  ],
  description:
    "Post-quantum device enrollment: chooser entry, challenge issuance, the proof-of-possession form across contracts, and both refusal paths.",
  id: "mobile-pq-onboarding",
  surface: "sidepanel",
  title: "Post-quantum device onboarding",
};
