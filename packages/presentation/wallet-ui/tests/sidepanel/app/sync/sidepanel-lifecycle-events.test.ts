/** Side-panel wallet events accept only background sender evidence. */

import { describe, expect, test } from "bun:test";
import { isBackgroundWalletEvent } from "../../../../src/sidepanel/app/sync/lifecycle";

const EVENT = { event: "approvalsChanged", type: "wallet.event" } as const;

describe("side-panel wallet event sender gate", () => {
  test("accepts a background event without tab evidence", () => {
    expect(isBackgroundWalletEvent(EVENT, { id: "extension-id" })).toBe(true);
  });

  test("rejects content-script and senderless forgeries", () => {
    expect(isBackgroundWalletEvent(EVENT, { id: "extension-id", tab: { id: 7 } })).toBe(false);
    expect(isBackgroundWalletEvent(EVENT, undefined)).toBe(false);
  });

  test("rejects unrelated background messages", () => {
    expect(isBackgroundWalletEvent({ ok: true }, { id: "extension-id" })).toBe(false);
  });
});
