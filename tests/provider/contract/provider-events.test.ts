/**
 * Provider event contract checks: page event parsing, the subscription hub,
 * and the privacy-gated forwarding decisions made by the content bridge.
 */
import { describe, expect, test } from "bun:test";
import { PAGE_TARGET } from "@mc-wallet/wallet-protocol/bridge";
import {
  accountsChangedEvent,
  addressesFromPayload,
  createProviderEventHub,
  isWalletEventMessage,
  networkChangedEvent,
  pageEventsFor,
  readProviderEvent,
} from "@mc-wallet/wallet-protocol/events";

const ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const OTHER = "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const CHAIN_ID = "0x534e5f4d41494e";

describe("readProviderEvent", () => {
  test("round-trips built events", () => {
    expect(readProviderEvent(accountsChangedEvent([ADDRESS]))).toEqual({
      data: [ADDRESS],
      event: "accountsChanged",
      target: PAGE_TARGET,
    });
    expect(readProviderEvent(networkChangedEvent(CHAIN_ID))).toEqual({
      data: CHAIN_ID,
      event: "networkChanged",
      target: PAGE_TARGET,
    });
  });

  test("accepts an empty accountsChanged as a disconnect signal", () => {
    expect(readProviderEvent(accountsChangedEvent([]))).toEqual({
      data: [],
      event: "accountsChanged",
      target: PAGE_TARGET,
    });
  });

  test("rejects untargeted, malformed, or oversized payloads", () => {
    expect(readProviderEvent(null)).toBeNull();
    expect(
      readProviderEvent({ data: [ADDRESS], event: "accountsChanged", target: "elsewhere" }),
    ).toBeNull();
    expect(
      readProviderEvent({ data: [ADDRESS], event: "unknown", target: PAGE_TARGET }),
    ).toBeNull();
    expect(
      readProviderEvent({ data: [42], event: "accountsChanged", target: PAGE_TARGET }),
    ).toBeNull();
    expect(
      readProviderEvent({ data: [""], event: "accountsChanged", target: PAGE_TARGET }),
    ).toBeNull();
    expect(
      readProviderEvent({ data: "SN_MAIN", event: "networkChanged", target: PAGE_TARGET }),
    ).toBeNull();
    expect(
      readProviderEvent({
        data: [ADDRESS],
        event: "accountsChanged",
        extra: true,
        target: PAGE_TARGET,
      }),
    ).toBeNull();
  });
});

describe("createProviderEventHub", () => {
  test("delivers events to subscribed handlers and honors off", () => {
    const hub = createProviderEventHub();
    const seen: unknown[] = [];
    const handler = (data: unknown) => seen.push(data);

    hub.on("accountsChanged", handler);
    hub.emit(accountsChangedEvent([ADDRESS]));
    hub.off("accountsChanged", handler);
    hub.emit(accountsChangedEvent([]));

    expect(seen).toEqual([[ADDRESS]]);
  });

  test("ignores unknown event names and non-function handlers", () => {
    const hub = createProviderEventHub();
    const seen: unknown[] = [];

    hub.on("chainChanged", (data: unknown) => seen.push(data));
    hub.on("networkChanged", "not a function");
    hub.emit(networkChangedEvent(CHAIN_ID));

    expect(seen).toEqual([]);
  });

  test("keeps delivering when one handler throws", () => {
    const hub = createProviderEventHub();
    const seen: unknown[] = [];

    hub.on("networkChanged", () => {
      throw new Error("faulty dapp handler");
    });
    hub.on("networkChanged", (data: unknown) => seen.push(data));
    hub.emit(networkChangedEvent(CHAIN_ID));

    expect(seen).toEqual([CHAIN_ID]);
  });
});

describe("isWalletEventMessage", () => {
  test("accepts the three broadcast shapes", () => {
    expect(isWalletEventMessage({ event: "accountsChanged", type: "wallet.event" })).toBe(true);
    expect(isWalletEventMessage({ event: "approvalsChanged", type: "wallet.event" })).toBe(true);
    expect(
      isWalletEventMessage({ chainId: CHAIN_ID, event: "networkChanged", type: "wallet.event" }),
    ).toBe(true);
  });

  test("rejects unknown events, bad chain ids, and extra keys", () => {
    expect(isWalletEventMessage({ event: "networkChanged", type: "wallet.event" })).toBe(false);
    expect(
      isWalletEventMessage({ chainId: "SN_MAIN", event: "networkChanged", type: "wallet.event" }),
    ).toBe(false);
    expect(
      isWalletEventMessage({
        addresses: [ADDRESS],
        event: "accountsChanged",
        type: "wallet.event",
      }),
    ).toBe(false);
    expect(isWalletEventMessage({ event: "accountsChanged", type: "wallet.status" })).toBe(false);
  });
});

describe("addressesFromPayload", () => {
  test("reads address lists and account results, but not errors", () => {
    expect(addressesFromPayload({ result: [ADDRESS, OTHER] })).toEqual([ADDRESS, OTHER]);
    expect(
      addressesFromPayload({ result: { accounts: [{ address: ADDRESS }], ok: true } }),
    ).toEqual([ADDRESS]);
    expect(
      addressesFromPayload({ result: { accounts: [{ id: "no-address" }], ok: true } }),
    ).toBeNull();
    expect(addressesFromPayload({})).toBeNull();
    expect(addressesFromPayload({ result: "0x1" })).toBeNull();
  });
});

describe("pageEventsFor", () => {
  const accountsMessage = { event: "accountsChanged", type: "wallet.event" } as const;
  const networkMessage = {
    chainId: CHAIN_ID,
    event: "networkChanged",
    type: "wallet.event",
  } as const;

  test("stays silent for pages that never connected", () => {
    expect(pageEventsFor({ addresses: [], lastAddresses: null, message: accountsMessage })).toEqual(
      [],
    );
    expect(pageEventsFor({ addresses: [], lastAddresses: null, message: networkMessage })).toEqual(
      [],
    );
  });

  test("tells connected pages about network changes", () => {
    expect(
      pageEventsFor({ addresses: [ADDRESS], lastAddresses: [ADDRESS], message: networkMessage }),
    ).toEqual([networkChangedEvent(CHAIN_ID)]);
  });

  test("announces disconnects to previously connected pages", () => {
    expect(
      pageEventsFor({ addresses: [], lastAddresses: [ADDRESS], message: accountsMessage }),
    ).toEqual([accountsChangedEvent([])]);
  });

  test("announces first grants and account swaps", () => {
    expect(
      pageEventsFor({ addresses: [ADDRESS], lastAddresses: null, message: accountsMessage }),
    ).toEqual([accountsChangedEvent([ADDRESS])]);
    expect(
      pageEventsFor({ addresses: [OTHER], lastAddresses: [ADDRESS], message: accountsMessage }),
    ).toEqual([accountsChangedEvent([OTHER])]);
  });

  test("suppresses duplicate accountsChanged when nothing changed", () => {
    expect(
      pageEventsFor({ addresses: [ADDRESS], lastAddresses: [ADDRESS], message: accountsMessage }),
    ).toEqual([]);
  });

  test("bundles the account change when a network switch also swaps accounts", () => {
    expect(
      pageEventsFor({ addresses: [OTHER], lastAddresses: [ADDRESS], message: networkMessage }),
    ).toEqual([networkChangedEvent(CHAIN_ID), accountsChangedEvent([OTHER])]);
  });
});
