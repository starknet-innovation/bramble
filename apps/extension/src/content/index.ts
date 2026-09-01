/**
 * Content-script bridge between untrusted pages and the extension background worker.
 */

import {
  isTrustedPageMessage,
  providerResponse,
  readProviderRequest,
  toProviderPayload,
  toRuntimeMessage,
} from "@bramble/wallet-protocol/bridge";
import { addressesFromPayload, isWalletEventMessage } from "@bramble/wallet-protocol/events";
import { invalidRequestPayload, unknownError } from "@bramble/wallet-protocol/rpc-errors";
import { createProviderEventRefresh } from "./provider-event-refresh";
import { createProviderRequestAdmission } from "./provider-request-admission";

type RuntimeApi = {
  readonly getURL: (path: string) => string;
  readonly onMessage?: {
    readonly addListener: (listener: (message: unknown) => void) => void;
  };
  readonly sendMessage: (message: unknown) => Promise<unknown>;
};

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: {
    readonly runtime?: RuntimeApi;
  };
};

const runtime = (globalThis as ExtensionGlobal).chrome?.runtime;
const pageRequests = createProviderRequestAdmission();
const eventRefresh = createProviderEventRefresh({
  post: (event) => window.postMessage(event, window.location.origin),
  readAddresses: async () => {
    if (!runtime) return [];
    const result = await runtime.sendMessage({
      origin: window.location.origin,
      type: "wallet.getGrantedAccounts",
    });
    return addressesFromPayload(toProviderPayload(result, "wallet_requestAccounts")) ?? [];
  },
});

const injectProvider = (): void => {
  if (!runtime || document.documentElement.dataset["brambleInjected"] === "true") {
    return;
  }

  document.documentElement.dataset["brambleInjected"] = "true";
  const script = document.createElement("script");
  script.src = runtime.getURL("provider/inpage.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).append(script);
};

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const pageOrigin = window.location.origin;
  if (!isTrustedPageMessage(event, window, pageOrigin) || !runtime) {
    return;
  }

  const request = readProviderRequest(event.data);
  if (!request) {
    return;
  }

  const postToPage = (payload: Parameters<typeof providerResponse>[1]): void => {
    const known = addressesFromPayload(payload);
    if (known) {
      eventRefresh.observeAddresses(known);
    }
    window.postMessage(providerResponse(request, payload), pageOrigin);
  };

  if (!pageRequests.acquire(request.id)) {
    postToPage({ error: invalidRequestPayload("too many pending provider requests") });
    return;
  }

  const runtimeMessage = toRuntimeMessage(request, window.location.origin);
  if (!runtimeMessage) {
    pageRequests.release(request.id);
    postToPage({ error: invalidRequestPayload() });
    return;
  }

  void Promise.resolve()
    .then(() => runtime.sendMessage(runtimeMessage))
    .then(
      (result) => {
        pageRequests.release(request.id);
        postToPage(toProviderPayload(result, request.method));
      },
      () => {
        pageRequests.release(request.id);
        postToPage({ error: unknownError() });
      },
    );
});

runtime?.onMessage?.addListener((message) => {
  if (!runtime || !isWalletEventMessage(message) || message.event === "approvalsChanged") {
    return;
  }

  eventRefresh.enqueue(message);
});

injectProvider();
