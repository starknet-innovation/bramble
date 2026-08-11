/** Send surface repaint isolation while a transaction is in flight. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { shouldPreserveTransferSurface } from "../../../../src/sidepanel/journeys/send/transfer-surface";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: "SN_MAIN:0x123",
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

beforeAll(registerDom);
afterAll(unregisterDom);

describe("Send surface repaint guard", () => {
  test("preserves only the active account's in-flight journey", () => {
    const app = document.createElement("div");
    app.append(
      document
        .createRange()
        .createContextualFragment(
          '<form id="transfer-form" data-stage="authorizing"><input name="accountId" value="SN_MAIN:0x123"></form>',
        ),
    );
    expect(shouldPreserveTransferSurface(app, "send", status, [], [])).toBe(true);
    expect(
      shouldPreserveTransferSurface(app, "send", status, [{ id: "request" } as never], []),
    ).toBe(false);
    expect(
      shouldPreserveTransferSurface(
        app,
        "send",
        { ...status, activeAccountId: "SN_MAIN:0x999" },
        [],
        [],
      ),
    ).toBe(false);
    app.querySelector("form")?.setAttribute("data-stage", "submitted");
    expect(shouldPreserveTransferSurface(app, "send", status, [], [])).toBe(false);
  });
});
