/**
 * In-page wallet provider. It exposes a tiny request API plus
 * accountsChanged/networkChanged subscriptions and delegates to the content
 * bridge.
 */
import { invalidRequestPayload } from "../background/wallet-rpc-errors";
import {
  CONTENT_TARGET,
  canQueueProviderRequest,
  isTrustedPageMessage,
  readProviderRequestArguments,
  readProviderResponse,
  walletRpcException,
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
      readonly chainId?: string;
      readonly enable: () => Promise<readonly string[]>;
      readonly icon: string;
      readonly id: "mc-wallet";
      readonly isConnected: boolean;
      readonly isPreauthorized: () => Promise<boolean>;
      readonly name: "MC Wallet";
      readonly off: (event: unknown, handler: unknown) => void;
      readonly on: (event: unknown, handler: unknown) => void;
      readonly request: (args: unknown) => Promise<unknown>;
      readonly selectedAddress?: string;
      readonly version: "0.1.0";
    };
  }
}

// Inline data-URI icon so get-starknet/starknetkit wallet lists can render a
// mark without any external network request (the CSP blocks remote assets).
const WALLET_ICON =
  "data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%2032%2032'%3E%3Crect%20width%3D'32'%20height%3D'32'%20rx%3D'8'%20fill%3D'%236c5ce7'%2F%3E%3Cpath%20d%3D'M8%2023V9l8%209%208-9v14'%20fill%3D'none'%20stroke%3D'%23f5f6ff'%20stroke-width%3D'2.5'%20stroke-linejoin%3D'round'%20stroke-linecap%3D'round'%2F%3E%3C%2Fsvg%3E";

const pending = new Map<string, PendingRequest>();
const events = createProviderEventHub();
let connectedAddresses: readonly string[] = [];
let currentChainId: string | undefined;

const isAddressList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === "string" && item.length > 0);

const hasGrantedAccounts = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as { readonly accounts?: unknown }).accounts) &&
  (value as { readonly accounts: readonly unknown[] }).accounts.length > 0;

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isTrustedPageMessage(event, window, window.location.origin)) {
    return;
  }

  const providerEvent = readProviderEvent(event.data);
  if (providerEvent) {
    if (providerEvent.event === "accountsChanged") {
      connectedAddresses = providerEvent.data;
    }
    if (providerEvent.event === "networkChanged") {
      currentChainId = providerEvent.data;
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
    request.reject(walletRpcException(response.error));
    return;
  }
  request.resolve(response.result);
});

const request = (args: unknown): Promise<unknown> => {
  const input = readProviderRequestArguments(args);
  if (!input) {
    return Promise.reject(walletRpcException(invalidRequestPayload("invalid provider request")));
  }
  if (!canQueueProviderRequest(pending.size)) {
    return Promise.reject(
      walletRpcException(invalidRequestPayload("too many pending provider requests")),
    );
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

const refreshChainId = async (): Promise<void> => {
  try {
    const chainId = await request({ type: "wallet_requestChainId" });
    if (typeof chainId === "string" && /^0x[0-9a-f]+$/.test(chainId)) {
      currentChainId = chainId;
    }
  } catch {
    // Chain id is best-effort; a failed lookup leaves the last known value.
  }
};

const starknetWallet = {
  get chainId(): string | undefined {
    return currentChainId;
  },
  async enable(): Promise<readonly string[]> {
    const addresses = await request({ type: "wallet_requestAccounts" });
    if (!isAddressList(addresses)) {
      throw new Error("invalid provider response");
    }
    connectedAddresses = addresses;
    await refreshChainId();
    return addresses;
  },
  icon: WALLET_ICON,
  id: "mc-wallet" as const,
  get isConnected(): boolean {
    return connectedAddresses.length > 0;
  },
  async isPreauthorized(): Promise<boolean> {
    try {
      return hasGrantedAccounts(await request({ type: "mc_accounts" }));
    } catch {
      return false;
    }
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
