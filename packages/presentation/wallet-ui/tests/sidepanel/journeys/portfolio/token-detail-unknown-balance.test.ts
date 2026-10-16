/**
 * Token detail shows an unknown public balance as "—", never as 0 (#680), as
 * Home does since the v0.10.6 audit (M5).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { tokenDetailFlow } from "../../../../src/sidepanel/journeys/portfolio/token-flows";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};
const token = defaultWalletPreferences().tokens.find(
  (entry) => entry.networkId === "SN_MAIN" && entry.symbol === "STRK",
);
if (!token) throw new Error("STRK fixture missing");
const noPrivacy: PrivacyDisclosureState = { error: null, loading: false, value: null };

const amountOf = (html: string): string | undefined => {
  const node = document.createElement("div");
  node.innerHTML = html;
  return node.querySelector(".token-side .token-amount")?.textContent ?? undefined;
};

describe("token detail balance", () => {
  test("an unread balance shows the unknown marker", () => {
    const html = tokenDetailFlow(status, token, undefined, [], null, "usd", noPrivacy, true);
    expect(amountOf(html)).toBe("—");
    expect(html).not.toContain(`0 ${token.symbol}`);
  });

  test("an empty formatted balance is unknown too", () => {
    const balance = { ...token, balance: "", formatted: "" };
    expect(
      amountOf(tokenDetailFlow(status, token, balance, [], null, "usd", noPrivacy, true)),
    ).toBe("—");
  });

  test("a known balance, zero included, shows with its symbol", () => {
    for (const formatted of ["0", "1.5"]) {
      const balance = { ...token, balance: "1", formatted };
      expect(
        amountOf(tokenDetailFlow(status, token, balance, [], null, "usd", noPrivacy, true)),
      ).toBe(`${formatted} ${token.symbol}`);
    }
  });
});
