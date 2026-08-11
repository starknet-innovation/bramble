/**
 * Provider event hub edge guards: emitting an event whose name has no handler
 * bucket is a no-op, and `off` with an unknown event name or a non-function
 * handler must silently ignore the call rather than removing anything.
 */
import { describe, expect, test } from "bun:test";
import { PAGE_TARGET } from "@mc-wallet/wallet-protocol/bridge";
import {
  accountsChangedEvent,
  createProviderEventHub,
  networkChangedEvent,
} from "@mc-wallet/wallet-protocol/events";

const CHAIN_ID = "0x534e5f4d41494e";
const ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

describe("createProviderEventHub edge guards", () => {
  test("emitting an event with no handler bucket is a silent no-op", () => {
    const hub = createProviderEventHub();
    const seen: unknown[] = [];
    hub.on("accountsChanged", (data: unknown) => seen.push(data));

    // An event name outside the two known buckets resolves to `undefined` from
    // the handler map, so emit returns early without touching any subscriber.
    expect(() =>
      hub.emit({ data: [], event: "chainChanged", target: PAGE_TARGET } as unknown as Parameters<
        typeof hub.emit
      >[0]),
    ).not.toThrow();
    expect(seen).toEqual([]);
  });

  test("off ignores an unknown event name and never removes a real subscriber", () => {
    const hub = createProviderEventHub();
    const seen: unknown[] = [];
    const handler = (data: unknown) => seen.push(data);
    hub.on("networkChanged", handler);

    // Unknown event name: the guard returns before touching the map.
    hub.off("chainChanged", handler);
    hub.emit(networkChangedEvent(CHAIN_ID));
    // The real subscription survived the bogus off call.
    expect(seen).toEqual([CHAIN_ID]);
  });

  test("off ignores a non-function handler and leaves the subscription intact", () => {
    const hub = createProviderEventHub();
    const seen: unknown[] = [];
    const handler = (data: unknown) => seen.push(data);
    hub.on("accountsChanged", handler);

    // Non-function handler: the guard returns before the map delete.
    hub.off("accountsChanged", "not a function");
    hub.emit(accountsChangedEvent([ADDRESS]));
    expect(seen).toEqual([[ADDRESS]]);

    // A well-formed off then genuinely removes it.
    hub.off("accountsChanged", handler);
    hub.emit(accountsChangedEvent([]));
    expect(seen).toEqual([[ADDRESS]]);
  });
});
