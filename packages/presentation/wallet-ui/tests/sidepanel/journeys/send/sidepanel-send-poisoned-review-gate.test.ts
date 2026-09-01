/**
 * MCW-V09-109 (panel half): the Send review must refuse an address-poisoning
 * recipient, not merely annotate it.
 *
 * The background is the enforcement point — it refuses the submit outright — but
 * the review screen rendered the flag as advisory text with nothing setting a
 * blocked stage or withholding the confirm, so the user's second click was still
 * "send it" and the refusal only arrived as a failure toast. The NFT send
 * already blocked here (src/sidepanel/nft-ui.ts); this pins the same behaviour
 * for the public ERC20 send, plus the clean-recipient counterpart so a gate that
 * blocked everything could not pass.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { sendFlow } from "../../../../src/sidepanel/journeys/send/send-views";
import {
  bindTransfer,
  type TransferUiDeps,
} from "../../../../src/sidepanel/journeys/send/transfer-ui";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

const RECIPIENT = "0x2345";
const TOKEN_ADDRESS = "0x3456";
const TOKEN_ID = `SN_MAIN:TST:${TOKEN_ADDRESS}`;
const TOKEN = {
  address: TOKEN_ADDRESS,
  decimals: 6,
  id: TOKEN_ID,
  name: "Test token",
  networkId: "SN_MAIN" as const,
  symbol: "TST",
};
const BALANCE = { ...TOKEN, balance: "10000000", formatted: "10" };

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [TOKEN],
};

beforeAll(registerDom);
afterAll(unregisterDom);

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (poisoned: boolean) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(
    document
      .createRange()
      .createContextualFragment(
        sendFlow(status, account, preferences, [BALANCE], { [TOKEN_ADDRESS]: 1 }),
      ),
  );
  document.body.append(app);
  const submitted: unknown[][] = [];
  const wallet = {
    async loadActivity() {
      return { entries: [], historyUnavailable: false };
    },
    async reviewTransfer() {
      return {
        fee: { overallFee: "1000", unit: "FRI" as const },
        feeEstimateFailed: false,
        flags: poisoned
          ? [
              {
                code: "address-poisoning" as const,
                message:
                  "The recipient closely mimics one of your saved addresses but is a different account. Re-check every character before sending.",
              },
            ]
          : [],
        requiresDeployment: false,
        summaries: ["Transfer 1 TST"],
      };
    },
    async submitTransfer(...args: unknown[]) {
      submitted.push(args);
      return "0x1234";
    },
  };
  const deps: TransferUiDeps = {
    app,
    confirmationDelaysMs: [0],
    publicBalances: () => [BALANCE],
    render: async () => undefined,
    waitForConfirmation: async () => undefined,
    wallet: wallet as unknown as TransferUiDeps["wallet"],
  };
  bindTransfer(deps);
  const form = app.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) throw new Error("Missing Send form");
  const set = (name: string, value: string): void => {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) throw new Error(`Missing ${name}`);
    input.value = value;
  };
  set("recipient", RECIPIENT);
  set("recipientLabel", "Treasury");
  set("amount", "1");
  return { app, form, submitted };
};

describe("Send review recipient gate", () => {
  test("a poisoning flag is never confirmable, however many times it is clicked", async () => {
    const { form, submitted } = mount(true);

    form.requestSubmit();
    await flush();
    expect(form.dataset["stage"]).toBe("review");

    // The second click is the confirm on an ordinary review. Here it must
    // re-review instead of submitting, exactly as the fee-failure branch does.
    form.requestSubmit();
    await flush();
    await flush();
    expect(submitted).toEqual([]);
    expect(form.dataset["stage"]).toBe("review");
  });

  test("a clean recipient still confirms on the second click", async () => {
    const { form, submitted } = mount(false);

    form.requestSubmit();
    await flush();
    form.requestSubmit();
    await flush();
    await flush();

    expect(submitted).toHaveLength(1);
  });
});
