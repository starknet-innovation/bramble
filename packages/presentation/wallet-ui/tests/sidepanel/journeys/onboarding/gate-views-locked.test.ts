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
    // Not the onboarding create form.
    expect(html).not.toContain('id="create-form"');
  });

  test("enables the submit button only when the wallet is ready", () => {
    expect(locked(lockedStatus(true))).toMatch(/<button type="submit">Unlock<\/button>/);
    expect(locked(lockedStatus(false))).toMatch(/<button type="submit" disabled>Unlock<\/button>/);
  });

  test("explains that an origin request will continue after unlock", () => {
    const html = locked(lockedStatus(true), [
      {
        id: "123e4567-e89b-42d3-a456-426614174000",
        kind: "connect",
        origin: "https://terminal.example",
      },
    ]);

    expect(html).toContain("Unlock to review the wallet request waiting for you.");
    expect(html).toContain("Site request waiting");
    expect(html).toContain("https://terminal.example");
  });
});
