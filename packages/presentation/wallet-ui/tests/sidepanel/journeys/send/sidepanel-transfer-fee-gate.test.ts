/**
 * The Send confirm control's fee gate, exercised directly against
 * `applyTransferUi` rather than through `bindTransfer`: the render function owns
 * the decision, so a state in and the button's `disabled` out is the whole
 * contract.
 *
 * Two fee facts must not be conflated. A *failed* estimate tells us nothing, and
 * a *known* shortfall tells us the balance was read and cannot cover the
 * transaction — the second is the one worth blocking on, because confirming only
 * buys a rejection. "unknown" blocks nothing, keeping the guard fail-open.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { account } from "@mc-wallet/testkit/sidepanel";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import type { TransferState } from "../../../../src/sidepanel/journeys/send/transfer-model";
import { applyTransferUi } from "../../../../src/sidepanel/journeys/send/transfer-render";
import type { TransferReview } from "../../../../src/sidepanel/journeys/send/transfer-submit";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { paint, walletStatus as status } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [],
};

type Affordability = "insufficient" | "ok" | "unknown";

const TOKEN_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

// A public→public send. `fields` has to be present: the fee section only renders
// once a route resolves from it, and the route is what the shortfall notice hangs
// off. Every value here is incidental except the buckets, which name the route.
const fields = {
  accountId: account.id,
  amount: "1",
  destination: "public",
  fiatEstimate: "",
  recipient: "0x02a3f4b1c5d6e7089a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071",
  recipientLabel: "",
  signer: "software",
  source: "public",
  speed: "standard",
  tokenAddress: TOKEN_ADDRESS,
  tokenBalance: "10000000000000000000",
  tokenDecimals: "18",
  tokenFormatted: "10",
  tokenId: `SN_MAIN:STRK:${TOKEN_ADDRESS}`,
  tokenPrice: "",
  tokenSymbol: "STRK",
};

const reviewState = (
  feeAffordability: Affordability,
  feeEstimateFailed = false,
): TransferState<TransferReview> =>
  ({
    error: "",
    fields,
    privatePreparation: null,
    requiresDeployment: false,
    review: {
      // 32 STRK against a 10 STRK balance is the reported case; only the verdict
      // is load-bearing here, the amount is what the user sees.
      fee: feeEstimateFailed ? null : { overallFee: "32000000000000000000", unit: "FRI" },
      feeAffordability,
      feeEstimateFailed,
      flags: [],
      requiresDeployment: false,
      summaries: ["Transfer"],
    },
    reviewedKey: null,
    stage: "review",
    transactionHash: null,
  }) as unknown as TransferState<TransferReview>;

const render = (state: TransferState<TransferReview>): HTMLElement => {
  const app = document.createElement("div");
  app.id = "app";
  paint(app, sendFlow(status, account, preferences, []));
  document.body.append(app);
  const form = app.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) {
    throw new Error("transfer form missing");
  }
  applyTransferUi(form, state);
  return app;
};

const confirmDisabled = (app: HTMLElement): boolean =>
  app.querySelector<HTMLButtonElement>("#send-confirm-button")?.disabled === true;

const feeText = (app: HTMLElement): string =>
  app.querySelector("#send-review-fee")?.textContent ?? "";

beforeEach(() => {
  document.body.replaceChildren();
});

describe("Send confirm fee gate", () => {
  test("a known shortfall disables Confirm and says what unblocks it", () => {
    const app = render(reviewState("insufficient"));

    expect(confirmDisabled(app)).toBe(true);
    // A dead button with no stated reason reads as a broken panel.
    expect(feeText(app)).toContain("STRK balance is less than this transaction needs");
    expect(feeText(app)).toContain("Add STRK to continue");
  });

  test("ok and unknown verdicts leave Confirm live and make no shortfall claim", () => {
    for (const verdict of ["ok", "unknown"] as const) {
      document.body.replaceChildren();
      const app = render(reviewState(verdict));

      // Fail-open: an unreadable balance must never block a transfer that would
      // otherwise have gone through.
      expect(confirmDisabled(app)).toBe(false);
      expect(feeText(app)).not.toContain("STRK balance is less than");
    }
  });

  test("a failed estimate still disables Confirm on its own", () => {
    // Pre-existing behaviour, kept: Send blocks on an unusable estimate even
    // though the dapp card deliberately does not.
    expect(confirmDisabled(render(reviewState("unknown", true)))).toBe(true);
  });
});
