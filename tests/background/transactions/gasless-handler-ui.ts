/**
 * Pay up to controls and the execute-body checks the handler tests share.
 * The buttons are the production renderers; the click is what those controls send.
 */
import { isRecord } from "@bramble/core/json";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { GaslessFeeOffer } from "@bramble/transactions/gasless-request";
import { isGaslessFeeOffer } from "@bramble/transactions/gasless-request";
import { OUTSIDE_EXECUTION_DOMAIN } from "@bramble/transactions/outside-execution-terms";
import { sameFelt } from "@bramble/wallet-model/networks";
import { OutsideExecutionTypesV2 } from "starknet";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { PendingApproval } from "../../../packages/presentation/wallet-ui/src/popup/responses/responses";
import { approvalCard } from "../../../packages/presentation/wallet-ui/src/sidepanel/journeys/approvals/approval-cards";
import { bindGaslessFeeChoice } from "../../../packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-gasless-choice";
import { reviewPanelHtml } from "../../../packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-review-markup";
import { flushHeld } from "../../support/held";
import { account, extensionSender, FORWARDER, REFERENCE, USDC } from "./gasless-handler-constants";

type TransferReview = Parameters<typeof reviewPanelHtml>[0];
type Handler = (message: unknown, sender?: RuntimeSender) => Promise<unknown>;

const payText = (button: HTMLButtonElement | null): string => button?.textContent ?? "";

/**
 * Clicks the send review's Pay up to button and returns the offer that click
 * stores. The button is the one `bindGaslessFeeChoice` reads.
 */
export const sendPayChoice = (review: TransferReview): GaslessFeeOffer => {
  const form = document.createElement("form");
  form.innerHTML = reviewPanelHtml(review);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  document.body.append(form);
  try {
    const bound = bindGaslessFeeChoice(form);
    const button = form.querySelector<HTMLButtonElement>("[data-gasless-token]");
    if (!payText(button).startsWith("Pay up to ") || !payText(button).includes("USDC")) {
      throw new Error(`missing Pay up to USDC: ${payText(button)}`);
    }
    button?.click();
    const offer = bound.take();
    if (!offer) {
      throw new Error("Pay up to did not choose a fee");
    }
    return offer;
  } finally {
    form.remove();
  }
};

const cardHost = (pending: PendingApproval): HTMLDivElement => {
  const host = document.createElement("div");
  host.innerHTML = approvalCard(pending, {
    accountCount: 1,
    accounts: [],
    activeAccountId: account.id,
    hasVault: true,
    locked: false,
    network: "Starknet Mainnet",
    networkId: "SN_MAIN",
    networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
    ready: true,
  });
  document.body.append(host);
  return host;
};

/**
 * Reads the approval card's Pay up to button the way the dashboard copies a
 * gasless click into `wallet.approveOrigin`.
 */
export const approvalPayChoice = (pending: PendingApproval): GaslessFeeOffer => {
  const host = cardHost(pending);
  try {
    const button = host.querySelector<HTMLButtonElement>(
      '[data-gasless-token][data-approval-action="approve"]',
    );
    if (!payText(button).startsWith("Pay up to ") || !payText(button).includes("USDC")) {
      throw new Error(`missing Pay up to USDC: ${payText(button)}`);
    }
    button?.click();
    const offer = {
      amount: button?.dataset["gaslessAmount"] ?? "",
      decimals: Number(button?.dataset["gaslessDecimals"]),
      label: button?.dataset["gaslessLabel"] ?? "",
      tokenAddress: button?.dataset["gaslessToken"] ?? "",
    };
    if (!isGaslessFeeOffer(offer)) {
      throw new Error("Pay up to button was not a fee offer");
    }
    return offer;
  } finally {
    host.remove();
  }
};

/**
 * The STRK Approve control's echoed fee. That control is not a Pay up to button.
 */
export const strkApproveFee = (pending: PendingApproval): FeeEstimate => {
  const host = cardHost(pending);
  try {
    const button = [
      ...host.querySelectorAll<HTMLButtonElement>("[data-approval-action='approve']"),
    ].find((candidate) => candidate.dataset["gaslessToken"] === undefined);
    const overallFee = button?.dataset["approvalFee"];
    const unit = button?.dataset["approvalFeeUnit"];
    if (!overallFee || (unit !== "FRI" && unit !== "WEI")) {
      throw new Error("Approve did not show a STRK fee");
    }
    return { overallFee, unit };
  } finally {
    host.remove();
  }
};

/**
 * Waits until the queued invoke's fee review has attached a gasless offer.
 */
export const waitForGaslessApproval = async (handler: Handler): Promise<PendingApproval> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
      readonly pending?: readonly PendingApproval[];
    };
    const pending = response.pending?.at(-1);
    if (pending?.gaslessFees && pending.gaslessFees.length > 0) {
      return pending;
    }
    if (pending?.feeEstimateFailed === true) {
      throw new Error("invoke fee estimate failed");
    }
    if (pending && pending.feeEstimatePending !== true && pending.fee != null) {
      throw new Error(`no gasless offer: ${JSON.stringify(pending.gaslessFees ?? null)}`);
    }
    await flushHeld();
  }
  throw new Error("gasless approval was not reviewed");
};

const typedData = (params: unknown): Record<string, unknown> => {
  if (!isRecord(params) || !isRecord(params["transaction"]) || !isRecord(params["parameters"])) {
    throw new Error("execute params");
  }
  const transaction = params["transaction"];
  const invoke = transaction["invoke"];
  if (transaction["type"] !== "invoke" || !isRecord(invoke) || !isRecord(invoke["typed_data"])) {
    throw new Error("execute was not an invoke");
  }
  const typed = invoke["typed_data"];
  if (!isRecord(typed) || !isRecord(typed["domain"]) || !isRecord(typed["message"])) {
    throw new Error("typed data");
  }
  return typed;
};

const expectDomain = (typed: Record<string, unknown>): void => {
  const domain = typed["domain"];
  if (
    !isRecord(domain) ||
    domain["chainId"] !== "SN_MAIN" ||
    domain["name"] !== OUTSIDE_EXECUTION_DOMAIN ||
    domain["revision"] !== "1" ||
    domain["version"] !== "2" ||
    typed["primaryType"] !== "OutsideExecution"
  ) {
    throw new Error(`typed data domain ${JSON.stringify(domain)}`);
  }
  if (JSON.stringify(typed["types"]) !== JSON.stringify(OutsideExecutionTypesV2)) {
    throw new Error("typed data types were not OutsideExecution v2");
  }
};

const expectFeeCall = (typed: Record<string, unknown>): void => {
  const message = typed["message"];
  if (!isRecord(message) || !sameFelt(String(message["Caller"]), FORWARDER)) {
    throw new Error("caller was not the pinned forwarder");
  }
  const calls = message["Calls"];
  const fee = Array.isArray(calls) ? calls[calls.length - 1] : undefined;
  if (!isRecord(fee) || !Array.isArray(fee["Calldata"])) {
    throw new Error("fee call");
  }
  const low = fee["Calldata"][1];
  if (
    !sameFelt(String(fee["To"]), USDC) ||
    !sameFelt(String(fee["Calldata"][0]), FORWARDER) ||
    BigInt(String(low)) !== REFERENCE
  ) {
    throw new Error("fee transfer was not the quoted USDC amount to the forwarder");
  }
};

/**
 * The execute body is an invoke of the paymaster's SNIP-9 v2 / SNIP-12 rev 1
 * typed data, chain id `SN_MAIN`, fee mode `default`, paid to the pinned forwarder.
 */
export const expectMainnetExecute = (params: unknown): void => {
  const typed = typedData(params);
  expectDomain(typed);
  expectFeeCall(typed);
  if (!isRecord(params) || !isRecord(params["parameters"])) {
    throw new Error("execute parameters");
  }
  const mode = params["parameters"]["fee_mode"];
  if (
    !isRecord(mode) ||
    mode["mode"] !== "default" ||
    mode["gas_token"] !== USDC ||
    params["parameters"]["version"] !== "0x1"
  ) {
    throw new Error("execute fee mode was not default USDC");
  }
  const encoded = JSON.stringify(params);
  if (encoded.includes("sponsored") || encoded.includes("deploy_and_invoke")) {
    throw new Error("execute included a sponsored or deploy_and_invoke field");
  }
};
