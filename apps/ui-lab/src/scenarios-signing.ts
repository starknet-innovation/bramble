import { ledgerMessage } from "../../../src/sidepanel/ledger/errors";
import type { LedgerSignView } from "../../../src/sidepanel/ledger/sign-session";
import { ledgerSignScreen } from "../../../src/sidepanel/ledger/sign-views";
import { createSidepanelRuntime } from "../../../src/sidepanel/runtime";
import { sendFlow } from "../../../src/sidepanel/send-views";
import { bindTransfer, markTransferLedgerAuthorized } from "../../../src/sidepanel/transfer-ui";
import { ledgerAccount, preferences, RECIPIENT_ADDRESS, statusFor } from "./fixtures";
import { messageType, nextTurn, updateForm } from "./scenario-runtime";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "./types";

const TRANSFER_HASH = `0x01${"a".repeat(62)}`;
const MOTION_BEAT_MS = 240;

const settleMotionBeat = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, MOTION_BEAT_MS));
};

type SendMode =
  | "authorizing"
  | "broadcasting"
  | "details"
  | "fee-failure"
  | "review"
  | "reviewing"
  | "submitted";

const prepareSend =
  (mode: SendMode) =>
  async (context: FrameContext): Promise<void> => {
    const unresolved = new Promise<never>(() => undefined);
    const wallet = createSidepanelRuntime({
      sendMessage: async (message) => {
        const type = messageType(message);
        context.emit({ detail: type ?? "invalid request", kind: "action" });
        if (type === "wallet.reviewTransfer") {
          if (mode === "reviewing") {
            return unresolved;
          }
          await settleMotionBeat();
          const feeEstimateFailed = mode === "fee-failure";
          context.emit({
            detail: feeEstimateFailed ? "fee estimate unavailable" : "decoded calls and fee ready",
            kind: "response",
          });
          return {
            ok: true,
            review: {
              fee: feeEstimateFailed ? null : { overallFee: "2400000000000000", unit: "FRI" },
              feeEstimateFailed,
              flags: [],
              requiresDeployment: false,
              summaries: ["Transfer 24 USDC", `Recipient ${RECIPIENT_ADDRESS}`],
            },
          };
        }
        if (type === "wallet.transfer") {
          if (mode === "submitted") {
            await settleMotionBeat();
            context.emit({ detail: "fixture broadcast accepted", kind: "response" });
            return { ok: true, transactionHash: TRANSFER_HASH };
          }
          return unresolved;
        }
        return { error: "UI Lab blocks non-fixture runtime requests" };
      },
    });
    bindTransfer({
      app: context.app,
      render: async () => undefined,
      wallet,
    });
    updateForm(context, 'select[name="tokenId"]', preferences.tokens[0]?.id ?? "");
    updateForm(context, 'input[name="recipient"]', RECIPIENT_ADDRESS);
    updateForm(context, 'input[name="amount"]', "24");
    if (mode === "details") {
      return;
    }
    const form = context.app.querySelector<HTMLFormElement>("#transfer-form");
    if (!form) {
      throw new Error("Missing production Send form");
    }
    form.requestSubmit();
    if (mode === "reviewing") {
      return;
    }
    await settleMotionBeat();
    await nextTurn();
    if (mode === "review" || mode === "fee-failure") {
      return;
    }
    form.requestSubmit();
    await settleMotionBeat();
    if (mode === "broadcasting") {
      markTransferLedgerAuthorized();
    }
    if (mode === "submitted") {
      await nextTurn();
    }
  };

const sendCheckpoint = (mode: SendMode, label: string, narrative: string): ScenarioCheckpoint => ({
  content: () => sendFlow(statusFor(ledgerAccount), ledgerAccount, preferences),
  id: mode,
  label,
  narrative,
  prepare: prepareSend(mode),
  state: {
    account: "Ledger vault",
    fixture: true,
    stage: mode,
    transport: mode === "authorizing" || mode === "broadcasting" ? "parked" : "not-opened",
  },
});

export const sendScenario: WalletScenario = {
  checkpoints: [
    sendCheckpoint("details", "Details", "A complete form ready for a deliberate review."),
    sendCheckpoint(
      "reviewing",
      "Preparing review",
      "The real Send binding waits on a deterministic delayed review response.",
    ),
    sendCheckpoint("review", "Review ready", "Decoded effects and fee are locked before signing."),
    sendCheckpoint(
      "fee-failure",
      "Fee estimate failed",
      "The transaction remains blocked until the estimate succeeds.",
    ),
    sendCheckpoint(
      "authorizing",
      "Ledger authorization",
      "The reviewed request is parked while the user acts on the device.",
    ),
    sendCheckpoint(
      "broadcasting",
      "Broadcast",
      "Verified device approval advances visibly into the network handoff.",
    ),
    sendCheckpoint(
      "submitted",
      "Success",
      "The accepted broadcast has a durable receipt and next actions.",
    ),
  ],
  description:
    "Production Send template and binding driven through review, Ledger authorization, broadcast, failure, and receipt states.",
  id: "send",
  surface: "sidepanel",
  title: "Send lifecycle",
  views: ["send"],
};

const ledgerRequest = {
  accountId: ledgerAccount.id,
  id: "ledger-sign-fixture",
  messageHash: "0x721",
  path: ledgerAccount.derivation.kind === "ledger" ? ledgerAccount.derivation.path : "",
  publicKeyX: ledgerAccount.publicKeyX,
};

const ledgerCheckpoint = (
  view: LedgerSignView,
  label: string,
  narrative: string,
): ScenarioCheckpoint => ({
  content: () => ledgerSignScreen(view, statusFor(ledgerAccount)),
  id: view.phase.kind,
  label,
  narrative,
  state: {
    fixture: true,
    phase: view.phase.kind,
    requestId: view.request.id,
    signatureMaterial: "never present",
  },
});

export const ledgerScenario: WalletScenario = {
  checkpoints: [
    ledgerCheckpoint(
      { phase: { kind: "connect" }, request: ledgerRequest },
      "Connect",
      "The transaction is parked and the next required user action is explicit.",
    ),
    ledgerCheckpoint(
      { phase: { kind: "connecting" }, request: ledgerRequest },
      "Device chooser",
      "The browser-mediated device grant is visible without claiming a connection.",
    ),
    ledgerCheckpoint(
      {
        phase: {
          devices: [
            { id: "fixture-flex", label: "Ledger Flex · USB" },
            { id: "fixture-stax", label: "Ledger Stax · USB" },
          ],
          kind: "devices",
        },
        request: ledgerRequest,
      },
      "Choose device",
      "Multiple grants require explicit disambiguation before any signing request.",
    ),
    ledgerCheckpoint(
      { phase: { kind: "checking" }, request: ledgerRequest },
      "Check app",
      "The Starknet app version and device readiness are checked.",
    ),
    ledgerCheckpoint(
      { phase: { kind: "verifying" }, request: ledgerRequest },
      "Verify account",
      "The device public key is matched against the wallet account.",
    ),
    ledgerCheckpoint(
      { phase: { kind: "confirming" }, request: ledgerRequest },
      "Approve on Ledger",
      "The hardware action and its safety boundary stay unmistakable.",
    ),
    ledgerCheckpoint(
      { phase: { kind: "submitting" }, request: ledgerRequest },
      "Finish",
      "The returned signature is being verified and handed back to the parked transaction.",
    ),
    ledgerCheckpoint(
      {
        phase: {
          code: "device-busy",
          kind: "error",
          message: ledgerMessage("device-busy"),
        },
        request: ledgerRequest,
      },
      "Device busy",
      "A recoverable failure names the competing application and keeps the request parked.",
    ),
  ],
  description:
    "Every production Ledger signing phase, including multi-device choice and fail-closed recovery, without hardware access.",
  id: "ledger",
  surface: "sidepanel",
  title: "Ledger signing",
};
