/**
 * Bucket controls on the Send screen: the source/destination pair that names the
 * route, the balance the amount card measures against, and the single visible
 * reason a route is unavailable.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TokenBalance } from "../../src/popup/responses";
import type { PrivacyDisclosureState } from "../../src/sidepanel/privacy-model";
import { bindTransferBuckets } from "../../src/sidepanel/transfer-buckets-ui";
import { transferFields } from "../../src/sidepanel/transfer-model";
import { privateRelayFeeHtml } from "../../src/sidepanel/transfer-review-markup";
import { balanceInBucket, resolveTransferRoute } from "../../src/sidepanel/transfer-route";
import { STRK_TOKEN_ADDRESS } from "../../src/starknet/networks";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
});

const TOKEN_ID = "SN_MAIN:STRK:0x04718";
const SENDER = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RECIPIENT = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SIX_STRK = "6000000000000000000";

const publicBalances: readonly TokenBalance[] = [
  {
    address: STRK_TOKEN_ADDRESS,
    balance: "100000000000000000000",
    decimals: 18,
    formatted: "100",
    id: TOKEN_ID,
    name: "Starknet Token",
    networkId: "SN_MAIN",
    symbol: "STRK",
  },
];

const registered = (privateBalance = "20000000000000000000"): PrivacyDisclosureState => ({
  error: null,
  loading: false,
  value: {
    accountId: "SN_MAIN:0x1",
    balances: [
      {
        balance: privateBalance,
        formatted: "20",
        symbol: "STRK",
        token: STRK_TOKEN_ADDRESS,
        tokenId: TOKEN_ID,
      },
    ],
    networkId: "SN_MAIN",
    poolFeeFri: SIX_STRK,
    registration: "registered",
  },
});

const mountForm = (recipient = RECIPIENT): HTMLFormElement => {
  const form = document.createElement("form");
  form.innerHTML = `
    <input name="recipient" type="hidden" value="${recipient}" />
    <input name="source" type="hidden" value="public" />
    <input name="destination" type="hidden" value="public" />
    <input name="amount" type="hidden" value="1" />
    <input name="tokenAddress" type="hidden" value="${STRK_TOKEN_ADDRESS}" />
    <input name="tokenBalance" type="hidden" value="0" />
    <input name="tokenDecimals" type="hidden" value="18" />
    <input name="tokenFormatted" type="hidden" value="0" />
    <input name="tokenId" type="hidden" value="${TOKEN_ID}" />
    <input name="tokenSymbol" type="hidden" value="STRK" />
    <div id="send-route-controls">
      <button class="send-route-toggle" data-send-bucket="source" data-bucket="public" type="button">Public</button>
      <button class="send-route-toggle" data-send-bucket="destination" data-bucket="public" type="button">Public</button>
    </div>
    <span id="send-route-reason" hidden></span>
    <span id="send-balance-label"></span>`;
  document.body.append(form);
  return form;
};

const context = (
  form: HTMLFormElement,
  privacy = registered(),
  recipientRegistration = "registered" as const,
) => ({
  fields: transferFields(form),
  privacy,
  publicBalances,
  recipientRegistration,
  senderAddress: SENDER,
});

const bind = (form: HTMLFormElement, privacy = registered()): { changes: number } => {
  const counter = { changes: 0 };
  bindTransferBuckets({
    balanceIn: (bucket) => balanceInBucket(bucket, context(form, privacy)),
    form,
    onRouteChange: () => {
      counter.changes += 1;
    },
    route: () => resolveTransferRoute(context(form, privacy)),
  });
  return counter;
};

// Each leg is one toggle, so selecting a bucket means pressing until it reads
// that bucket rather than picking from a pair.
const pick = (form: HTMLFormElement, leg: "destination" | "source", value: string): void => {
  const button = form.querySelector<HTMLButtonElement>(`[data-send-bucket="${leg}"]`);
  if (button && button.dataset["bucket"] !== value) {
    button.click();
  }
};

describe("bucket controls", () => {
  test("defaults to a public transfer and reports no blocker", () => {
    const form = mountForm();
    bind(form);

    expect(transferFields(form).source).toBe("public");
    expect(transferFields(form).destination).toBe("public");
    expect(form.querySelector<HTMLElement>("#send-route-reason")?.hidden).toBe(true);
  });

  test("writes the chosen bucket into the form and drops the cached review", () => {
    const form = mountForm();
    const counter = bind(form);

    pick(form, "destination", "private");

    expect(transferFields(form).destination).toBe("private");
    // Flipping a bucket changes the route, its fee, and its submission path, so
    // any review cached against the old pair has to go.
    expect(counter.changes).toBe(1);
  });

  test("measures the amount against the bucket being spent from", () => {
    const form = mountForm();
    bind(form);
    expect(form.querySelector("#send-balance-label")?.textContent).toBe("Balance 100 STRK");

    pick(form, "source", "private");

    // The private balance replaces the public one, and says so.
    expect(form.querySelector("#send-balance-label")?.textContent).toBe("Private balance 20 STRK");
    expect(form.querySelector<HTMLInputElement>('[name="tokenBalance"]')?.value).toBe(
      "20000000000000000000",
    );
  });

  test("names the balance in use on the toggle itself", () => {
    const form = mountForm();
    bind(form);
    pick(form, "source", "private");

    const state = [...form.querySelectorAll<HTMLButtonElement>("[data-send-bucket]")].map(
      (button) =>
        `${button.dataset["sendBucket"]}:${button.textContent}:${button.dataset["bucket"]}`,
    );
    expect(state).toEqual(["source:Private:private", "destination:Public:public"]);
  });

  test("toggles back to public on a second press", () => {
    const form = mountForm();
    bind(form);
    const button = form.querySelector<HTMLButtonElement>('[data-send-bucket="source"]');
    button?.click();
    expect(transferFields(form).source).toBe("private");
    button?.click();
    expect(transferFields(form).source).toBe("public");
    expect(button?.textContent).toBe("Public");
  });

  test("says what pressing it will do, since it cannot show both states", () => {
    const form = mountForm();
    bind(form);
    const button = form.querySelector<HTMLButtonElement>('[data-send-bucket="source"]');
    expect(button?.title).toBe("Switch to the private balance");
    button?.click();
    expect(button?.title).toBe("Switch to the public balance");
  });

  test("spells a blocked route out beside the controls", () => {
    const form = mountForm();
    // Registration not discovered yet: a wait, not a refusal.
    bind(form, { error: null, loading: true, value: null });
    pick(form, "source", "private");

    const reason = form.querySelector<HTMLElement>("#send-route-reason");
    expect(reason?.hidden).toBe(false);
    expect(reason?.textContent).toBe("Discovering your private balance…");
    expect(form.querySelector("#send-route-controls")?.classList.contains("muted")).toBe(true);
  });

  test("reports an unavailable discovery service as its own refusal", () => {
    const form = mountForm();
    const privacy: PrivacyDisclosureState = {
      error: "discovery unavailable",
      loading: false,
      value: null,
    };
    bind(form, privacy);
    pick(form, "destination", "private");

    expect(form.querySelector<HTMLElement>("#send-route-reason")?.textContent).toBe(
      "Private balances are unavailable right now",
    );
  });

  test("clears the reason once the route resolves", () => {
    const form = mountForm();
    bind(form);
    pick(form, "source", "private");
    pick(form, "destination", "private");

    // private -> private with a registered recipient and enough balance.
    const reason = form.querySelector<HTMLElement>("#send-route-reason");
    expect(reason?.hidden).toBe(true);
    expect(reason?.textContent).toBe("");
  });
});

describe("private send fee lines", () => {
  // 6 STRK: the mainnet pool's per-action charge, which the relay pays on the
  // sender's behalf and recovers from the shielded balance.
  const POOL_FEE = "0x53444835ec580000";

  test("splits the withdrawn amount into the pool fee and the relay's own cut", () => {
    const html = privateRelayFeeHtml({ amount: POOL_FEE }, POOL_FEE);

    // The pool's charge is named as such rather than billed as the relay's price.
    expect(html).toContain("Pool fee: 6 STRK");
    expect(html).toContain("Relay fee: Sponsored");
    expect(html).not.toContain("Relay fee (paid privately)");
  });

  test("shows a relay cut when the fee action exceeds the pool fee", () => {
    // 6 STRK pool fee inside a 6.5 STRK fee action leaves 0.5 STRK for the relay.
    const html = privateRelayFeeHtml({ amount: "0x5a34a38fc00a0000" }, POOL_FEE);

    expect(html).toContain("Pool fee: 6 STRK");
    expect(html).toContain("Relay fee: 0.5 STRK");
  });

  test("falls back to one unattributed line rather than inventing a split", () => {
    // No pool fee read yet.
    expect(privateRelayFeeHtml({ amount: POOL_FEE })).toContain(
      "Fee taken from your private balance: 6 STRK",
    );
    // A fee action below the pool fee contradicts the split, so it is not shown.
    expect(privateRelayFeeHtml({ amount: "0x1" }, POOL_FEE)).toContain(
      "Fee taken from your private balance",
    );
    // A malformed amount must not throw or render a negative fee.
    expect(privateRelayFeeHtml({ amount: "nope" }, POOL_FEE)).toContain(
      "Fee taken from your private balance",
    );
  });
});
