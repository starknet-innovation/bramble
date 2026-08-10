/**
 * Activation for a hardware account whose viewing key has not been derived yet.
 *
 * Registering publishes the viewing key's commitment, so the key has to exist
 * first — but both steps run behind ONE confirmation. The review is where the
 * wallet discloses that the key is retained on disk, so the ceremony has to happen
 * after the user has read that, not as an earlier separate tap.
 *
 * These pin that order: opening the journey prepares the registration review and
 * derives nothing, confirming derives and then registers in that sequence, and a
 * refused derivation registers nothing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import type { PrivacyJourneyState } from "../../src/sidepanel/privacy-model";
import type { PrivacyAccountState, PrivacyPreparation } from "../../src/sidepanel/privacy-runtime";
import { bindPrivacy } from "../../src/sidepanel/privacy-ui";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";
import { registerDom, unregisterDom } from "../support/groups-harness";
import { account, preferences } from "../support/sidepanel-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

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

const TOKEN_ID = preferences.tokens[0]?.id ?? "SN_MAIN:ETH:0x1";
const digest = `sha256:${"a".repeat(64)}`;

const preparation: PrivacyPreparation = {
  id: digest,
  kind: "register",
  payloadDigest: digest,
  poolAddress: "0x123",
  poolFeeFri: "0x1",
  route: "public-account",
  summaries: ["Register this account with the privacy pool"],
  symbol: "ETH",
  tokenId: TOKEN_ID,
};

const state = (privateBalances: PrivacyAccountState["privateBalances"]): PrivacyAccountState => ({
  accountId: account.id,
  balances: [],
  networkId: "SN_MAIN",
  poolFeeFri: "0x1",
  privateBalances,
  registration: "unregistered",
  relayConfigured: true,
});

const bindWith = (options: {
  readonly ceremony?: () => Promise<void>;
  readonly html: string;
  readonly journey?: PrivacyJourneyState;
}) => {
  const order: string[] = [];
  const app = document.createElement("main");
  app.innerHTML = options.html;
  document.body.append(app);
  bindPrivacy({
    app,
    balances: () => [],
    disclosure: () => ({ error: null, loading: false, value: state("setup-required") }),
    generation: () => 0,
    journey: () => options.journey ?? { stage: "idle" },
    navigate: () => undefined,
    openSend: () => undefined,
    paint: () => undefined,
    preferences: () => preferences,
    setDisclosure: () => undefined,
    setJourney: () => undefined,
    status: () => status,
    wallet: {
      async derivePrivacyViewingKey() {
        order.push("derive");
        if (options.ceremony) {
          await options.ceremony();
        }
      },
      async executePrivacyPreparation() {
        order.push("register");
        return "0xhash";
      },
      async loadPrivacyState() {
        return state("setup-required");
      },
      async preparePrivacyRegistration() {
        order.push("prepare-review");
        return preparation;
      },
    } as unknown as SidepanelWallet,
  });
  return { app, order };
};

const settle = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

describe("activating a hardware account with no retained viewing key", () => {
  test("one tap opens the review and derives nothing yet", async () => {
    const bound = bindWith({
      html: `<button data-privacy-register="${TOKEN_ID}">Register to start shielding</button>`,
    });

    bound.app.querySelector<HTMLButtonElement>("[data-privacy-register]")?.click();
    await settle();

    // The review is where the key-custody disclosure lives, so nothing may be
    // derived before the user has seen it.
    expect(bound.order).toEqual(["prepare-review"]);
  });

  test("confirming derives the key and then registers, in that order", async () => {
    const bound = bindWith({
      html: '<button id="privacy-confirm">Activate private balances</button>',
      journey: { preparation, stage: "activate-review", tokenId: TOKEN_ID },
    });

    bound.app.querySelector<HTMLButtonElement>("#privacy-confirm")?.click();
    await settle();

    expect(bound.order).toEqual(["derive", "register"]);
  });

  test("a refused derivation registers nothing", async () => {
    const bound = bindWith({
      ceremony: () => Promise.reject(new Error("rejected-on-device")),
      html: '<button id="privacy-confirm">Activate private balances</button>',
      journey: { preparation, stage: "activate-review", tokenId: TOKEN_ID },
    });

    bound.app.querySelector<HTMLButtonElement>("#privacy-confirm")?.click();
    await settle();

    // Registering after a refused derivation would publish a commitment for a key
    // the wallet does not hold, stranding every note sent to this account.
    expect(bound.order).toEqual(["derive"]);
  });
});
