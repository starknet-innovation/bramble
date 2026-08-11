/** Multisig proposal repaint guards preserve active work without blocking safety takeovers. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import { shouldPreserveMultisigProposalSurface } from "../../src/sidepanel/multisig-surface";
import { registerDom, unregisterDom } from "../support/groups-harness";

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

const formSurface = (): { readonly app: HTMLElement; readonly form: HTMLFormElement } => {
  document.body.innerHTML = `<main><form id="multisig-propose-form" data-multisig-id="${MULTISIG_ID}" data-proposal-stage="recipient"><input id="proposal-recipient-search" /></form></main>`;
  const app = document.querySelector<HTMLElement>("main");
  const form = document.querySelector<HTMLFormElement>("form");
  if (!app || !form) throw new Error("proposal fixture missing");
  return { app, form };
};

describe("shouldPreserveMultisigProposalSurface", () => {
  test("allows initial hydration, then preserves focus and later stages", () => {
    const { app, form } = formSurface();
    expect(
      shouldPreserveMultisigProposalSurface(app, "multisig-propose", MULTISIG_ID, status, [], []),
    ).toBe(false);

    form.querySelector<HTMLInputElement>("input")?.focus();
    expect(
      shouldPreserveMultisigProposalSurface(app, "multisig-propose", MULTISIG_ID, status, [], []),
    ).toBe(true);

    document.body.focus();
    form.dataset["proposalStage"] = "review";
    expect(
      shouldPreserveMultisigProposalSurface(app, "multisig-propose", MULTISIG_ID, status, [], []),
    ).toBe(true);
  });

  test("never preserves across navigation, a lock, or an identity mismatch", () => {
    const { app } = formSurface();
    const args = [app, "multisig-propose", MULTISIG_ID, status, [], []] as const;
    expect(shouldPreserveMultisigProposalSurface(...args)).toBe(false);
    expect(shouldPreserveMultisigProposalSurface(app, "home", MULTISIG_ID, status, [], [])).toBe(
      false,
    );
    expect(
      shouldPreserveMultisigProposalSurface(
        app,
        "multisig-propose",
        "SN_MAIN:0x999",
        status,
        [],
        [],
      ),
    ).toBe(false);
    expect(
      shouldPreserveMultisigProposalSurface(
        app,
        "multisig-propose",
        MULTISIG_ID,
        { ...status, locked: true },
        [],
        [],
      ),
    ).toBe(false);
  });
});
