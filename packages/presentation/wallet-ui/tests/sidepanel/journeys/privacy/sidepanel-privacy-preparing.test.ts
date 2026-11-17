/**
 * The wait behind "Go private".
 *
 * Reported on a funded mainnet account as "pressing the shield button doesn't
 * work": the press started a registration proof — a tracked job of up to
 * several minutes — with nothing on screen but the tile dimmed, and every
 * repaint undimmed it again. These pin what the entry does at every moment: the
 * preparing screen appears on the press itself, every poll of the job rewrites
 * its liveness line with the phase and elapsed time, a second press rejoins the
 * running proof instead of starting another, backing out drops the outcome
 * without losing the job, and a press during discovery joins the read in
 * flight rather than restarting it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, preferences } from "@bramble/testkit/sidepanel";
import { PrivacyBlockerError } from "@bramble/wallet-protocol/privacy-blocker";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type {
  PrivacyDisclosureState,
  PrivacyJourneyState,
} from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import type { PreparationProgress } from "../../../../src/sidepanel/journeys/privacy/privacy-preparation-job";
import type { PrivacyAccountState } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import {
  bindPrivacy,
  type PrivacyUiDeps,
} from "../../../../src/sidepanel/journeys/privacy/privacy-ui";
import {
  PROVING_HINT,
  privacyFlow,
} from "../../../../src/sidepanel/journeys/privacy/privacy-views";
import type { SendIntent } from "../../../../src/sidepanel/journeys/send/send-model";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import { deferred, flush } from "../../../support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const TOKEN_ID = "SN_MAIN:STRK:0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

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

const reading = (registration: PrivacyAccountState["registration"]): PrivacyAccountState => ({
  accountId: account.id,
  balances: [],
  networkId: "SN_MAIN",
  poolFeeFri: "0x1",
  relayConfigured: true,
  registration,
});

const settled = (registration: PrivacyAccountState["registration"]): PrivacyDisclosureState => ({
  error: null,
  loading: false,
  value: reading(registration),
});

const digest = `sha256:${"a".repeat(64)}`;
const preparation = {
  id: digest,
  kind: "register" as const,
  payloadDigest: digest,
  poolAddress: "0x123",
  route: "public-account" as const,
  summaries: ["Register viewing-key commitment"],
  symbol: "STRK",
  tokenId: TOKEN_ID,
};

const HOME = `<button data-privacy-open="${TOKEN_ID}">Shield</button>`;

// One controller generation per surface: a proof is keyed by its account
// scope, and a held proof from one test must not be the one the next rejoins.
let generation = 0;

type Surface = {
  readonly app: HTMLElement;
  /** The header's back: Home again, with the journey left as it is. */
  readonly goHome: () => void;
  readonly intents: readonly SendIntent[];
  readonly journey: () => PrivacyJourneyState;
  readonly views: readonly string[];
  /** Repaints the current view from state, as the entrypoint's paint loop does. */
  readonly repaint: () => void;
};

/**
 * A small stand-in for the entrypoint's paint loop: `navigate` paints the view
 * it is asked for — Home's entry, or the privacy screen for the current
 * journey — and re-binds it, so the screens the entry lands on are the real
 * templates with their real controls.
 */
const mountSurface = (
  initial: PrivacyDisclosureState,
  wallet: Partial<Record<keyof SidepanelWallet, unknown>>,
): Surface => {
  let disclosure = initial;
  let journey: PrivacyJourneyState = { stage: "idle" };
  let view = "home";
  const intents: SendIntent[] = [];
  const views: string[] = [];
  const app = document.createElement("main");
  document.body.append(app);
  generation += 1;
  const scope = generation;
  const deps: PrivacyUiDeps = {
    app,
    balances: () => [],
    disclosure: () => disclosure,
    generation: () => scope,
    journey: () => journey,
    navigate: (next) => {
      views.push(next);
      view = next;
      repaint();
    },
    openSend: (intent) => {
      intents.push(intent);
    },
    paint: () => undefined,
    preferences: () => preferences,
    setDisclosure: (state) => {
      disclosure = state;
    },
    setJourney: (state) => {
      journey = state;
    },
    status: () => status,
    wallet: wallet as unknown as SidepanelWallet,
  };
  const repaint = (): void => {
    app.innerHTML = view === "privacy" ? privacyFlow(status, preferences, journey) : HOME;
    bindPrivacy(deps);
  };
  repaint();
  return {
    app,
    goHome: () => {
      view = "home";
      repaint();
    },
    intents,
    journey: () => journey,
    repaint,
    views,
  };
};

const press = (app: HTMLElement): void => {
  app.querySelector<HTMLButtonElement>("[data-privacy-open]")?.dispatchEvent(new Event("click"));
};

const preparingStep = (app: HTMLElement): string | null =>
  app.querySelector("[data-privacy-preparing]")?.getAttribute("data-privacy-preparing") ?? null;

const liveness = (app: HTMLElement): string =>
  app.querySelector("#privacy-liveness")?.textContent ?? "";

/** A registration preparation the test settles by hand, with its progress sink captured. */
const heldRegistration = () => {
  const held = deferred<typeof preparation>();
  let calls = 0;
  let report: ((progress: PreparationProgress) => void) | undefined;
  return {
    calls: () => calls,
    preparePrivacyRegistration: (onProgress?: (progress: PreparationProgress) => void) => {
      calls += 1;
      report = onProgress;
      return held.promise;
    },
    reject: held.reject,
    report: (progress: PreparationProgress) => report?.(progress),
    resolve: held.resolve,
  };
};

describe("the preparing screen", () => {
  test("appears on the press itself, before the proof has reported anything", async () => {
    const registration = heldRegistration();
    const { app, views } = mountSurface(settled("unregistered"), registration);

    press(app);
    await flush();

    expect(views).toEqual(["privacy"]);
    expect(preparingStep(app)).toBe("proving");
    expect(app.textContent).toContain("Preparing to go private");
    expect(app.textContent).toContain("Build registration proof");
    expect(liveness(app)).toBe(PROVING_HINT);
    // The way back is on the screen; the home entry it replaced is not.
    expect(app.querySelector("#privacy-cancel")).not.toBeNull();
    expect(app.querySelector("[data-privacy-open]")).toBeNull();
  });

  test("every poll rewrites the liveness line in place and survives a repaint", async () => {
    const registration = heldRegistration();
    const { app, journey, repaint } = mountSurface(settled("unregistered"), registration);
    press(app);
    await flush();
    const before = app.querySelector("#privacy-liveness");

    registration.report({ elapsedMs: 72_000, phase: "proving" });

    expect(liveness(app)).toBe(`Proving · 1 min 12 s. ${PROVING_HINT}`);
    // Rewritten, not repainted: the same node carries the new text.
    expect(app.querySelector("#privacy-liveness")).toBe(before);
    const current = journey();
    expect(current.stage === "preparing" ? current.progress : null).toEqual({
      elapsedMs: 72_000,
      phase: "proving",
    });

    repaint();

    expect(liveness(app)).toBe(`Proving · 1 min 12 s. ${PROVING_HINT}`);
  });

  test("the review replaces the wait when the proof lands", async () => {
    const registration = heldRegistration();
    const { app, journey, views } = mountSurface(settled("unregistered"), registration);
    press(app);
    await flush();

    registration.resolve(preparation);
    await flush();

    expect(journey().stage).toBe("activate-review");
    expect(views).toEqual(["privacy", "privacy"]);
    expect(app.querySelector("#privacy-confirm")).not.toBeNull();
    expect(app.querySelector("[data-privacy-preparing]")).toBeNull();
  });

  test("a second press while the proof runs rejoins it rather than starting another", async () => {
    const registration = heldRegistration();
    const { app, goHome, views } = mountSurface(settled("unregistered"), registration);
    press(app);
    await flush();
    registration.report({ elapsedMs: 30_000, phase: "waiting for pool maturity" });
    // Back on Home by the header's back: the journey still owns the wait.
    goHome();

    press(app);
    await flush();

    expect(registration.calls()).toBe(1);
    expect(views).toEqual(["privacy", "privacy"]);
    expect(preparingStep(app)).toBe("proving");
    // The rejoined screen opens on the proof's latest progress, not from zero.
    expect(liveness(app)).toBe(`Waiting for pool maturity · 30 s. ${PROVING_HINT}`);
  });

  test("backing out drops the outcome, and pressing again rejoins the same proof", async () => {
    const registration = heldRegistration();
    const { app, journey, views } = mountSurface(settled("unregistered"), registration);
    press(app);
    await flush();

    app.querySelector<HTMLButtonElement>("#privacy-cancel")?.dispatchEvent(new Event("click"));

    expect(journey()).toEqual({ stage: "idle" });
    expect(views).toEqual(["privacy", "home"]);
    // A poll for a wait nobody is watching changes nothing.
    registration.report({ elapsedMs: 10_000, phase: "proving" });
    expect(journey()).toEqual({ stage: "idle" });

    press(app);
    await flush();
    expect(registration.calls()).toBe(1);
    expect(preparingStep(app)).toBe("proving");

    registration.resolve(preparation);
    await flush();
    expect(journey().stage).toBe("activate-review");
  });

  test("an outcome for an abandoned wait is never applied", async () => {
    const registration = heldRegistration();
    const { app, journey, views } = mountSurface(settled("unregistered"), registration);
    press(app);
    await flush();
    app.querySelector<HTMLButtonElement>("#privacy-cancel")?.dispatchEvent(new Event("click"));

    registration.reject(new PrivacyBlockerError("fund", "Not enough STRK for the pool fee"));
    await flush();

    expect(journey()).toEqual({ stage: "idle" });
    expect(views).toEqual(["privacy", "home"]);
    expect(document.querySelector(".toast")).toBeNull();
  });

  test("a prerequisite that stops the proof lands on its explained screen", async () => {
    const registration = heldRegistration();
    const { app, journey } = mountSurface(settled("unregistered"), registration);
    press(app);
    await flush();

    registration.reject(new PrivacyBlockerError("fund", "Not enough STRK for the pool fee"));
    await flush();

    const current = journey();
    expect(current.stage === "blocked" ? current.blocker.kind : null).toBe("fund");
    expect(app.querySelector('[data-privacy-blocker="fund"]')).not.toBeNull();
    expect(app.querySelector("[data-privacy-preparing]")).toBeNull();
  });

  test("a retry that meets the same answer is still voiced", async () => {
    // The wait can come and go within one frame, so a retry whose answer has not
    // changed would otherwise repaint nothing and look ignored.
    const { app } = mountSurface(settled("unregistered"), {
      preparePrivacyRegistration: async () => {
        throw new Error("The prover is offline.");
      },
    });
    press(app);
    await flush();
    expect(document.querySelector(".toast")).toBeNull();

    app.querySelector<HTMLButtonElement>("#privacy-retry")?.dispatchEvent(new Event("click"));
    await flush();

    expect(document.querySelector(".toast.error .toast-text")?.textContent).toBe(
      "The prover is offline.",
    );
  });
});

describe("a press during discovery", () => {
  test("joins the read in flight and shows the discovering step meanwhile", async () => {
    const read = deferred<PrivacyAccountState>();
    let loads = 0;
    // Discovery has not settled yet: the surface's own bind starts it.
    const { app, intents, views } = mountSurface(
      { error: null, loading: false, value: null },
      {
        loadPrivacyState: () => {
          loads += 1;
          return read.promise;
        },
      },
    );
    expect(loads).toBe(1);

    press(app);
    await flush();

    expect(loads).toBe(1);
    expect(views).toEqual(["privacy"]);
    expect(preparingStep(app)).toBe("discovering");
    expect(app.textContent).toContain("Checking private balances");

    // A registered account, once the read lands, is the shield shortcut.
    read.resolve(reading("registered"));
    await flush();

    expect(intents).toEqual([
      expect.objectContaining({ destination: "private", source: "public", tokenId: TOKEN_ID }),
    ]);
  });

  test("continues into the proof once the read reports an unregistered account", async () => {
    const read = deferred<PrivacyAccountState>();
    const registration = heldRegistration();
    const { app } = mountSurface(
      { error: null, loading: false, value: null },
      { loadPrivacyState: () => read.promise, ...registration },
    );
    press(app);
    await flush();
    expect(preparingStep(app)).toBe("discovering");

    read.resolve(reading("unregistered"));
    await flush();

    expect(preparingStep(app)).toBe("proving");
    expect(registration.calls()).toBe(1);
  });

  test("backing out of the discovering wait leaves its answer unacted on", async () => {
    const read = deferred<PrivacyAccountState>();
    const registration = heldRegistration();
    const { app, journey } = mountSurface(
      { error: null, loading: false, value: null },
      { loadPrivacyState: () => read.promise, ...registration },
    );
    press(app);
    await flush();
    app.querySelector<HTMLButtonElement>("#privacy-cancel")?.dispatchEvent(new Event("click"));

    read.resolve(reading("unregistered"));
    await flush();

    expect(journey()).toEqual({ stage: "idle" });
    expect(registration.calls()).toBe(0);
  });
});
