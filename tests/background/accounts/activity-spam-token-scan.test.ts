/**
 * Likely-spam tokens in the Activity history scan (Sherlock 249).
 *
 * A tracked token the wallet flags as likely spam, such as a contract calling
 * itself USDC, is scanned under the untracked identity. Its transfers then
 * read "Received 5000 TOKEN", are never priced or shown with a logo by the
 * spoofed symbol, and fall under the untracked-token planted-row rules.
 */
import { expect, test } from "bun:test";
import { isLikelySpam } from "@bramble/portfolio/token-registry";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { TransactionHistoryScan } from "@bramble/transactions/tx-history-scan";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import { extensionSender, makeHarness } from "../../support/wallet-activity-harness";

const SPOOF_ADDRESS = "0x5f00f";
const spoof: TokenConfig = {
  address: SPOOF_ADDRESS,
  decimals: 6,
  id: `SN_MAIN:USDC:${SPOOF_ADDRESS}`,
  name: "USD Coin",
  networkId: "SN_MAIN",
  symbol: "USDC",
};

test("scans a likely-spam token under the untracked identity", async () => {
  expect(isLikelySpam(spoof)).toBe(true);
  const defaults = defaultWalletPreferences();
  const scans: TransactionHistoryScan[] = [];
  const { handler } = makeHarness({
    onHistoryScan: (scan) => scans.push(scan),
    preferences: { ...defaults, tokens: [...defaults.tokens, spoof] },
  });

  await handler(
    { forceHistory: true, refreshHistory: true, type: "wallet.activity" },
    extensionSender,
  );

  expect(scans).toHaveLength(1);
  const scanned = scans[0]?.tokens ?? [];
  expect(scanned.find((token) => token.address === SPOOF_ADDRESS)).toEqual({
    ...spoof,
    name: "Untracked token",
    symbol: "TOKEN",
  });
  // Tokens that are not flagged keep their own identity.
  const genuine = defaults.tokens.filter((token) => token.networkId === "SN_MAIN");
  expect(genuine.length).toBeGreaterThan(0);
  for (const token of genuine) {
    expect(scanned.find((entry) => entry.id === token.id)).toEqual(token);
  }
});
