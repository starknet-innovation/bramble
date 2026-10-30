/**
 * A shortcut may carry the amount it needs, in exact base units ("Fund from
 * this wallet" carries the multisig's funding minimum). Send opens with that
 * amount in the field, still editable, and never moves past the amount step
 * on its own. An intent without one, or with anything that is not a positive
 * base-unit integer, opens empty exactly as before.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountTransferUi as mount,
  paint,
  transferPreferences as preferences,
  transferPublicBalance as publicBalance,
  walletStatus as status,
  TRANSFER_RECIPIENT,
} from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const fundingIntent: SendIntent = {
  accountId: account.id,
  destination: "public",
  networkId: status.networkId,
  recipient: TRANSFER_RECIPIENT,
  recipientLabel: "New multisig",
  source: "public",
  tokenId: publicBalance.id,
};

const open = (intent: SendIntent) => {
  const mounted = mount();
  paint(
    mounted.app,
    sendFlow(status, account, preferences, [publicBalance], {}, {}, "usd", [], intent),
  );
  bindTransfer({ ...mounted.deps, senderAddress: () => account.address });
  return mounted;
};

const amountField = (app: HTMLElement): HTMLInputElement => {
  const input = app.querySelector<HTMLInputElement>("#send-amount-input");
  if (!input) throw new Error("amount input missing");
  return input;
};

describe("a shortcut's amount", () => {
  test("prefills the exact base-unit amount and waits on the amount step", async () => {
    const { app, calls } = open({ ...fundingIntent, amount: "99245000000000001" });
    await flush();

    expect(app.querySelector("#transfer-form")?.getAttribute("data-stage")).toBe("details");
    expect(amountField(app).value).toBe("0.099245000000000001");
    expect(app.querySelector<HTMLInputElement>('input[name="amount"]')?.value).toBe(
      "0.099245000000000001",
    );
    expect(calls.reviewTransfer).toHaveLength(0);
  });

  test("stays editable", async () => {
    const { app } = open({ ...fundingIntent, amount: "99245000000000000" });
    await flush();
    const field = amountField(app);
    field.value = "0.5";
    field.dispatchEvent(new Event("input", { bubbles: true }));

    expect(app.querySelector<HTMLInputElement>('input[name="amount"]')?.value).toBe("0.5");
  });

  test("opens empty without an amount, or with one that is not exact base units", async () => {
    for (const amount of [undefined, "", "0", "0.1", "-1", "0x10", "1e18"]) {
      const { app } = open(amount === undefined ? fundingIntent : { ...fundingIntent, amount });
      await flush();
      expect(amountField(app).value).toBe("");
    }
  });
});
