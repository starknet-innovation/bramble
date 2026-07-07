/**
 * Provider event contract shared by the background broadcaster, the content
 * bridge, and the injected page provider.
 *
 * The background broadcasts address-free `wallet.event` messages; each
 * content script then asks for the accounts its own origin is allowed to see
 * before telling the page anything, so events never leak wallet state to
 * unconnected sites.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { PAGE_TARGET } from "./bridge";

/**
 * Event names exposed to dapp pages via the injected provider.
 */
export type ProviderEventName = "accountsChanged" | "networkChanged";

/**
 * Page-targeted provider event payloads.
 */
export type ProviderEvent =
  | {
      readonly data: readonly string[];
      readonly event: "accountsChanged";
      readonly target: typeof PAGE_TARGET;
    }
  | {
      readonly data: string;
      readonly event: "networkChanged";
      readonly target: typeof PAGE_TARGET;
    };

/**
 * Background-to-extension wallet event broadcast messages.
 */
export type WalletEventMessage =
  | { readonly event: "accountsChanged"; readonly type: "wallet.event" }
  | { readonly event: "approvalsChanged"; readonly type: "wallet.event" }
  | { readonly chainId: string; readonly event: "networkChanged"; readonly type: "wallet.event" };

const isProviderEventName = (value: unknown): value is ProviderEventName =>
  value === "accountsChanged" || value === "networkChanged";

const isAddressList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);

const isChainId = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]+$/.test(value);

/**
 * Builds a page-targeted accountsChanged event.
 */
export const accountsChangedEvent = (addresses: readonly string[]): ProviderEvent => ({
  data: [...addresses],
  event: "accountsChanged",
  target: PAGE_TARGET,
});

/**
 * Builds a page-targeted networkChanged event.
 */
export const networkChangedEvent = (chainId: string): ProviderEvent => ({
  data: chainId,
  event: "networkChanged",
  target: PAGE_TARGET,
});

/**
 * Parses page-targeted provider events without trusting window traffic.
 */
export const readProviderEvent = (value: unknown): ProviderEvent | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["data", "event", "target"]) ||
    value.target !== PAGE_TARGET ||
    !isProviderEventName(value.event)
  ) {
    return null;
  }
  if (value.event === "accountsChanged") {
    return isAddressList(value.data) ? accountsChangedEvent(value.data) : null;
  }
  return isChainId(value.data) ? networkChangedEvent(value.data) : null;
};

/**
 * Checks background wallet event broadcasts before reacting to them.
 */
export const isWalletEventMessage = (value: unknown): value is WalletEventMessage => {
  if (!isRecord(value) || value.type !== "wallet.event") {
    return false;
  }
  if (value.event === "accountsChanged" || value.event === "approvalsChanged") {
    return hasOnlyKnownKeys(value, ["event", "type"]);
  }
  return (
    value.event === "networkChanged" &&
    hasOnlyKnownKeys(value, ["chainId", "event", "type"]) &&
    isChainId(value.chainId)
  );
};

/**
 * Extracts the address list a payload reveals to the page, when it does.
 */
export const addressesFromPayload = (payload: {
  readonly result?: unknown;
}): readonly string[] | null => {
  if (isAddressList(payload.result)) {
    return payload.result;
  }
  if (isRecord(payload.result) && Array.isArray(payload.result.accounts)) {
    const addresses = payload.result.accounts
      .map((account) => (isRecord(account) ? account.address : null))
      .filter((address): address is string => typeof address === "string" && address.length > 0);
    return addresses.length === payload.result.accounts.length ? addresses : null;
  }
  return null;
};

/**
 * Decides which page events to forward after a wallet broadcast, given the
 * addresses this origin may currently see and the ones it saw last.
 */
export const pageEventsFor = (input: {
  readonly addresses: readonly string[];
  readonly lastAddresses: readonly string[] | null;
  readonly message: WalletEventMessage;
}): readonly ProviderEvent[] => {
  const connected = input.addresses.length > 0;
  const changed =
    input.lastAddresses === null
      ? connected
      : input.lastAddresses.length !== input.addresses.length ||
        input.addresses.some((address, index) => input.lastAddresses?.[index] !== address);
  const events: ProviderEvent[] = [];
  if (input.message.event === "networkChanged" && connected) {
    events.push(networkChangedEvent(input.message.chainId));
  }
  if (changed) {
    events.push(accountsChangedEvent(input.addresses));
  }
  return events;
};

/**
 * Provider event subscription hub used by the injected page script.
 */
export type ProviderEventHub = {
  readonly emit: (event: ProviderEvent) => void;
  readonly off: (event: unknown, handler: unknown) => void;
  readonly on: (event: unknown, handler: unknown) => void;
};

/**
 * Creates the provider event hub. Unknown event names and non-function
 * handlers are ignored so hostile pages cannot break the provider surface.
 */
export const createProviderEventHub = (): ProviderEventHub => {
  const handlers = new Map<ProviderEventName, Set<(data: unknown) => void>>([
    ["accountsChanged", new Set()],
    ["networkChanged", new Set()],
  ]);
  return {
    emit(event) {
      const subscribed = handlers.get(event.event);
      if (!subscribed) {
        return;
      }
      for (const handler of [...subscribed]) {
        try {
          handler(event.data);
        } catch {
          // One faulty dapp handler must not block the other subscribers.
        }
      }
    },
    off(event, handler) {
      if (!isProviderEventName(event) || typeof handler !== "function") {
        return;
      }
      handlers.get(event)?.delete(handler as (data: unknown) => void);
    },
    on(event, handler) {
      if (!isProviderEventName(event) || typeof handler !== "function") {
        return;
      }
      handlers.get(event)?.add(handler as (data: unknown) => void);
    },
  };
};
