/**
 * Multisig detail and propose screens when the referenced multisig is no longer
 * watched: both builders short-circuit to a "no longer watched" empty screen
 * instead of dereferencing a null record.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  multisigDetailFlow,
  multisigProposeFlow,
} from "../../../../src/sidepanel/journeys/multisig/multisig-views";

const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

describe("multisig empty states", () => {
  test("detail screen renders the unwatched empty state for a missing record", () => {
    const html = multisigDetailFlow(status, null, null, []);
    expect(html).toContain("This multisig is no longer watched.");
    expect(html).toContain('id="wallet-screen-multisig-detail"');
    // The signers/proposals sections are not rendered without a record.
    expect(html).not.toContain('id="multisig-track-form"');
  });

  test("propose screen renders the unwatched empty state for a missing record", () => {
    const html = multisigProposeFlow(status, null);
    expect(html).toContain("This multisig is no longer watched.");
    expect(html).toContain('id="wallet-screen-multisig-propose"');
    expect(html).not.toContain('id="multisig-propose-form"');
  });
});
