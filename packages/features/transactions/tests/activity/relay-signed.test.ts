/**
 * #299: the activity store gains two relay-aware shapes without weakening the
 * trust boundary. A locally signed "relay-signed" row must carry the exact
 * SNIP-12 message hash the signature committed to; a chain-discovered relay
 * execution (`origin === "relay"`) must never carry one, so a discovered row
 * cannot masquerade as a message this wallet signed. Legacy rows keep loading
 * unchanged, and an unknown origin is refused.
 */
import { describe, expect, test } from "bun:test";
import { isActivityEntry } from "@bramble/transactions/activity";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const CALLER = "0x0abc";
const HASH = "0x2";
const NONCE = "0x7";

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  accountId: `SN_MAIN:${ACCOUNT}`,
  hash: HASH,
  kind: "invoke",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt: 1,
  summary: "Relayed execution",
  ...overrides,
});

const detail = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  callCount: 1,
  caller: CALLER,
  nonce: NONCE,
  revision: "2",
  ...overrides,
});

describe("relay-signed activity rows", () => {
  test("accept a locally signed row that carries its message hash", () => {
    expect(
      isActivityEntry(
        row({
          kind: "relay-signed",
          origin: "wallet",
          snip9: detail({ messageHash: HASH }),
          summary: "Signed for relay",
        }),
      ),
    ).toBe(true);
  });

  test("require the signed message hash", () => {
    expect(isActivityEntry(row({ kind: "relay-signed", origin: "wallet", snip9: detail() }))).toBe(
      false,
    );
    expect(isActivityEntry(row({ kind: "relay-signed", origin: "wallet" }))).toBe(false);
  });

  test("refuse a message hash on a chain-discovered execution", () => {
    expect(isActivityEntry(row({ origin: "relay", snip9: detail({ messageHash: HASH }) }))).toBe(
      false,
    );
  });
});

describe("relay execution rows", () => {
  test("accept a discovered execution with a detail that has no message hash", () => {
    expect(isActivityEntry(row({ origin: "relay", snip9: detail() }))).toBe(true);
  });

  test("accept a relay row without a detail (older discovery shape)", () => {
    expect(isActivityEntry(row({ origin: "relay" }))).toBe(true);
  });
});

describe("detail validation", () => {
  const withDetail = (overrides: Record<string, unknown>): boolean =>
    isActivityEntry(row({ origin: "relay", snip9: detail(overrides) }));

  test("refuse a non-canonical felt", () => {
    expect(withDetail({ caller: "0xZZ" })).toBe(false);
    expect(withDetail({ nonce: "nope" })).toBe(false);
  });

  test("refuse a negative or non-integer call count", () => {
    expect(withDetail({ callCount: -1 })).toBe(false);
    expect(withDetail({ callCount: 1.5 })).toBe(false);
  });

  test("refuse an unknown revision, an extra key and an empty origin", () => {
    expect(withDetail({ revision: "3" })).toBe(false);
    expect(withDetail({ extra: "x" })).toBe(false);
    expect(withDetail({ dappOrigin: "" })).toBe(false);
  });

  test("accept a valid dapp origin", () => {
    expect(withDetail({ dappOrigin: "https://example.test" })).toBe(true);
  });
});

describe("provenance", () => {
  test("accept legacy rows with neither origin nor detail", () => {
    expect(isActivityEntry(row({}))).toBe(true);
  });

  test("refuse an unknown origin", () => {
    expect(isActivityEntry(row({ origin: "explorer" }))).toBe(false);
  });
});
