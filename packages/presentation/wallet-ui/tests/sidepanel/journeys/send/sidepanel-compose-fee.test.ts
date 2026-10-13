/**
 * The Send Amount screen's fee preview: what the composed send will cost, said
 * before the user commits to it and in the review's own words.
 *
 * The wiring is covered here too, on the real bindings under happy-dom: a typed
 * amount repaints the preview, and a pool route states the pool's charge the
 * moment the buckets name it. No network figure is invented for a route whose
 * calldata does not exist until the preparation.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { sendFlow } from "../../../../src/sidepanel/app/screens/flows";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
import { finitePositive } from "../../../../src/sidepanel/journeys/send/send-model";
import {
  COMPOSE_FEE_DEBOUNCE_MS,
  composeFeeLines,
  composeFeeTarget,
  createComposeFee,
} from "../../../../src/sidepanel/journeys/send/transfer-compose-fee";
import type {
  TransferFields,
  TransferStage,
} from "../../../../src/sidepanel/journeys/send/transfer-model";
import type { TransferRouteContext } from "../../../../src/sidepanel/journeys/send/transfer-route";
import { transferRoute } from "../../../../src/sidepanel/journeys/send/transfer-route";
import type { TransferReview } from "../../../../src/sidepanel/journeys/send/transfer-submit";
import { bindTransfer } from "../../../../src/sidepanel/journeys/send/transfer-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import {
  context,
  DEPLOYMENT_FEE,
  FIELDS,
  registered,
  review,
  strkBalance,
} from "../../../support/compose-fee-fixtures";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountTransferUi as mount,
  paint,
  transferPreferences as preferences,
  transferPublicBalance as publicBalance,
  walletStatus as status,
  submitTransferForm as submit,
  TRANSFER_RECIPIENT,
} from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const target = (value: TransferRouteContext) => {
  const resolved = composeFeeTarget(value);
  if (resolved === null) throw new Error("expected the compose to be priceable");
  return resolved;
};

describe("the fee lines", () => {
  test("a plain public send quotes the review's own figure", () => {
    const lines = composeFeeLines(target(context({}, { amount: "1" })), {
      failed: false,
      review: review(),
    });
    expect(lines).toEqual(["Estimated fee: 0.002 STRK"]);
  });

  test("an account that must deploy first quotes the deployment-inclusive total", () => {
    // The review leads with one total for the creation and the send; a preview
    // that showed only the cheaper half would understate the cost.
    const lines = composeFeeLines(target(context()), {
      failed: false,
      review: review({
        deploymentFee: DEPLOYMENT_FEE,
        fee: { overallFee: "3000000000000000", unit: "FRI" },
        requiresDeployment: true,
      }),
    });
    expect(lines).toEqual(["Estimated fee: 0.004 STRK"]);
  });

  test("a failed estimate says so rather than naming a figure", () => {
    const lines = composeFeeLines(target(context()), {
      failed: false,
      review: review({ fee: null, feeEstimateFailed: true }),
    });
    expect(lines).toEqual(["Estimated fee unavailable"]);
  });

  test("a request that never came back says so too", () => {
    expect(composeFeeLines(target(context()), { failed: true, review: null })).toEqual([
      "Estimated fee unavailable",
    ]);
  });

  test("a pool route states the pool charge and no invented network fee", () => {
    // A deposit's calldata is built at submission, so its gas is not knowable
    // here: the pool's charge is the whole honest answer.
    const lines = composeFeeLines(
      target(
        context(
          { privacy: registered, recipientRegistration: "registered" },
          {
            destination: "private",
          },
        ),
      ),
      { failed: false, review: review() },
    );
    expect(lines).toEqual(["Pool fee: 2 STRK from your public balance"]);
  });

  test("an unread pool fee renders no line rather than a zero", () => {
    // An unread fee is not a zero fee: the route is given no figure until the
    // pool's charge is known.
    const privateFields = { ...FIELDS, destination: "private" as const };
    expect(
      composeFeeLines(
        { fields: privateFields, poolFee: null, route: transferRoute(privateFields) },
        { failed: false, review: review() },
      ),
    ).toEqual([]);
  });

  test("nothing is quoted before the amount is complete", () => {
    expect(composeFeeTarget(context({}, { amount: "" }))).toBeNull();
    expect(composeFeeTarget(context({}, { amount: "0" }))).toBeNull();
    expect(composeFeeTarget(context({}, { recipient: "" }))).toBeNull();
  });

  test("a comma decimal is never quoted", () => {
    // Number("1,5") is NaN and NaN <= 0 is false, so a bare magnitude check
    // accepts it. The shared finite gate refuses it; that amount also resolves
    // to zero, so the route gate refuses it as well. Both are pinned so neither
    // can start quoting the figure.
    expect(finitePositive("1,5")).toBeNull();
    expect(finitePositive("abc")).toBeNull();
    expect(finitePositive("1e999")).toBeNull();
    expect(composeFeeTarget(context({}, { amount: "1,5" }))).toBeNull();
    expect(composeFeeTarget(context({}, { amount: "1e999" }))).toBeNull();
  });

  test("a route that refuses is not priced", () => {
    // The recipient's registration is the gate the Review button enforces, so a
    // refusing route is not given a figure here either.
    const refused = context(
      { privacy: registered, recipientRegistration: "unregistered" },
      { destination: "private" },
    );
    expect(composeFeeTarget(refused)).toBeNull();
  });

  test("a public transfer pays no pool charge even when one is known", () => {
    // The charge belongs to the pool routes; a plain transfer has none.
    const lines = composeFeeLines(target(context({ privacy: registered })), {
      failed: false,
      review: review(),
    });
    expect(lines).toEqual(["Estimated fee: 0.002 STRK"]);
  });
});

describe("the live preview", () => {
  type Subject = {
    readonly calls: unknown[][];
    readonly delays: number[];
    readonly fee: ReturnType<typeof createComposeFee>;
    readonly form: HTMLFormElement;
    readonly region: HTMLElement;
    readonly runScheduled: () => void;
    readonly setFields: (fields: Partial<TransferFields>) => void;
    readonly setStage: (stage: TransferStage) => void;
    readonly settle: (index: number, value: TransferReview) => void;
  };

  const makeSubject = (
    options: {
      readonly cancellable?: boolean;
      readonly context?: TransferRouteContext;
      readonly fields?: Partial<TransferFields>;
      readonly stage?: TransferStage;
    } = {},
  ): Subject => {
    const form = document.createElement("form");
    const region = document.createElement("div");
    region.id = "send-fee-lines";
    form.append(region);
    document.body.append(form);
    let fields: Partial<TransferFields> = { ...options.fields };
    let stage: TransferStage = options.stage ?? "details";
    const calls: unknown[][] = [];
    const delays: number[] = [];
    const scheduled: { cancelled: boolean; run: () => void }[] = [];
    const resolvers: ((value: TransferReview) => void)[] = [];
    const wallet = {
      async reviewTransfer(...args: unknown[]) {
        calls.push(args);
        return new Promise<TransferReview>((resolve) => {
          resolvers.push(resolve);
        });
      },
    } as unknown as SidepanelWallet;
    const fee = createComposeFee({
      context: () => options.context ?? context({}, fields),
      form,
      schedule: (delayMs, run) => {
        delays.push(delayMs);
        const entry = { cancelled: false, run };
        scheduled.push(entry);
        return () => {
          if (options.cancellable !== false) entry.cancelled = true;
        };
      },
      stage: () => stage,
      wallet,
    });
    return {
      calls,
      delays,
      fee,
      form,
      region,
      runScheduled: () => {
        for (const entry of scheduled.splice(0, scheduled.length)) {
          if (!entry.cancelled) entry.run();
        }
      },
      setFields: (next) => {
        fields = { ...fields, ...next };
      },
      setStage: (next) => {
        stage = next;
      },
      settle: (index, value) => resolvers[index]?.(value),
    };
  };

  test("it estimates through the review's own path and paints what it returns", async () => {
    const subject = makeSubject({ fields: { amount: "1" } });

    // Nothing is estimated until the debounce settles, and the figure is the
    // one the review itself would bind.
    expect(subject.region.textContent).toBe("");
    expect(subject.calls).toHaveLength(0);
    subject.runScheduled();
    expect(subject.calls).toHaveLength(1);
    expect(subject.calls[0]).toEqual([
      FIELDS.accountId,
      FIELDS.tokenId,
      FIELDS.recipient,
      "1",
      FIELDS.speed,
    ]);
    subject.settle(0, review());
    await flush();

    expect(subject.region.textContent).toBe("Estimated fee: 0.002 STRK");
  });

  test("it waits the compose debounce between the last edit and the estimate", () => {
    const subject = makeSubject({ fields: { amount: "1" } });
    expect(subject.delays).toEqual([COMPOSE_FEE_DEBOUNCE_MS]);
  });

  test("an incomplete amount clears rather than quoting", async () => {
    const subject = makeSubject({ fields: { amount: "1" } });
    subject.runScheduled();
    subject.settle(0, review());
    await flush();
    expect(subject.region.textContent).toBe("Estimated fee: 0.002 STRK");

    subject.setFields({ amount: "" });
    subject.fee.refresh();
    expect(subject.region.textContent).toBe("");
    expect(subject.calls).toHaveLength(1);
  });

  test("a superseded estimate never overwrites a newer one", async () => {
    // The scheduler is deliberately not cancellable here, so both requests are
    // live at once: only the most recent may paint.
    const subject = makeSubject({ cancellable: false, fields: { amount: "1" } });
    subject.runScheduled();

    subject.setFields({ amount: "2" });
    subject.fee.refresh();
    subject.runScheduled();
    expect(subject.calls).toHaveLength(2);

    subject.settle(1, review({ fee: { overallFee: "3000000000000000", unit: "FRI" } }));
    await flush();
    expect(subject.region.textContent).toBe("Estimated fee: 0.003 STRK");

    subject.settle(0, review({ fee: { overallFee: "4000000000000000", unit: "FRI" } }));
    await flush();
    expect(subject.region.textContent).toBe("Estimated fee: 0.003 STRK");
  });

  test("clearing drops the lines and ignores a late estimate", async () => {
    const subject = makeSubject({ fields: { amount: "1" } });
    subject.runScheduled();

    subject.fee.clear();
    expect(subject.region.textContent).toBe("");

    subject.settle(0, review());
    await flush();
    expect(subject.region.textContent).toBe("");
  });

  test("leaving the amount step clears the lines", async () => {
    const subject = makeSubject({ fields: { amount: "1" } });
    subject.runScheduled();
    subject.settle(0, review());
    await flush();
    expect(subject.region.textContent).toBe("Estimated fee: 0.002 STRK");

    subject.setStage("review");
    subject.fee.refresh();
    expect(subject.region.textContent).toBe("");
  });

  test("a pool route paints at once and asks the wallet nothing", () => {
    const subject = makeSubject({
      context: context({ privacy: registered }, { destination: "private" }),
    });

    expect(subject.region.textContent).toBe("Pool fee: 2 STRK from your public balance");
    expect(subject.delays).toEqual([]);
    expect(subject.calls).toHaveLength(0);
  });

  test("a form detached before the debounce fires neither asks nor paints", () => {
    // A shell repaint replaces the form, leaving the captured one detached: an
    // estimate for it would be a request with nowhere truthful to land.
    const subject = makeSubject({ fields: { amount: "1" } });
    subject.form.remove();
    subject.runScheduled();
    expect(subject.calls).toHaveLength(0);
    expect(subject.region.textContent).toBe("");
  });

  test("an estimate that lands after the form detaches does not paint", async () => {
    const subject = makeSubject({ fields: { amount: "1" } });
    subject.runScheduled();
    expect(subject.calls).toHaveLength(1);
    subject.form.remove();
    subject.settle(0, review());
    await flush();
    expect(subject.region.textContent).toBe("");
  });
});

describe("on the real form", () => {
  const originalSetTimeout = globalThis.setTimeout;

  beforeEach(() => {
    // Run timers synchronously so the compose debounce and the recipient check
    // settle within the test.
    (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout;
  });

  afterEach(() => {
    (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
  });

  const publicIntent: SendIntent = {
    accountId: account.id,
    destination: "public",
    networkId: status.networkId,
    recipient: TRANSFER_RECIPIENT,
    recipientLabel: "Alice",
    source: "public",
    tokenId: publicBalance.id,
  };

  const shieldIntent: SendIntent = {
    ...publicIntent,
    destination: "private",
    recipient: account.address,
    recipientLabel: "Account 1",
  };

  const open = (
    intent: SendIntent,
    privacy: PrivacyDisclosureState,
    walletOverrides: Record<string, unknown> = {},
  ) => {
    const mounted = mount({
      async loadPrivacyRecipientStatus() {
        return "registered";
      },
      async reviewTransfer() {
        return review();
      },
      ...walletOverrides,
    });
    paint(
      mounted.app,
      sendFlow(status, account, preferences, [publicBalance], {}, {}, "usd", [], intent),
    );
    bindTransfer({
      ...mounted.deps,
      privacy: () => privacy,
      publicBalances: () => [publicBalance, strkBalance],
      senderAddress: () => account.address,
    });
    return mounted;
  };

  const typeAmount = (app: HTMLElement, value: string): void => {
    const input = app.querySelector<HTMLInputElement>("#send-amount-input");
    if (!input) throw new Error("amount input missing");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const feeLines = (app: HTMLElement): string =>
    app.querySelector("#send-fee-lines")?.textContent?.trim() ?? "";

  const publicPrivacy: PrivacyDisclosureState = {
    error: null,
    loading: false,
    value: null,
  };

  test("typing an amount paints the network fee for a public send", async () => {
    const { app } = open(publicIntent, publicPrivacy);
    expect(feeLines(app)).toBe("");

    typeAmount(app, "1");
    await flush();

    expect(feeLines(app)).toBe("Estimated fee: 0.002 STRK");
  });

  test("a shield's pool charge is on screen before any review", () => {
    const { app } = open(shieldIntent, registered);

    expect(app.querySelector("#transfer-form")?.getAttribute("data-stage")).toBe("details");

    typeAmount(app, "1");
    // No estimate is possible for a deposit, so the pool's own charge is the
    // whole line — and it is there before the user reaches Review.
    expect(feeLines(app)).toBe("Pool fee: 2 STRK from your public balance");
  });

  test("emptying the amount takes the fee line away again", async () => {
    const { app } = open(publicIntent, publicPrivacy);
    typeAmount(app, "1");
    await flush();
    expect(feeLines(app)).toBe("Estimated fee: 0.002 STRK");

    typeAmount(app, "");
    expect(feeLines(app)).toBe("");
  });

  test("returning to the amount step from the review re-quotes it", async () => {
    let reviews = 0;
    const { app } = open(publicIntent, publicPrivacy, {
      async reviewTransfer() {
        reviews += 1;
        return review();
      },
    });
    typeAmount(app, "1");
    await flush();
    expect(feeLines(app)).toBe("Estimated fee: 0.002 STRK");

    const form = app.querySelector<HTMLFormElement>("#transfer-form");
    submit(app);
    await flush();
    expect(form?.dataset["stage"]).toBe("review");

    const before = reviews;
    document.querySelector<HTMLButtonElement>("#send-header-back")?.click();
    await flush();

    expect(form?.dataset["stage"]).toBe("details");
    // The amount step asks for the fee again rather than leaving the figure it
    // quoted before the review on screen.
    expect(reviews).toBe(before + 1);
    expect(feeLines(app)).toBe("Estimated fee: 0.002 STRK");
  });
});
