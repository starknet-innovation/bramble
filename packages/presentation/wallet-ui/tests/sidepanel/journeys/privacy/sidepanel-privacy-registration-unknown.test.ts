/**
 * A private registration whose submission reply was lost.
 *
 * The execution job can lose its background worker after the write may have
 * broadcast, and it rejects with a SubmissionUnknownError rather than a plain
 * failure (see privacy-preparation-job). The registration receipt must show that
 * as a warning ("Status unknown"), not the red failure that reads as "not sent"
 * and invites a blind retry (issue 382).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, preferences } from "@bramble/testkit/sidepanel";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type {
  PrivacyDisclosureState,
  PrivacyJourneyState,
} from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import { PRIVATE_EXECUTION_UNKNOWN } from "../../../../src/sidepanel/journeys/privacy/privacy-preparation-job";
import { bindPrivacy } from "../../../../src/sidepanel/journeys/privacy/privacy-ui";
import { privacyFlow } from "../../../../src/sidepanel/journeys/privacy/privacy-views";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

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

const digest = `sha256:${"c".repeat(64)}`;
const preparation = {
  id: digest,
  kind: "register" as const,
  payloadDigest: digest,
  poolAddress: "0x123",
  route: "public-account" as const,
  summaries: ["Activate private balances"],
  symbol: "ETH",
  tokenId: preferences.tokens[0]?.id ?? "",
};

const settled: PrivacyDisclosureState = {
  error: null,
  loading: false,
  value: {
    accountId: account.id,
    balances: [],
    networkId: "SN_MAIN",
    poolFeeFri: "0x1",
    relayConfigured: true,
    registration: "unregistered",
  },
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (html: string): HTMLElement => {
  const app = document.createElement("main");
  app.innerHTML = html;
  document.body.append(app);
  return app;
};

describe("privacy registration submission unknown", () => {
  test("a lost submission worker is a warning, never a failure with a blind retry", async () => {
    const app = mount('<button id="privacy-confirm" type="button"></button>');
    let journey = {
      preparation,
      stage: "activate-review",
      tokenId: preparation.tokenId,
    } as PrivacyJourneyState;
    bindPrivacy({
      app,
      balances: () => [],
      disclosure: () => settled,
      generation: () => 0,
      journey: () => journey,
      navigate: () => undefined,
      paint: () => undefined,
      preferences: () => preferences,
      setDisclosure: () => undefined,
      setJourney: (state) => {
        journey = state;
      },
      status: () => status,
      wallet: {
        loadPrivacyState: async () => settled.value,
        executePrivacyPreparation: async () => {
          throw new SubmissionUnknownError(PRIVATE_EXECUTION_UNKNOWN, null);
        },
      } as unknown as SidepanelWallet,
    });

    app.querySelector<HTMLButtonElement>("#privacy-confirm")?.click();
    await tick();

    expect(journey.stage).toBe("failure");

    // Rendered: warning tone, no red-cross failure mark, no blind Try again.
    const html = privacyFlow(status, preferences, journey);
    expect(html).toContain('data-severity="warning"');
    expect(html).not.toContain('id="privacy-retry"');
    expect(html).toContain('data-view="activity"');
    expect(html).toContain('class="privacy-unknown-mark"');
  });
});
