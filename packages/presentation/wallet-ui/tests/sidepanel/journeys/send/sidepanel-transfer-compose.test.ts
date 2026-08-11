/**
 * Pre-review Send composition: choosing the asset, choosing the recipient, and
 * the amount shortcuts.
 *
 * The shortcuts are the interesting part. What is spendable is the route's
 * answer, not the raw token balance, because a pool fee charged in the token
 * being sent has to be reserved — and an unread fee withholds a maximum
 * entirely rather than offering an amount the pool would reject.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { account } from "@mc-wallet/testkit/sidepanel";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
import { bindTransferCompose } from "../../../../src/sidepanel/journeys/send/transfer-compose-ui";
import type {
  TransferFields,
  TransferStage,
} from "../../../../src/sidepanel/journeys/send/transfer-model";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { paint, walletStatus as status } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const TOKEN_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const ONE_ETH = 10n ** 18n;

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [
    {
      address: TOKEN_ADDRESS,
      decimals: 18,
      id: `SN_MAIN:ETH:${TOKEN_ADDRESS}`,
      name: "Ether",
      networkId: "SN_MAIN",
      symbol: "ETH",
    },
  ],
};

const mount = (
  spendable?: () => bigint | null,
  intent: SendIntent | null = null,
): {
  readonly fields: readonly TransferFields[];
  readonly form: HTMLFormElement;
  readonly stages: readonly TransferStage[];
} => {
  const app = document.createElement("div");
  app.id = "app";
  paint(app, sendFlow(status, account, preferences, [], {}, {}, "usd", [], intent));
  document.body.append(app);
  const form = app.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) {
    throw new Error("transfer form missing");
  }
  const fields: TransferFields[] = [];
  const stages: TransferStage[] = [];
  bindTransferCompose({
    form,
    goTo: (stage) => stages.push(stage),
    onFields: (next) => fields.push(next),
    ...(spendable ? { spendable } : {}),
  });
  return { fields, form, stages };
};

const click = (form: HTMLFormElement, selector: string): void => {
  form.querySelector<HTMLElement>(selector)?.dispatchEvent(new Event("click", { bubbles: true }));
};

const amountInput = (form: HTMLFormElement): HTMLInputElement => {
  const input = form.querySelector<HTMLInputElement>("#send-amount-input");
  if (!input) {
    throw new Error("amount input missing");
  }
  return input;
};

describe("amount shortcuts", () => {
  test("Max spends what the route allows, not the whole token balance", () => {
    // 10 ETH held, 4 reserved by the route (e.g. a pool fee in the same token).
    const { form } = mount(() => 6n * ONE_ETH);

    click(form, "#send-max");

    expect(amountInput(form).value).toBe("6");
  });

  test("Half halves the route's spendable amount", () => {
    const { form } = mount(() => 6n * ONE_ETH);

    click(form, "#send-half");

    expect(amountInput(form).value).toBe("3");
  });

  test("an unread fee withholds Max rather than offering a rejectable amount", () => {
    const { fields, form } = mount(() => null);
    amountInput(form).value = "";

    click(form, "#send-max");

    // Nothing is filled in and no field update is published: the user is left to
    // wait for the fee rather than shown a maximum the pool would reject.
    expect(amountInput(form).value).toBe("");
    expect(fields).toEqual([]);
  });

  test("falls back to the form's token balance when no route answer is supplied", () => {
    const { form } = mount();
    const balance = form.querySelector<HTMLInputElement>('[name="tokenBalance"]');
    if (balance) {
      balance.value = (2n * ONE_ETH).toString();
    }

    click(form, "#send-max");

    expect(amountInput(form).value).toBe("2");
  });

  test("typing an amount republishes the composed fields", () => {
    const { fields, form } = mount(() => ONE_ETH);
    const input = amountInput(form);

    input.value = "0.25";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(fields.at(-1)?.amount).toBe("0.25");
  });
});

describe("asset and recipient selection", () => {
  test("the token trigger opens the asset step", () => {
    const { form, stages } = mount();

    click(form, "#send-token-trigger");

    expect(stages).toContain("asset");
  });

  test("choosing an asset records it and returns to the amount step", () => {
    const { fields, form, stages } = mount();

    click(form, "[data-send-asset]");

    expect(fields.at(-1)?.tokenSymbol).toBe("ETH");
    expect(stages).toContain("details");
  });

  test("does not auto-select another asset for an unresolved token intent", () => {
    const { form } = mount(undefined, {
      accountId: account.id,
      destination: "private",
      networkId: "SN_MAIN",
      recipient: account.address,
      recipientLabel: "Current account",
      source: "public",
      tokenId: "SN_MAIN:MISSING:0x123",
    });

    expect(form.querySelector<HTMLInputElement>('[name="tokenId"]')?.value).toBe("");
    expect(form.querySelector<HTMLButtonElement>("#send-token-trigger")?.disabled).toBe(false);
  });

  test("choosing a recipient records the address it carries", () => {
    const { fields, form } = mount();
    const row = form.querySelector<HTMLElement>("[data-send-recipient]");
    if (!row) {
      throw new Error("no recipient row rendered");
    }

    row.dispatchEvent(new Event("click", { bubbles: true }));

    expect(fields.at(-1)?.recipient).toBe(row.dataset["sendRecipient"] ?? "");
  });
});
