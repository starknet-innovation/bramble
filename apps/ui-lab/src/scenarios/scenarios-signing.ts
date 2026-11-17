import { ledgerMessage } from "@bramble/ledger-protocol/errors";
import type { LedgerSignView, PrivacyDisclosureState, SendIntent } from "@bramble/wallet-ui/lab";
import {
  bindTransfer,
  createSidepanelRuntime,
  ledgerSignScreen,
  markTransferLedgerAuthorized,
  sendFlow,
} from "@bramble/wallet-ui/lab";
import { ledgerAccount, RECIPIENT_ADDRESS, statusFor } from "../fixtures/fixtures";
import {
  ETH_TOKEN,
  journeyBalances,
  journeyChanges,
  journeyPreferences,
  journeyPrices,
  STRK_TOKEN,
} from "../fixtures/journey-fixtures";
import { messageType, nextTurn, updateForm } from "../runtime/scenario-runtime";
import type { FrameContext, ScenarioCheckpoint, WalletScenario } from "../runtime/types";

const TRANSFER_HASH = `0x01${"a".repeat(62)}`;
const MOTION_BEAT_MS = 240;

// A name the fixture resolves to an address no row on the recipient screen
// lists, so the confirm face can show a name-resolved recipient that is new and
// therefore carries the wallet's warning along with its full address.
const STRANGER_NAME = "stranger.braavos.stark";
const STRANGER_ADDRESS = `0x0badc0de${"0".repeat(54)}`;

const settleMotionBeat = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, MOTION_BEAT_MS));
};

type SendMode =
  | "asset"
  | "authorizing"
  | "broadcasting"
  | "confirming"
  | "details"
  | "details-fee"
  | "failed"
  | "fee-failure"
  | "pending"
  | "private-shortfall"
  | "recipient"
  | "recipient-name"
  | "recipient-name-long"
  | "recipient-name-missing"
  | "recipient-name-review"
  | "review"
  | "reviewing"
  | "shield-fee"
  | "submitted";

// The pool's per-batch STRK charge and this account's private-balance
// disclosure, fixture-only, so the lab can render a pool route's fee without a
// background worker.
const POOL_FEE_FRI = "6000000000000000000";

const fixturePrivacy: PrivacyDisclosureState = {
  error: null,
  loading: false,
  value: {
    accountId: ledgerAccount.id,
    balances: [
      {
        balance: "1250000000000000000",
        formatted: "1.25",
        symbol: "ETH",
        token: ETH_TOKEN.address,
        tokenId: ETH_TOKEN.id,
      },
      {
        balance: "2845000000000000000000",
        formatted: "2845",
        symbol: "STRK",
        token: STRK_TOKEN.address,
        tokenId: STRK_TOKEN.id,
      },
    ],
    networkId: "SN_MAIN",
    poolFeeFri: POOL_FEE_FRI,
    relayConfigured: true,
    registration: "registered",
  },
};

const waitForFeeLine = async (app: HTMLElement): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((app.querySelector("#send-fee-lines")?.textContent ?? "").trim() !== "") return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Send fixture never showed a fee line");
};

// A shield shortcut: the account pays itself, so the destination bucket is the
// private side and the recipient is the account's own address.
const shieldIntent: SendIntent = {
  accountId: ledgerAccount.id,
  destination: "private",
  networkId: "SN_MAIN",
  recipient: ledgerAccount.address,
  recipientLabel: "Ledger vault",
  source: "public",
  tokenId: ETH_TOKEN.id,
};

// A registered account holding one private STRK, sending one STRK. The pool
// charges its fee in STRK out of the same balance, so the amount plus the
// 6 STRK fee cannot fit and the route refuses with the minimum it needs.
const shortfallPrivacy = (): PrivacyDisclosureState => ({
  error: null,
  loading: false,
  value: {
    accountId: ledgerAccount.id,
    balances: [
      {
        balance: "1000000000000000000",
        formatted: "1",
        symbol: STRK_TOKEN.symbol,
        token: STRK_TOKEN.address,
        tokenId: STRK_TOKEN.id,
      },
    ],
    networkId: "SN_MAIN",
    poolFeeFri: "0x53444835ec580000",
    registration: "registered",
    relayConfigured: true,
  },
});

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

// The fixture's Starknet ID: two names are registered (one a saved contact, one
// listed nowhere); anything else is the naming contract's own zero answer, so
// the not-found state is reachable too. Every reply names the network it was
// read on, so the panel can tie it to its own.
const fixtureNameResolution = (message: unknown, context: FrameContext): unknown => {
  context.emit({ detail: "fixture Starknet name resolution", kind: "response" });
  const name = (message as { readonly name?: unknown }).name;
  if (name === STRANGER_NAME) {
    return {
      networkId: "SN_MAIN",
      ok: true,
      resolution: { address: STRANGER_ADDRESS, status: "resolved" },
    };
  }
  return name === "altaga.braavos.stark"
    ? {
        networkId: "SN_MAIN",
        ok: true,
        resolution: { address: RECIPIENT_ADDRESS, status: "resolved" },
      }
    : { networkId: "SN_MAIN", ok: true, resolution: { status: "not-found" } };
};

// Types a Starknet name into the recipient field and continues, so the fixture
// resolves it the way the background would.
const typeStarkName = async (context: FrameContext, mode: SendMode): Promise<void> => {
  const search = context.app.querySelector<HTMLInputElement>("#send-recipient-search");
  if (!search) {
    throw new Error("Missing production Send recipient field");
  }
  const typed =
    mode === "recipient-name-long"
      ? `${"a".repeat(40)}.${"b".repeat(40)}.stark`
      : mode === "recipient-name-missing"
        ? "nobody.braavos.stark"
        : mode === "recipient-name-review"
          ? STRANGER_NAME
          : "altaga.braavos.stark";
  search.value = typed;
  search.dispatchEvent(new Event("input", { bubbles: true }));
  context.app.querySelector<HTMLButtonElement>("#send-recipient-continue")?.click();
  await nextTurn();
};

// Unshields one STRK from a one-STRK private balance, so the route refuses
// with the minimum the amount needs.
const submitPrivateShortfall = async (context: FrameContext): Promise<void> => {
  context.app.querySelector<HTMLButtonElement>('[data-send-bucket="source"]')?.click();
  await nextTurn();
  updateForm(context, "#send-amount-input", "1");
  const shortfallForm = context.app.querySelector<HTMLFormElement>("#transfer-form");
  if (!shortfallForm) {
    throw new Error("Missing production Send form");
  }
  shortfallForm.requestSubmit();
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
        if (type === "wallet.resolveStarkName") {
          return fixtureNameResolution(message, context);
        }
        return { error: "UI Lab blocks non-fixture runtime requests" };
      },
    });
    bindTransfer({
      app: context.app,
      confirmationDelaysMs: [0],
      privacy: () => fixturePrivacy,
      publicBalances: () => journeyBalances,
      render: async () => undefined,
      senderAddress: () => ledgerAccount.address,
      waitForConfirmation: async () => undefined,
      wallet,
      ...(mode === "private-shortfall" ? { privacy: shortfallPrivacy } : {}),
    });
    if (mode === "recipient") {
      return;
    }
    const nameMode =
      mode === "recipient-name" ||
      mode === "recipient-name-missing" ||
      mode === "recipient-name-long" ||
      mode === "recipient-name-review";
    if (nameMode) {
      // A typed Starknet name is resolved by the fixture before the checkpoint
      // settles: the resolved address becomes the recipient and the resolved
      // name is its visible label, the same state the real wallet reaches once
      // the background answers. The missing and long variants type names that
      // do not resolve, so the field's own note is the state on screen (the
      // long one exercises the note's wrapping against the input bound). The
      // review variant resolves a name no row lists and carries it through
      // amount entry, so the confirm face shows the full address, its
      // provenance line, and the new-recipient warning.
      await typeStarkName(context, mode);
      if (mode !== "recipient-name-review") {
        return;
      }
    } else if (mode !== "shield-fee") {
      context.app
        .querySelector<HTMLElement>(`[data-send-recipient="${RECIPIENT_ADDRESS}"]`)
        ?.click();
      await nextTurn();
    }
    if (mode === "details") return;
    if (mode === "asset") {
      context.app.querySelector<HTMLButtonElement>("#send-token-trigger")?.click();
      return;
    }
    if (mode === "private-shortfall") {
      // Unshield one STRK from a one-STRK private balance: the pool fee is
      // charged in STRK from the same balance, so the amount cannot fit and
      // the amount step must name the figure it needs.
      await submitPrivateShortfall(context);
      return;
    }
    updateForm(context, "#send-amount-input", "0.24");
    if (mode === "details-fee" || mode === "shield-fee") {
      await waitForFeeLine(context.app);
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
    await waitForSendStage(form, "review");
    if (mode === "review" || mode === "fee-failure" || mode === "recipient-name-review") {
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

const sendCheckpoint = (
  mode: SendMode,
  label: string,
  narrative: string,
  intent?: SendIntent,
): ScenarioCheckpoint => ({
  content: () =>
    sendFlow(
      statusFor(ledgerAccount),
      ledgerAccount,
      journeyPreferences,
      journeyBalances,
      journeyPrices,
      journeyChanges,
      "usd",
      [],
      intent,
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
      "recipient-name",
      "Recipient by name",
      "A typed Starknet name resolves to an address, which becomes the recipient while the resolved name stays as its label.",
    ),
    sendCheckpoint(
      "recipient-name-review",
      "Review a name recipient",
      "A name that matches no saved contact reaches the confirm face with its full address, its provenance line, and the new-recipient warning.",
    ),
    sendCheckpoint(
      "recipient-name-missing",
      "Name not found",
      "An unregistered name commits no recipient and says so in the field's own note.",
    ),
    sendCheckpoint(
      "recipient-name-long",
      "Long name wraps",
      "The longest accepted name keeps its note and field inside the panel width.",
    ),
    sendCheckpoint(
      "details",
      "Enter amount",
      "The chosen recipient and network remain visible while token or fiat value is entered.",
    ),
    sendCheckpoint(
      "details-fee",
      "Amount and estimated fee",
      "The estimated network fee is quoted on the amount screen, before the send is reviewed.",
    ),
    sendCheckpoint(
      "shield-fee",
      "Pool fee on a shield",
      "A shielded send states the pool's per-batch charge and invents no network fee for it.",
      shieldIntent,
    ),
    sendCheckpoint(
      "private-shortfall",
      "Insufficient private balance",
      "An unshield the private balance cannot cover names the figure the amount needs, not just that it falls short.",
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
