/** Frozen-intent composer repaint guards preserve edits without masking safety takeovers. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { shouldPreserveMultisigIntentSurface } from "../../../../src/sidepanel/journeys/multisig/multisig-surface";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const MULTISIG_ID = "SN_MAIN:0x123";
const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const formSurface = (): { readonly app: HTMLElement; readonly input: HTMLInputElement } => {
  document.body.innerHTML = `<main><form id="multisig-propose-form" data-multisig-id="${MULTISIG_ID}"><input /></form></main>`;
  const app = document.querySelector<HTMLElement>("main");
  const input = document.querySelector<HTMLInputElement>("input");
  if (!app || !input) throw new Error("intent fixture missing");
  return { app, input };
};

describe("shouldPreserveMultisigIntentSurface", () => {
  test("preserves only the focused composer for the selected multisig", () => {
    const { app, input } = formSurface();
    expect(
      shouldPreserveMultisigIntentSurface(app, "multisig-propose", MULTISIG_ID, status, [], []),
    ).toBe(false);
    input.focus();
    expect(
      shouldPreserveMultisigIntentSurface(app, "multisig-propose", MULTISIG_ID, status, [], []),
    ).toBe(true);
    expect(
      shouldPreserveMultisigIntentSurface(app, "multisig-propose", "SN_MAIN:0x999", status, [], []),
    ).toBe(false);
  });

  test("never survives navigation, lock, or an unsnoozed external approval", () => {
    const { app, input } = formSurface();
    input.focus();
    expect(shouldPreserveMultisigIntentSurface(app, "home", MULTISIG_ID, status, [], [])).toBe(
      false,
    );
    expect(
      shouldPreserveMultisigIntentSurface(
        app,
        "multisig-propose",
        MULTISIG_ID,
        { ...status, locked: true },
        [],
        [],
      ),
    ).toBe(false);
    expect(
      shouldPreserveMultisigIntentSurface(
        app,
        "multisig-propose",
        MULTISIG_ID,
        status,
        [{ id: "approval", kind: "connect", origin: "https://dapp.example" }],
        [],
      ),
    ).toBe(false);
  });
});
