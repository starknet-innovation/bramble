/** Nostr public-value boundaries stay bounded before data reaches Krusty. */
import { describe, expect, test } from "bun:test";
import {
  isNostrApplicationData,
  isNostrEvent,
  parseNostrEventJson,
} from "@bramble/wallet-model/nostr";

const event = (content = "ciphertext") => ({
  content,
  created_at: 1,
  id: "11".repeat(32),
  kind: 1_059,
  pubkey: "22".repeat(32),
  sig: "33".repeat(64),
  tags: [["p", "44".repeat(32)]],
});

describe("Nostr event boundary", () => {
  test("bounds application data by UTF-8 bytes", () => {
    expect(isNostrApplicationData("payload")).toBe(true);
    expect(isNostrApplicationData("🦃".repeat(8_192))).toBe(true);
    expect(isNostrApplicationData("🦃".repeat(8_193))).toBe(false);
  });

  test("accepts only canonical, bounded signed event shapes", () => {
    expect(isNostrEvent(event())).toBe(true);
    expect(isNostrEvent({ ...event(), extra: true })).toBe(false);
    expect(isNostrEvent({ ...event(), pubkey: `0x${"22".repeat(32)}` })).toBe(false);
    expect(isNostrEvent(event("🦊".repeat(40_000)))).toBe(false);
  });

  test("parses valid JSON and rejects malformed or oversized input", () => {
    expect(parseNostrEventJson(JSON.stringify(event()))?.kind).toBe(1_059);
    expect(parseNostrEventJson("{")).toBeNull();
    expect(parseNostrEventJson("🦊".repeat(40_000))).toBeNull();
  });
});
