/**
 * Broadcast decision edge: `wallet.switchChain` only carries a networkChanged
 * event when the response actually reports a string chainId; a switch response
 * with a non-string (or missing) chainId broadcasts accounts only.
 */
import { describe, expect, test } from "bun:test";
import { walletEventBroadcasts } from "../src/background/events";

const accountsChanged = { event: "accountsChanged", type: "wallet.event" } as const;

describe("walletEventBroadcasts switchChain non-string chainId", () => {
  test("omits networkChanged when the switch response has no string chainId", () => {
    // Missing chainId: the ternary's false branch yields null, so only the
    // accounts refresh is broadcast (no networkChanged, no leaked chain id).
    expect(walletEventBroadcasts({ type: "wallet.switchChain" }, { ok: true })).toEqual([
      accountsChanged,
    ]);
  });

  test("omits networkChanged when the switch response chainId is not a string", () => {
    expect(
      walletEventBroadcasts({ type: "wallet.switchChain" }, { chainId: 12345, ok: true }),
    ).toEqual([accountsChanged]);
  });
});
