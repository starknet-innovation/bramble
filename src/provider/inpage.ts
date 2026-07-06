/**
 * In-page wallet provider. It exposes a tiny request API and delegates to the content bridge.
 */
import {
  CONTENT_TARGET,
  canQueueProviderRequest,
  isTrustedPageMessage,
  readProviderRequestArguments,
  readProviderResponse,
} from "./bridge";

type PendingRequest = {
  readonly reject: (error: Error) => void;
  readonly resolve: (value: unknown) => void;
};

declare global {
  interface Window {
    readonly mcWallet?: {
      readonly isMcWallet: true;
      readonly request: (args: unknown) => Promise<unknown>;
    };
  }
}

const pending = new Map<string, PendingRequest>();

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const response = readProviderResponse(event.data);
  if (!isTrustedPageMessage(event, window, window.location.origin) || !response) {
    return;
  }

  const request = pending.get(response.id);
  if (!request) {
    return;
  }

  pending.delete(response.id);
  if (response.error !== undefined) {
    request.reject(new Error(response.error));
    return;
  }
  request.resolve(response.result);
});

const request = (args: unknown): Promise<unknown> => {
  const input = readProviderRequestArguments(args);
  if (!input) {
    return Promise.reject(new Error("invalid provider request"));
  }
  if (!canQueueProviderRequest(pending.size)) {
    return Promise.reject(new Error("too many pending provider requests"));
  }

  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, { reject, resolve });
    window.postMessage(
      {
        id,
        method: input.method,
        target: CONTENT_TARGET,
      },
      window.location.origin,
    );
  });
};

if (!window.mcWallet) {
  Object.defineProperty(window, "mcWallet", {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      isMcWallet: true,
      request,
    }),
    writable: false,
  });
  window.dispatchEvent(new Event("mc-wallet#initialized"));
}
