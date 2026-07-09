/**
 * Gate-view markup checks: the onboarding screen ships the recovery-phrase
 * reveal toggle hidden and unmasked by default, so a freshly generated phrase
 * can be blurred by the binder until the user deliberately reveals it.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../src/popup/responses";
import { onboarding } from "../src/sidepanel/gate-views";

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: false,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

describe("onboarding gate view", () => {
  test("carries a reveal toggle that starts hidden and defaults to showing", () => {
    const html = onboarding(status);

    expect(html).toContain('id="phrase-toggle"');
    expect(html).toMatch(/id="phrase-toggle"[^>]*\btype="button"/);
    expect(html).toMatch(/id="phrase-toggle"[^>]*\bhidden/);
    expect(html).toContain("Tap to show phrase");
  });

  test("does not blur the recovery phrase in the static markup", () => {
    // The mask is applied by the binder only after generation; the default
    // markup (which also serves the paste-to-import flow) stays unmasked.
    const html = onboarding(status);
    const textarea = html.slice(html.indexOf("<textarea"), html.indexOf("</textarea>"));

    expect(textarea).not.toContain("is-masked");
  });
});
