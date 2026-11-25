/**
 * Unlock (locked-vault) gate view: the passphrase-only form the side panel shows
 * for an existing but locked wallet, including the ready-gated submit button.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { locked } from "../../../../src/sidepanel/journeys/onboarding/gate-views";

const lockedStatus = (ready: boolean): WalletStatus => ({
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: true,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready,
});

describe("locked gate view", () => {
  test("renders the unlock form with a passphrase field", () => {
    const html = locked(lockedStatus(true));
    expect(html).toContain("Welcome back");
    expect(html).toContain('id="unlock-form"');
    expect(html).toContain('name="vaultPassphrase"');
    expect(html).toContain('type="password"');
    expect(html).toContain("Unlock");
    // The heading already says what the one field is for, so its label is
    // kept for assistive tech only rather than repeated above the input.
    expect(html).toContain('<label><span class="sr-only">Password</span><input');
    // Not the onboarding create form.
    expect(html).not.toContain('id="create-form"');
  });

  test("enables the submit button only when the wallet is ready", () => {
    expect(locked(lockedStatus(true))).toMatch(/<button type="submit">Unlock<\/button>/);
    expect(locked(lockedStatus(false))).toMatch(/<button type="submit" disabled>Unlock<\/button>/);
  });

  test("names the waiting origin request without a lede repeating it", () => {
    const html = locked(lockedStatus(true), [
      {
        id: "123e4567-e89b-42d3-a456-426614174000",
        kind: "connect",
        origin: "https://terminal.example",
      },
    ]);

    // The callout below the heading already says a site is waiting and which
    // one; a lede above it said the same thing in different words.
    expect(html).not.toContain("Unlock to review the wallet request waiting for you.");
    expect(html).toContain("Site request waiting");
    expect(html).toContain("https://terminal.example");
  });

  test("offers forgot-password guidance that removes nothing (issue 903)", () => {
    const html = locked(lockedStatus(true));
    // A collapsed, repaint-persistent disclosure under Unlock: text only.
    expect(html).toContain(
      '<details class="disclosure gate-forgot" data-disclosure="unlock-forgot-password">',
    );
    expect(html).toContain("Forgot password?");
    // Catalog text is escaped into the template; the rendered text is unchanged.
    expect(html).toContain("Bramble can&#39;t recover or reset it. It&#39;s never stored.");
    expect(html).toContain("Accounts from imported keys or other recovery phrases");
    expect(html).toContain("Ledger accounts (add them again with your device)");
    expect(html).toContain(
      "Without your recovery phrase, removing Bramble loses access to its funds for good.",
    );
    // No wallet-removing control lives on the unlock screen (issues 456, 715):
    // the form's one button is still Unlock.
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).not.toContain("data-action");
  });
});
