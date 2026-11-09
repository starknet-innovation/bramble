/**
 * A recipient typed or pasted into Send reads as the row it matches, exactly as
 * if the user had tapped that row: one of their own accounts, or a saved
 * contact on this network. A known address shown as bare hex looks the same as
 * a stranger's, which throws away the one cue that confirms a paste landed on
 * the intended recipient. Anything not on the screen keeps its truncated
 * address, and "Save address" is still offered only for those.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account, secondAccount } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import { bindTransferCompose } from "../../../../src/sidepanel/journeys/send/transfer-compose-ui";
import type { TransferStage } from "../../../../src/sidepanel/journeys/send/transfer-model";
import { accountLabel } from "../../../../src/sidepanel/shared/parts";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { paint } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

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

const ada = "0xaaa1";
const grace = "0xbbb2";

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [
    { address: ada, id: `SN_MAIN:${ada}`, label: "Ada", networkId: "SN_MAIN" },
    // Saved on another network: the same hex here is not the same recipient.
    { address: grace, id: `SN_SEPOLIA:${grace}`, label: "Grace", networkId: "SN_SEPOLIA" },
  ],
  groups: [],
  schemaVersion: 1,
  tokens: [],
};

const mount = (): { form: HTMLFormElement; stages: TransferStage[] } => {
  const app = document.createElement("div");
  app.id = "app";
  paint(app, sendFlow(status, account, preferences, [], {}, {}, "usd", [], null));
  document.body.append(app);
  const form = app.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) {
    throw new Error("transfer form missing");
  }
  const stages: TransferStage[] = [];
  bindTransferCompose({
    form,
    goTo: (stage) => stages.push(stage),
    navigate: () => undefined,
    onFields: () => undefined,
  });
  return { form, stages };
};

const type = (form: HTMLFormElement, value: string): void => {
  const field = form.querySelector<HTMLInputElement>("#send-recipient-search");
  if (!field) {
    throw new Error("search field missing");
  }
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
};

const pasteAndContinue = (form: HTMLFormElement, value: string): void => {
  type(form, value);
  form.querySelector<HTMLButtonElement>("#send-recipient-continue")?.click();
};

const field = (form: HTMLFormElement, name: string): string =>
  form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? "";

const rowLabel = (form: HTMLFormElement, address: string): string =>
  form.querySelector<HTMLElement>(`[data-send-recipient="${address}"]`)?.dataset[
    "sendRecipientLabel"
  ] ?? "";

const saveOffered = (form: HTMLFormElement): boolean =>
  !form.querySelector("#send-recipient-save-row")?.hasAttribute("hidden");

describe("Send names a pasted recipient it already knows", () => {
  test("one of the user's own accounts, however it is spelled, reads as that account", () => {
    const { form, stages } = mount();
    const name = rowLabel(form, secondAccount.address);
    expect(name).not.toBe("");
    // Zero-padded to 64 digits and upper-cased: still the same felt.
    const spelled = `0x0${secondAccount.address.slice(2).toUpperCase()}`;

    pasteAndContinue(form, spelled);

    expect(stages).toEqual(["details"]);
    expect(field(form, "recipientLabel")).toBe(name);
    expect(field(form, "recipientLabel")).not.toBe(accountLabel(spelled));
  });

  test("a saved contact on this network reads as the contact", () => {
    const { form } = mount();

    pasteAndContinue(form, ada);

    expect(field(form, "recipientLabel")).toBe("Ada");
  });

  test("a contact saved on another network is not borrowed", () => {
    const { form } = mount();

    pasteAndContinue(form, grace);

    expect(field(form, "recipientLabel")).toBe(accountLabel(grace));
  });

  test("an unknown address keeps its truncated form and is offered for saving", () => {
    const { form } = mount();
    const stranger = "0xc0ffee";

    type(form, stranger);
    expect(saveOffered(form)).toBe(true);
    form.querySelector<HTMLButtonElement>("#send-recipient-continue")?.click();

    expect(field(form, "recipientLabel")).toBe(accountLabel(stranger));
  });

  test("a known address is not offered for saving", () => {
    const { form } = mount();

    type(form, ada);
    expect(saveOffered(form)).toBe(false);
    type(form, secondAccount.address);
    expect(saveOffered(form)).toBe(false);
  });
});
