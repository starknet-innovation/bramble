/**
 * Private-send toggle behavior on the Send screen: blocker gating with hover
 * reasons, the debounced recipient registration check, and the public/private
 * swap of the balance backing display, Max, and Half.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { PrivacyDisclosureState } from "../../src/sidepanel/privacy-model";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";
import { bindPrivateSendToggle } from "../../src/sidepanel/transfer-private-ui";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const originalSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  document.body.replaceChildren();
  // Run the debounce synchronously so recipient checks resolve in-test.
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout;
});

afterEach(() => {
  (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
});

const TOKEN_ID = "SN_MAIN:ETH:0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const RECIPIENT = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const flush = (): Promise<void> => new Promise((resolve) => originalSetTimeout(resolve, 0));

const registeredDisclosure = (privateBalance = "0x6f05b59d3b20000"): PrivacyDisclosureState => ({
  error: null,
  loading: false,
  value: {
    accountId: "SN_MAIN:0x1",
    balances: [
      {
        balance: privateBalance,
        formatted: "0.5",
        symbol: "ETH",
        token: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
        tokenId: TOKEN_ID,
      },
    ],
    networkId: "SN_MAIN",
    registration: "registered",
  },
});

const mountForm = (recipient: string): HTMLFormElement => {
  const form = document.createElement("form");
  form.innerHTML = `
    <input name="recipient" type="hidden" value="${recipient}" />
    <input name="privateSend" type="hidden" value="" />
    <input name="tokenBalance" type="hidden" value="1250000000000000000" />
    <input name="tokenFormatted" type="hidden" value="1.25" />
    <input name="tokenId" type="hidden" value="${TOKEN_ID}" />
    <input name="tokenSymbol" type="hidden" value="ETH" />
    <label id="send-private-toggle" class="muted" title="">
      <input id="send-private-checkbox" type="checkbox" disabled />
    </label>
    <span id="send-balance-label">Balance 1.25 ETH</span>`;
  document.body.append(form);
  return form;
};

type Setup = {
  readonly checks: string[];
  readonly form: HTMLFormElement;
  readonly toggle: HTMLInputElement;
};

const bind = (
  recipient: string,
  disclosure: PrivacyDisclosureState,
  recipientRegistration: "registered" | "unregistered" = "registered",
): Setup => {
  const form = mountForm(recipient);
  const checks: string[] = [];
  bindPrivateSendToggle({
    form,
    onModeChange: () => undefined,
    privacy: () => disclosure,
    wallet: {
      loadPrivacyRecipientStatus: async (_tokenId: string, address: string) => {
        checks.push(address);
        return recipientRegistration;
      },
    } as unknown as SidepanelWallet,
  });
  const toggle = form.querySelector<HTMLInputElement>("#send-private-checkbox");
  if (!toggle) {
    throw new Error("toggle missing");
  }
  return { checks, form, toggle };
};

describe("private send toggle", () => {
  test("stays greyed with a reason while the sender is unregistered", () => {
    const { form, toggle } = bind(RECIPIENT, {
      error: null,
      loading: false,
      value: { accountId: "a", balances: [], networkId: "SN_MAIN", registration: "unregistered" },
    });

    expect(toggle.disabled).toBe(true);
    expect(form.querySelector("#send-private-toggle")?.getAttribute("title")).toBe(
      "Activate private balances before sending privately",
    );
  });

  test("stays greyed when the recipient turns out to be unregistered", async () => {
    const { checks, form, toggle } = bind(RECIPIENT, registeredDisclosure(), "unregistered");
    await flush();

    // The recipient reaches the registry check in normalized felt form.
    expect(checks).toEqual(["0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"]);
    expect(toggle.disabled).toBe(true);
    expect(form.querySelector("#send-private-toggle")?.getAttribute("title")).toBe(
      "The recipient has not activated private balances",
    );
  });

  test("enables after the registered recipient check and swaps the balance", async () => {
    const { form, toggle } = bind(RECIPIENT, registeredDisclosure());
    await flush();

    expect(toggle.disabled).toBe(false);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(form.querySelector<HTMLInputElement>('[name="privateSend"]')?.value).toBe("1");
    expect(form.querySelector<HTMLInputElement>('[name="tokenFormatted"]')?.value).toBe("0.5");
    expect(form.querySelector("#send-balance-label")?.textContent).toBe("Balance 0.5 ETH");

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(form.querySelector<HTMLInputElement>('[name="privateSend"]')?.value).toBe("");
    expect(form.querySelector<HTMLInputElement>('[name="tokenFormatted"]')?.value).toBe("1.25");
    expect(form.querySelector("#send-balance-label")?.textContent).toBe("Balance 1.25 ETH");
  });

  test("greys without a recipient and never queries the registry", async () => {
    const { checks, form, toggle } = bind("", registeredDisclosure());
    await flush();

    expect(toggle.disabled).toBe(true);
    expect(checks).toEqual([]);
    expect(form.querySelector("#send-private-toggle")?.getAttribute("title")).toBe(
      "Choose a recipient first",
    );
  });

  test("greys with a zero private balance of the selected asset", () => {
    const { form, toggle } = bind(RECIPIENT, registeredDisclosure("0x0"));

    expect(toggle.disabled).toBe(true);
    expect(form.querySelector("#send-private-toggle")?.getAttribute("title")).toBe(
      "No private balance of this asset yet",
    );
  });
});
