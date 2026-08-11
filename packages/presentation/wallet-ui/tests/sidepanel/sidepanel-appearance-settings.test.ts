/**
 * Appearance settings persist the wallet-request surface through the same
 * permissioned preference path as theme and currency.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { emptyStatus, type SidepanelWallet } from "../../src/sidepanel/runtime";
import { bindAppearance, type SettingsUiDeps } from "../../src/sidepanel/settings-ui";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("appearance settings", () => {
  test("persists a toolbar-popup approval preference", async () => {
    const app = document.createElement("div");
    app.innerHTML =
      '<button data-approval-surface="popup" aria-pressed="false">Toolbar popup</button>';
    const updates: unknown[] = [];
    const wallet = {
      setDisplay(input: unknown) {
        updates.push(input);
        return new Promise<void>(() => undefined);
      },
    } as unknown as SidepanelWallet;
    bindAppearance({
      activeAccountId: () => null,
      app,
      expandedGroup: () => null,
      networkId: () => "SN_MAIN",
      openAssign: () => null,
      refresh: async () => emptyStatus(),
      render: async () => undefined,
      setExpandedGroup: () => undefined,
      setOpenAssign: () => undefined,
      startAddAccount: () => undefined,
      wallet,
    } satisfies SettingsUiDeps);

    app.querySelector<HTMLButtonElement>("[data-approval-surface]")?.click();
    await flush();

    expect(updates).toEqual([{ approvalSurface: "popup" }]);
  });
});
