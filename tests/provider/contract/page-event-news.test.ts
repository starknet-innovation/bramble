/**
 * A page hears `networkChanged` only when its chain actually changes
 * (Sherlock 188, 215). The wallet announces the active network after account
 * switches and unlocks, which usually leave it where it was, and dapps
 * commonly reset on the event, so the in-page provider drops a repeat. The
 * wiring is exercised in tests/conformance/inpage-chain-events.test.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  accountsChangedEvent,
  isPageEventNews,
  networkChangedEvent,
} from "@bramble/wallet-protocol/events";

const MAINNET = "0x534e5f4d41494e";
const SEPOLIA = "0x534e5f5345504f4c4941";

describe("isPageEventNews", () => {
  test("drops a networkChanged naming the chain the page already holds", () => {
    expect(isPageEventNews(networkChangedEvent(MAINNET), MAINNET)).toBe(false);
  });

  test("passes a networkChanged that moves the page, or its first one", () => {
    expect(isPageEventNews(networkChangedEvent(SEPOLIA), MAINNET)).toBe(true);
    expect(isPageEventNews(networkChangedEvent(MAINNET), undefined)).toBe(true);
  });

  test("passes every accountsChanged", () => {
    expect(isPageEventNews(accountsChangedEvent([]), MAINNET)).toBe(true);
    expect(isPageEventNews(accountsChangedEvent(["0x1"]), MAINNET)).toBe(true);
  });
});
