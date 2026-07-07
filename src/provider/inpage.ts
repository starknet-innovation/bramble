/**
 * In-page wallet provider. It exposes a tiny request API plus
 * accountsChanged/networkChanged subscriptions and delegates to the content
 * bridge.
 */
import {
  CONTENT_TARGET,
  canQueueProviderRequest,
  isTrustedPageMessage,
  readProviderRequestArguments,
  readProviderResponse,
} from "./bridge";
import { createProviderEventHub, readProviderEvent } from "./events";

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
    readonly starknet_mcWallet?: {
      readonly enable: () => Promise<readonly string[]>;
      readonly icon: string;
      readonly id: "mc-wallet";
      readonly isConnected: boolean;
      readonly name: "MC Wallet";
      readonly off: (event: unknown, handler: unknown) => void;
      readonly on: (event: unknown, handler: unknown) => void;
      readonly request: (args: unknown) => Promise<unknown>;
      readonly selectedAddress?: string;
      readonly version: "0.1.0";
    };
  }
}

const pending = new Map<string, PendingRequest>();
const events = createProviderEventHub();
let connectedAddresses: readonly string[] = [];

const isAddressList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === "string" && item.length > 0);

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isTrustedPageMessage(event, window, window.location.origin)) {
    return;
  }

  const providerEvent = readProviderEvent(event.data);
  if (providerEvent) {
    if (providerEvent.event === "accountsChanged") {
      connectedAddresses = providerEvent.data;
    }
    events.emit(providerEvent);
    return;
  }

  const response = readProviderResponse(event.data);
  if (!response) {
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
        ...(input.params === undefined ? {} : { params: input.params }),
        target: CONTENT_TARGET,
      },
      window.location.origin,
    );
  });
};

const starknetWallet = {
  async enable(): Promise<readonly string[]> {
    const addresses = await request({ type: "wallet_requestAccounts" });
    if (!isAddressList(addresses)) {
      throw new Error("invalid provider response");
    }
    connectedAddresses = addresses;
    return addresses;
  },
  icon: "",
  id: "mc-wallet" as const,
  get isConnected(): boolean {
    return connectedAddresses.length > 0;
  },
  name: "MC Wallet" as const,
  off: events.off,
  on: events.on,
  request,
  get selectedAddress(): string | undefined {
    return connectedAddresses[0];
  },
  version: "0.1.0" as const,
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
}

if (!window.starknet_mcWallet) {
  Object.defineProperty(window, "starknet_mcWallet", {
    configurable: false,
    enumerable: false,
    value: Object.freeze(starknetWallet),
    writable: false,
  });
}

window.dispatchEvent(new Event("mc-wallet#initialized"));
window.dispatchEvent(new Event("starknet#initialized"));
