/**
 * Audit #170: the truncated account label is element content in three
 * innerHTML-rendered rows, so it must be escaped like every other dynamic
 * value — even though stored addresses are validated hex today. Each view is
 * fed a hand-built account whose address carries markup.
 */
import { describe, expect, test } from "bun:test";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { ArgentMultisigView } from "../../../src/popup/responses/multisig-responses";
import type { WalletStatus } from "../../../src/popup/responses/responses";
import { accountNamesSection } from "../../../src/sidepanel/journeys/settings/account-names";
import { groupsSection } from "../../../src/sidepanel/journeys/settings/group-members";
import { accountDrawer } from "../../../src/sidepanel/shell/account-drawer";

// shortAddress keeps the first six and last four characters: "<b>x<i" … "</i>".
const hostile: AccountRef = { ...account, address: "<b>x<i>padding</i>" };
const status: WalletStatus = {
  accountCount: 1,
  accounts: [hostile],
  activeAccountId: hostile.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: hostile.networkId,
  networks: [{ id: hostile.networkId, name: "Starknet Mainnet" }],
  ready: true,
};

const expectEscaped = (html: string): void => {
  expect(html).not.toContain("<b>x<i");
  expect(html).toContain("&lt;b&gt;x&lt;i");
};

describe("account label escaping", () => {
  test("account drawer row", () => {
    expectEscaped(accountDrawer(status, hostile, preferences));
  });

  test("account names row", () => {
    expectEscaped(accountNamesSection(status, preferences, []));
  });

  test("folder members checklist row", () => {
    const group = { accountIds: [hostile.id], icon: "folder", id: "g1", name: "Work" } as const;
    expectEscaped(groupsSection([group] as never, [hostile], preferences, "g1", status.networks));
  });

  test("multisig authority line escapes markup and keeps a numeric threshold", () => {
    const view = {
      authorityStatus: "available",
      config: { classHash: "0x1", signerGuids: ["0x2"], threshold: 1 },
      record: {
        accountContractType: "argent-multisig",
        address: account.address,
        classHash: "0x1",
        id: "SN_MAIN:0x123",
        name: "Treasury",
        networkId: hostile.networkId,
      },
      unsupportedSigners: [],
    } satisfies ArgentMultisigView;
    expect(accountDrawer(status, null, preferences, undefined, false, [view])).toContain(
      "Multisig · 1 of 1",
    );
    const hostileView: ArgentMultisigView = {
      ...view,
      config: {
        ...view.config,
        threshold: "<img src=x>" as unknown as number,
      },
    };
    const html = accountDrawer(status, null, preferences, undefined, false, [hostileView]);
    expect(html).not.toContain("<img");
    expect(html).toContain("Multisig · &lt;img src=x&gt; of 1");
  });
});
