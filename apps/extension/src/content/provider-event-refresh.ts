/** Ordered, coalescing provider-event refresh for one content-script origin. */
import {
  type ProviderEvent,
  pageEventsFor,
  type WalletEventMessage,
} from "@bramble/wallet-protocol/events";

/**
 * Content-script event refresh capability. Enqueue accepts only validated
 * background events; observed addresses are public dapp-visible metadata.
 */
export type ProviderEventRefresh = {
  readonly enqueue: (message: WalletEventMessage) => void;
  readonly observeAddresses: (addresses: readonly string[]) => void;
};

/**
 * Serializes address refreshes so an older response can never overwrite a
 * newer one. Broadcasts arriving while a read is pending collapse into one
 * follow-up read, retaining the newest network id.
 */
export const createProviderEventRefresh = (input: {
  readonly post: (event: ProviderEvent) => void;
  readonly readAddresses: () => Promise<readonly string[]>;
}): ProviderEventRefresh => {
  let lastAddresses: readonly string[] | null = null;
  let pendingAccounts = false;
  let pendingNetwork: WalletEventMessage | null = null;
  let running = false;

  const drain = async (): Promise<void> => {
    if (running) return;
    running = true;
    while (pendingAccounts || pendingNetwork) {
      const message =
        pendingNetwork ?? ({ event: "accountsChanged", type: "wallet.event" } as const);
      pendingAccounts = false;
      pendingNetwork = null;
      const addresses = await input.readAddresses().catch(() => []);
      const forwards = pageEventsFor({ addresses, lastAddresses, message });
      lastAddresses = addresses;
      for (const forward of forwards) input.post(forward);
    }
    running = false;
  };

  return {
    enqueue(message) {
      if (message.event === "networkChanged") pendingNetwork = message;
      else if (message.event === "accountsChanged") pendingAccounts = true;
      void drain();
    },
    observeAddresses(addresses) {
      lastAddresses = [...addresses];
    },
  };
};
