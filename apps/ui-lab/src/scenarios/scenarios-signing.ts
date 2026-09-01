import { ledgerMessage } from "@mc-wallet/ledger-protocol/errors";
import type { LedgerSignView } from "@mc-wallet/wallet-ui/lab";
import {
  bindTransfer,
  createSidepanelRuntime,
  ledgerSignScreen,
  markTransferLedgerAuthorized,
  sendFlow,
} from "@mc-wallet/wallet-ui/lab";
import { ledgerAccount, RECIPIENT_ADDRESS, statusFor } from "../fixtures/fixtures";
import {
  journeyBalances,
  journeyChanges,
  journeyPreferences,
  journeyPrices,
} from "../fixtures/journey-fixtures";
import { messageType, nextTurn, updateForm } from "../runtime/scenario-runtime";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "../runtime/types";

const TRANSFER_HASH = `0x01${"a".repeat(62)}`;
const MOTION_BEAT_MS = 240;

const settleMotionBeat = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, MOTION_BEAT_MS));
};

type SendMode =
  | "asset"
  | "authorizing"
  | "broadcasting"
  | "confirming"
  | "details"
  | "failed"
  | "fee-failure"
  | "pending"
  | "recipient"
  | "review"
  | "reviewing"
  | "submitted";

const waitForSendStage = async (
  form: HTMLFormElement,
  stage: Exclude<SendMode, "fee-failure">,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (form.dataset["stage"] === stage) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Send fixture did not reach ${stage}`);
};

const fixtureReview = async (
  mode: SendMode,
  context: FrameContext,
  unresolved: Promise<never>,
): Promise<unknown> => {
  if (mode === "reviewing") return unresolved;
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
      feeAffordability: feeEstimateFailed ? "unknown" : "ok",
      feeEstimateFailed,
      flags: [],
      requiresDeployment: false,
      summaries: ["Transfer 0.24 ETH", `Recipient ${RECIPIENT_ADDRESS}`],
    },
  };
};

const fixtureTransfer = async (
  mode: SendMode,
  context: FrameContext,
  unresolved: Promise<never>,
): Promise<unknown> => {
  if (mode === "failed") return { error: "Fixture network rejected the broadcast" };
  if (mode === "authorizing" || mode === "broadcasting") return unresolved;
  await settleMotionBeat();
  context.emit({ detail: "fixture broadcast received", kind: "response" });
  return { ok: true, transactionHash: TRANSFER_HASH };
};

const fixtureActivity = (
  mode: SendMode,
  context: FrameContext,
  unresolved: Promise<never>,
): Promise<never> | object => {
  if (mode === "confirming") return unresolved;
  const status = mode === "submitted" ? "accepted" : "pending";
  context.emit({ detail: `fixture chain status: ${status}`, kind: "response" });
  return {
    activity: [
      {
        accountId: ledgerAccount.id,
        hash: TRANSFER_HASH,
        kind: "transfer",
        networkId: "SN_MAIN",
        status,
        submittedAt: 1,
        summary: "Sent 0.24 ETH",
      },
    ],
    ok: true,
  };
};

const prepareSend =
  (mode: SendMode) =>
  async (context: FrameContext): Promise<void> => {
    const unresolved = new Promise<never>(() => undefined);
    const wallet = createSidepanelRuntime({
      sendMessage: async (message) => {
        const type = messageType(message);
        context.emit({ detail: type ?? "invalid request", kind: "action" });
        if (type === "wallet.reviewTransfer") {
          return fixtureReview(mode, context, unresolved);
        }
        if (type === "wallet.transfer") {
          return fixtureTransfer(mode, context, unresolved);
        }
        if (type === "wallet.activity") {
          return fixtureActivity(mode, context, unresolved);
        }
        return { error: "UI Lab blocks non-fixture runtime requests" };
      },
    });
    bindTransfer({
      app: context.app,
      confirmationDelaysMs: [0],
      publicBalances: () => journeyBalances,
      render: async () => undefined,
      senderAddress: () => ledgerAccount.address,
      waitForConfirmation: async () => undefined,
      wallet,
    });
    if (mode === "recipient") {
      return;
    }
    context.app.querySelector<HTMLElement>(`[data-send-recipient="${RECIPIENT_ADDRESS}"]`)?.click();
    await nextTurn();
    if (mode === "details") return;
    if (mode === "asset") {
      context.app.querySelector<HTMLButtonElement>("#send-token-trigger")?.click();
      return;
    }
    updateForm(context, "#send-amount-input", "0.24");
    const form = context.app.querySelector<HTMLFormElement>("#transfer-form");
    if (!form) {
      throw new Error("Missing production Send form");
    }
    form.requestSubmit();
    if (mode === "reviewing") {
      return;
    }
    await waitForSendStage(form, "review");
    if (mode === "review" || mode === "fee-failure") {
      return;
    }
    form.requestSubmit();
    if (mode === "broadcasting") {
      await waitForSendStage(form, "authorizing");
      markTransferLedgerAuthorized();
      await waitForSendStage(form, "broadcasting");
      return;
    }
    await waitForSendStage(form, mode);
  };

const sendCheckpoint = (mode: SendMode, label: string, narrative: string): ScenarioCheckpoint => ({
  content: () =>
    sendFlow(
      statusFor(ledgerAccount),
      ledgerAccount,
      journeyPreferences,
      journeyBalances,
      journeyPrices,
      journeyChanges,
    ),
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
    sendCheckpoint(
      "recipient",
      "Choose recipient",
      "Accounts and saved contacts establish who will receive funds before amount entry.",
    ),
    sendCheckpoint(
      "details",
      "Enter amount",
      "The chosen recipient and network remain visible while token or fiat value is entered.",
    ),
    sendCheckpoint(
      "asset",
      "Choose asset",
      "A searchable token list shows logos, balances, fiat values, and daily movement.",
    ),
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
      "confirming",
      "Chain confirmation",
      "The submitted hash stays visibly live while the wallet polls Starknet acceptance.",
    ),
    sendCheckpoint(
      "pending",
      "Confirmation delayed",
      "A durable hash and explicit next actions replace any false success state.",
    ),
    sendCheckpoint(
      "submitted",
      "Confirmed",
      "Only an accepted chain status earns the completed success animation.",
    ),
    sendCheckpoint(
      "failed",
      "Not sent",
      "A terminal failure names what happened and offers focused retry or edit actions.",
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
  // The prompt states what the device approval authorizes, since blind signing
  // shows the user nothing but the hash. This scenario is the wallet send flow.
  intent: "send-token" as const,
  // Full-width: the takeover renders this at the padded 64 digits a Ledger
  // shows, so a short stub would misrepresent the block's real density.
  messageHash: "0x7d1f4b2c9e8a06d35f1c2b8e4a97d05c3e6f1a2b8c4d9e0f3a5b7c1d2e4f6a8",
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
