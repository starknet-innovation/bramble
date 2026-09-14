/**
 * Identity screens under Settings show truncated addresses, and each one is
 * copyable in full: the Accounts & groups rows carry their copy beside the
 * select control (never inside it), and the deploy review's address receipt
 * row carries a copy action.
 */
import { describe, expect, test } from "bun:test";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";

const status: WalletStatus = {
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

describe("identity screens copy truncated addresses in full", () => {
  test("account rows stay select controls and carry their address copy beside them", () => {
    const html = dashboard("account", status, [], preferences, { balances: [] });
    const rows = html.slice(
      html.indexOf('aria-label="Accounts"'),
      html.indexOf('id="new-account"'),
    );

    for (const stored of [account, secondAccount]) {
      // Truncated in the row, full on hover, copied whole by the trailing control.
      expect(rows).toContain(
        `<code title="${stored.address}">0x${stored.address.slice(2, 6)}…${stored.address.slice(-4)}</code>`,
      );
      expect(rows).toMatch(
        new RegExp(
          `<div class="option-row-line">\\s*<button class="option-row" data-account-id="${stored.id}"[\\s\\S]*?</button>\\s*<button class="icon-button ghost copy-inline" data-copy="${stored.address}" type="button" aria-label="Copy [^"]+ address"`,
        ),
      );
      expect(rows).not.toContain(`<code>${stored.address}</code>`);
    }
    // The copy control is a sibling of the row, never nested in it: no
    // data-copy appears between a row's opening tag and its closing tag.
    for (const row of rows.split('<button class="option-row"').slice(1)) {
      expect(row.slice(0, row.indexOf("</button>"))).not.toContain("data-copy");
    }
  });

  test("deploy review copies the account address in full beside its truncated value", () => {
    const html = dashboard("deploy-account", status, [], preferences, { balances: [] }, false);
    const review = html.slice(
      html.indexOf('id="deploy-review-stage"'),
      html.indexOf('id="deploy-review"'),
    );

    expect(review).toContain(
      `<code>0x${account.address.slice(2, 6)}…${account.address.slice(-4)}</code>`,
    );
    expect(review).toContain(
      `data-copy="${account.address}" type="button" aria-label="Copy address"`,
    );
  });
});
