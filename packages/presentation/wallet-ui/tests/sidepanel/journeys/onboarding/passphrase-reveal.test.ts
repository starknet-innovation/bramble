/**
 * The passphrase a user is choosing can be shown, and never stays shown.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindPassphraseReveal } from "../../../../src/sidepanel/journeys/onboarding/passphrase-reveal";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

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

const mount = (): Element => {
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  bindPassphraseReveal(app);
  return app;
};

const fieldFor = (app: Element, name: string) =>
  app.querySelector<HTMLInputElement>(`input[name="${name}"]`);

describe("passphrase reveal", () => {
  test("shows and re-masks the passphrase being created", () => {
    const app = mount();
    const input = fieldFor(app, "vaultPassphrase");
    const control = app.querySelector<HTMLButtonElement>(
      '[data-onboarding-step="password"] [data-passphrase-reveal]',
    );
    expect(input?.type).toBe("password");
    control?.click();
    expect(input?.type).toBe("text");
    expect(control?.getAttribute("aria-label")).toBe("Hide passphrase");
    control?.click();
    expect(input?.type).toBe("password");
    expect(control?.getAttribute("aria-label")).toBe("Show passphrase");
  });

  test("both credential screens offer it, and the confirmation never unmasks", () => {
    const app = mount();
    // Software onboarding and Ledger setup are the two screens that create a
    // passphrase; every other passphrase field is entering an existing one.
    expect(app.querySelectorAll("[data-passphrase-reveal]").length).toBe(2);
    expect(fieldFor(app, "ledgerVaultPassphrase")?.type).toBe("password");
    // The confirmation is typed from memory on purpose — that is what it checks.
    expect(fieldFor(app, "vaultPassphraseConfirm")?.type).toBe("password");
    expect(
      fieldFor(app, "vaultPassphraseConfirm")
        ?.closest("label")
        ?.querySelector("[data-passphrase-reveal]"),
    ).toBeNull();
  });

  test("a rebind re-masks a field that was left showing", () => {
    // A repaint, a step back, or a second visit must not leave the value on
    // screen behind a form the reader is no longer looking at.
    const app = mount();
    const input = fieldFor(app, "vaultPassphrase");
    app
      .querySelector<HTMLButtonElement>(
        '[data-onboarding-step="password"] [data-passphrase-reveal]',
      )
      ?.click();
    expect(input?.type).toBe("text");
    bindPassphraseReveal(app);
    expect(input?.type).toBe("password");
  });

  test("the unlock screen has no reveal", () => {
    const app = document.createElement("div");
    app.replaceChildren(
      document.createRange().createContextualFragment(onboarding({ ...status, hasVault: true })),
    );
    expect(app.querySelector("#unlock-form [data-passphrase-reveal]")).toBeNull();
  });
});
