/**
 * The weak-passphrase acknowledgement on the software onboarding password step.
 * Lowering the length floor means a genuinely poor passphrase can now clear the
 * validator, so the speed bump is an explicit acknowledgement rather than a
 * refusal: the control appears only while it applies, gates the step while it is
 * unticked, and never blocks a passphrase the meter does not call weak.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../../../src/sidepanel/journeys/onboarding/onboarding-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const WEAK = "aaaaaaaaaaaa";
const STRONG = "correct horse battery staple";

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: false,
  locked: false,
  network: "Starknet Sepolia",
  networkId: "SN_SEPOLIA",
  networks: [{ id: "SN_SEPOLIA", name: "Starknet Sepolia" }],
  ready: true,
};

const mount = () => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  bindOnboarding({
    app,
    render: () => Promise.resolve(),
    wallet: {
      generateMnemonic: () => Promise.resolve(""),
      loadStatus: () => Promise.resolve(status),
    } as unknown as SidepanelWallet,
  });
  return app;
};

const setPassphrase = (app: Element, value: string): void => {
  for (const name of ["vaultPassphrase", "vaultPassphraseConfirm"]) {
    const input = app.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) {
      throw new Error(`missing ${name}`);
    }
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  }
};

const tickAck = (app: Element): void => {
  const ack = app.querySelector<HTMLInputElement>('input[name="weakPassphraseAck"]');
  if (!ack) {
    throw new Error("missing weak acknowledgement");
  }
  ack.checked = true;
  ack.dispatchEvent(new window.Event("change", { bubbles: true }));
};

describe("weak passphrase acknowledgement", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("stays hidden and ungated for a passphrase the meter does not call weak", () => {
    const app = mount();
    setPassphrase(app, STRONG);
    expect(app.querySelector<HTMLElement>("#weak-passphrase-ack")?.hidden).toBe(true);
    expect(app.querySelector<HTMLButtonElement>("#password-continue-button")?.disabled).toBe(false);
  });

  test("appears for a weak passphrase and gates the step until it is ticked", () => {
    const app = mount();
    const continueButton = app.querySelector<HTMLButtonElement>("#password-continue-button");

    setPassphrase(app, WEAK);
    // Accepted by the validator — the floor is cleared — but not silently.
    expect(app.querySelector<HTMLElement>("#weak-passphrase-ack")?.hidden).toBe(false);
    expect(continueButton?.disabled).toBe(true);

    tickAck(app);
    expect(continueButton?.disabled).toBe(false);
  });

  test("drops a tick made for an earlier value once the passphrase improves", () => {
    const app = mount();
    setPassphrase(app, WEAK);
    tickAck(app);
    const ack = app.querySelector<HTMLInputElement>('input[name="weakPassphraseAck"]');
    expect(ack?.checked).toBe(true);

    setPassphrase(app, STRONG);
    expect(app.querySelector<HTMLElement>("#weak-passphrase-ack")?.hidden).toBe(true);
    expect(ack?.checked).toBe(false);

    // And going back to a weak value asks again rather than reusing the tick.
    setPassphrase(app, WEAK);
    expect(app.querySelector<HTMLElement>("#weak-passphrase-ack")?.hidden).toBe(false);
    expect(app.querySelector<HTMLButtonElement>("#password-continue-button")?.disabled).toBe(true);
  });
});
