/**
 * A failed private registration can be handed to support in full.
 *
 * The failure screen shows the friendly sentence, which drops the pipeline
 * stage and error category a STRK20 failure carries. Its "Copy error details"
 * control copies the complete diagnostic the background returned instead —
 * the same text an error toast's copy control holds — and that text is only
 * ever an Error's message, already sanitized at the background boundary.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type {
  PrivacyDisclosureState,
  PrivacyJourneyState,
} from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import { bindPrivacy } from "../../../../src/sidepanel/journeys/privacy/privacy-ui";
import { privacyFlow } from "../../../../src/sidepanel/journeys/privacy/privacy-views";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { bindCopyButtons, renderFragment } from "../../../../src/sidepanel/shared/dom";
import {
  captureClipboard,
  panelStageError,
  STAGE_FAILURE_ENDPOINT,
  STAGE_FAILURE_FELT,
  SUBMISSION_STAGE_DETAILS,
} from "../../../support/failure-copy-fixtures";
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

const digest = `sha256:${"d".repeat(64)}`;
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

// Confirms a reviewed registration whose execution rejects with `rejection`,
// and returns the journey it settles into.
const failRegistration = async (rejection: unknown): Promise<PrivacyJourneyState> => {
  const app = document.createElement("main");
  renderFragment(app, '<button id="privacy-confirm" type="button"></button>');
  document.body.append(app);
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
      executePrivacyPreparation: async () => {
        throw rejection;
      },
      loadPrivacyState: async () => settled.value,
    } as unknown as SidepanelWallet,
  });
  app.querySelector<HTMLButtonElement>("#privacy-confirm")?.click();
  await tick();
  app.remove();
  return journey;
};

// Paints the failure screen and binds its copy control, as the shell does on
// every render.
const showFailure = (journey: PrivacyJourneyState): HTMLElement => {
  const app = document.createElement("main");
  renderFragment(app, privacyFlow(status, preferences, journey));
  document.body.append(app);
  bindCopyButtons(app);
  return app;
};

describe("privacy failure screen copy", () => {
  test("copies the stage error's (stage/category): detail the sentence leaves out", async () => {
    const journey = await failRegistration(panelStageError("submission"));
    expect(journey.stage).toBe("failure");
    if (journey.stage !== "failure") return;
    expect(journey.errorDetails).toBe(SUBMISSION_STAGE_DETAILS);
    // The screen reads as a sentence, not as the pipeline's label.
    expect(journey.error).not.toContain("(submission/execution-reverted)");

    const copied = captureClipboard();
    const app = showFailure(journey);
    const control = app.querySelector<HTMLButtonElement>(
      '.privacy-failure [aria-label="Copy error details"]',
    );
    expect(control?.id).toBe("privacy-failure-copy-error");
    expect(app.querySelector(".privacy-outcome-reason p")?.textContent).toBe(journey.error);
    control?.click();
    await tick();

    expect(copied).toEqual([SUBMISSION_STAGE_DETAILS]);
    // Sanitized at the boundary: the endpoint and the felt never reach support.
    expect(copied[0]).not.toContain(STAGE_FAILURE_ENDPOINT);
    expect(copied[0]).not.toContain(STAGE_FAILURE_FELT);
  });

  test("a rejection that is not an Error copies only the fixed fallback", async () => {
    const journey = await failRegistration({ message: `leaked ${STAGE_FAILURE_ENDPOINT}` });
    if (journey.stage !== "failure") throw new Error("expected the failure screen");
    expect(journey.errorDetails).toBe("Private transaction failed");

    const copied = captureClipboard();
    showFailure(journey).querySelector<HTMLButtonElement>("#privacy-failure-copy-error")?.click();
    await tick();
    expect(copied).toEqual(["Private transaction failed"]);
  });
});
