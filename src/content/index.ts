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

type RuntimeApi = {
  readonly getURL: (path: string) => string;
  readonly sendMessage: (message: unknown) => Promise<unknown>;
};

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: {
    readonly runtime?: RuntimeApi;
  };
};

const runtime = (globalThis as ExtensionGlobal).chrome?.runtime;

const injectProvider = (): void => {
  if (!runtime || document.documentElement.dataset.mcWalletInjected === "true") {
    return;
  }

  document.documentElement.dataset.mcWalletInjected = "true";
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
    window.postMessage(providerResponse(request, payload), pageOrigin);
  };

  const runtimeMessage = toRuntimeMessage(request, window.location.origin);
  if (!runtimeMessage) {
    postToPage({ error: "unsupported provider method" });
    return;
  }

  void runtime.sendMessage(runtimeMessage).then(
    (result) => postToPage(toProviderPayload(result)),
    () => postToPage({ error: "provider request failed" }),
  );
});

injectProvider();
