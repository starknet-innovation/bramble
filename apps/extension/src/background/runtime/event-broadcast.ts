/**
 * Delivery of wallet events out of the background, split from ./index so the
 * entrypoint stays a wiring list: first to the extension's own pages through
 * `runtime.sendMessage`, then to every open tab's content script, which
 * re-queries what its origin may see before telling a page anything.
 *
 * Events go out one at a time, in the order they were raised: each delivery
 * waits for the one before it. Delivery is best effort: a page with no
 * listener, a closed tab, or a tab without the content script is skipped.
 */
import type { WalletEventMessage } from "@bramble/wallet-protocol/events";
import type { BackgroundBrowser } from "./background-browser";

/** The browser slice event delivery uses; either member may be absent. */
export type WalletEventBrowser = Pick<BackgroundBrowser, "runtime" | "tabs">;

/**
 * Creates the ordered, best-effort broadcaster over the extension API (absent
 * outside an extension, where every event goes nowhere). The returned function
 * queues the event and returns at once.
 */
export const createWalletEventBroadcast = (
  browser: WalletEventBrowser | undefined,
): ((event: WalletEventMessage) => void) => {
  let queue: Promise<void> = Promise.resolve();
  return (event) => {
    queue = queue.then(async () => {
      await browser?.runtime?.sendMessage?.(event).catch(() => undefined);
      const openTabs = await browser?.tabs?.query({}).catch(() => []);
      await Promise.all(
        (openTabs ?? []).map((tab) =>
          typeof tab.id === "number"
            ? browser?.tabs?.sendMessage(tab.id, event).then(
                () => undefined,
                () => undefined,
              )
            : undefined,
        ),
      );
    });
  };
};
