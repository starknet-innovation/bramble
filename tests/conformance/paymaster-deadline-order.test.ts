/**
 * The wallet's paymaster deadline ends before the STRK20 gateway's (Sherlock
 * #159).
 *
 * The wallet reaches the relay through the gateway. If the gateway's upstream
 * deadline expired first, the wallet would learn of a slow relay only as a
 * gateway status, after the relay may already have forwarded the transaction.
 * The wallet reads a 5xx on a broadcast as a lost answer either way, but its
 * own deadline is the one it controls and reports precisely, so it must fire
 * first, with a margin for the gateway's own request handling.
 */
import { describe, expect, test } from "bun:test";
import { PAYMASTER_UPSTREAM_TIMEOUT_MS } from "../../apps/terminal/api/_lib/security";
import { PAYMASTER_TIMEOUT_MS } from "../../packages/features/privacy/src/paymaster/paymaster-rpc";

const MARGIN_MS = 2_000;

describe("paymaster deadlines", () => {
  test("the wallet gives up before the gateway does", () => {
    expect(PAYMASTER_TIMEOUT_MS + MARGIN_MS).toBeLessThanOrEqual(PAYMASTER_UPSTREAM_TIMEOUT_MS);
  });
});
