/**
 * Content-script bridge between untrusted pages and the extension background worker.
 */

import {
  isTrustedPageMessage,
  providerResponse,
  readProviderRequest,
  toProviderPayload,
  toRuntimeMessage,
} from "../provider/bridge";
import { addressesFromPayload, isWalletEventMessage, pageEventsFor } from "../provider/events";
import { invalidRequestPayload, unknownError } from "../shared/rpc-errors";

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
let lastAddresses: readonly string[] | null = null;

const injectProvider = (): void => {
  if (!runtime || document.documentElement.dataset["mcWalletInjected"] === "true") {
    return;
  }

  document.documentElement.dataset["mcWalletInjected"] = "true";
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
      lastAddresses = known;
    }
    window.postMessage(providerResponse(request, payload), pageOrigin);
  };

  const runtimeMessage = toRuntimeMessage(request, window.location.origin);
  if (!runtimeMessage) {
    postToPage({ error: invalidRequestPayload() });
    return;
  }

  void runtime.sendMessage(runtimeMessage).then(
    (result) => postToPage(toProviderPayload(result, request.method)),
    () => postToPage({ error: unknownError() }),
  );
});

runtime?.onMessage?.addListener((message) => {
  if (!runtime || !isWalletEventMessage(message) || message.event === "approvalsChanged") {
    return;
  }

  const pageOrigin = window.location.origin;
  void runtime
    .sendMessage({ origin: pageOrigin, type: "wallet.getGrantedAccounts" })
    .then(
      (result) => toProviderPayload(result, "wallet_requestAccounts"),
      () => toProviderPayload({ error: "provider request failed" }),
    )
    .then((payload) => {
      const addresses = addressesFromPayload(payload) ?? [];
      const forwards = pageEventsFor({ addresses, lastAddresses, message });
      lastAddresses = addresses;
      for (const forward of forwards) {
        window.postMessage(forward, pageOrigin);
      }
    });
});

injectProvider();
