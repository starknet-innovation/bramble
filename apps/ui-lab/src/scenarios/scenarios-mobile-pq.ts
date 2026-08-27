/**
 * The paired-phone sign takeover, rendered against deterministic fixtures. This
 * is the surface the milestone is hardest to review without: the flow needs a
 * phone with an enclave key, an app that does not exist yet, and a transport a
 * user carries by hand. Here it needs none of them.
 *
 * The envelope and public key are at real length on purpose. A stubbed 40-byte
 * key would make the copy affordance look reasonable and hide the actual
 * question this design has to answer — whether a human will carry a string this
 * size between two devices for every transaction.
 */
import type { MobilePqSignView } from "@mc-wallet/wallet-ui/lab";
import { encodeMobilePqSignEnvelope, mobilePqSignScreen } from "@mc-wallet/wallet-ui/lab";
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
