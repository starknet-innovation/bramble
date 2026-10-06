/**
 * The recovery confirmation on the read-only Home flag, under happy-dom: the
 * review opens an explicit Cancel/confirm panel stating the fee and the
 * consequence; the armed panel resets on Cancel, on expiry, and never attaches
 * to a flag a re-render replaced; the submit sends back exactly the review.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { RecoveryReview } from "../../../../src/popup/responses/responses-recovery";
import {
  bindRecoverAccount,
  RECOVERY_CONFIRM_TTL_MS,
  type RecoveryUiDeps,
} from "../../../../src/sidepanel/journeys/portfolio/recovery-ui";
import { readOnlyNotice } from "../../../../src/sidepanel/journeys/portfolio/recovery-view";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const BRAAVOS_REVIEW: RecoveryReview = {
  accountId: "SN_MAIN:0xb4a",
  expiresAt: null,
  fee: { overallFee: "1500000000000000000", unit: "FRI" },
  ok: true,
  readyAt: 1_900_000_000,
  replaces: null,
  step: "start",
};
const ARGENT_START: RecoveryReview = {
  accountId: "SN_MAIN:0xa4e",
  expiresAt: 1_900_604_800,
  fee: { overallFee: "2000000000000000000", unit: "FRI" },
  ok: true,
  readyAt: 1_900_000_000,
  replaces: null,
  step: "start",
};

type Mount = {
  readonly app: HTMLElement;
  readonly calls: { readonly renders: unknown[][]; readonly submits: RecoveryReview[] };
  readonly expire: () => void;
  readonly timers: { readonly cleared: number; readonly scheduled: number[] };
};

const mount = (
  reason: "guardian" | "strong-signer",
  review: RecoveryReview | (() => Promise<RecoveryReview>),
  options: { readonly stage?: "ready"; readonly submitFails?: boolean } = {},
): Mount => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  document.body.append(app);
  app.innerHTML = readOnlyNotice(
    {
      readOnly: true,
      reason,
      ...(options.stage
        ? {
            recovery: {
              delaySeconds: 604_800,
              expiresAt: 1_900_604_800,
              pendingUntil: 1_900_000_000,
              stage: options.stage,
            },
          }
        : {}),
    },
    false,
  );
  const calls: Mount["calls"] = { renders: [], submits: [] };
  const fetchReview = typeof review === "function" ? review : async () => review;
  const submitted = async (sent: RecoveryReview) => {
    calls.submits.push(sent);
    if (options.submitFails) throw new Error("The recovery fee changed. Review it and try again.");
    return {
      accountId: sent.accountId,
      ok: true as const,
      pendingUntil: 1,
      transactionHash: "0x5",
    };
  };
  const wallet = {
    loadStatus: async () => ({ status: "loaded" }),
    recoverArgentAccount: submitted,
    recoverBraavosAccount: submitted,
    reviewArgentRecovery: fetchReview,
    reviewBraavosRecovery: fetchReview,
  } as unknown as RecoveryUiDeps["wallet"];
  let pending: (() => void) | null = null;
  const timers = { cleared: 0, scheduled: [] as number[] };
  bindRecoverAccount(
    {
      app,
      render: async (...args: unknown[]) => {
        calls.renders.push(args);
      },
      wallet,
    },
    {
      clear: () => {
        timers.cleared += 1;
        pending = null;
      },
      set: (task, ms) => {
        timers.scheduled.push(ms);
        pending = task;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
    },
  );
  return {
    app,
    calls,
    expire: () => {
      pending?.();
    },
    timers,
  };
};

const open = async (app: HTMLElement): Promise<void> => {
  app.querySelector<HTMLButtonElement>("#recover-account")?.click();
  await tick();
};
const text = (app: HTMLElement): string => app.textContent?.replace(/\s+/g, " ") ?? "";

describe("recovery confirmation", () => {
  test("states the Braavos fee, the consequence, the effect time and who can cancel", async () => {
    const { app } = mount("strong-signer", BRAAVOS_REVIEW);
    await open(app);
    const panel = text(app);
    expect(panel).toContain("Remove 2FA from this account?");
    expect(panel).toContain(
      "This permanently removes 2FA from this account, along with any multisig or withdrawal limit on it. After that, your recovery phrase alone controls the account.",
    );
    expect(panel).toContain(
      "Takes effect after 17/03/30 at 17h46 UTC. Until then, you can cancel it from your Braavos device.",
    );
    expect(panel).toMatch(/Maximum network fee: 1\.5 STRK/);
    expect(app.querySelector("#recovery-cancel")?.textContent).toBe("Cancel");
    expect(app.querySelector("#recovery-confirm")?.textContent).toBe("Remove 2FA");
    // No two-tap relabel: the original action is gone while the panel is up.
    expect(app.querySelector("#recover-account")).toBeNull();
  });

  test("states the Ready window, the cancel rule and an owner-escape warning", async () => {
    const { app } = mount("guardian", {
      ...ARGENT_START,
      replaces: { kind: "owner-escape", readyAt: 1_899_000_000 },
    });
    await open(app);
    const panel = text(app);
    expect(panel).toContain("Remove the guardian from this account?");
    expect(panel).toContain(
      "You can complete the removal after 17/03/30 at 17h46 UTC, until 24/03/30 at 17h46 UTC. After that, it expires.",
    );
    expect(panel).toContain(
      "Cancelling needs this account's key and your guardian together, in Ready.",
    );
    expect(panel).toContain(
      "Your guardian has started replacing this account's key. Continuing cancels that change. If you asked for it, don't continue.",
    );
    expect(panel).toMatch(/Maximum network fee: 2 STRK/);
    expect(panel).not.toContain("usable in");
    expect(app.querySelector("#recovery-confirm")?.textContent).toBe("Start removal");
  });

  test("warns that starting cancels a pending change to a new guardian", async () => {
    const { app } = mount("guardian", {
      ...ARGENT_START,
      replaces: { kind: "guardian-change", readyAt: 1_899_000_000 },
    });
    await open(app);
    expect(text(app)).toContain(
      "A change to a new guardian, started with this account's key, is pending. Continuing cancels that change. If you asked for it, don't continue.",
    );
    expect(text(app)).not.toContain("Your guardian has started replacing");
  });

  test("says completing a Ready escape is immediate", async () => {
    const { app } = mount("guardian", { ...ARGENT_START, step: "complete" }, { stage: "ready" });
    await open(app);
    const panel = text(app);
    expect(panel).toContain("Complete guardian removal?");
    expect(panel).toContain("This removes the guardian from this account now.");
    expect(panel).not.toContain("usable in");
    expect(panel).not.toContain("days");
    expect(app.querySelector("#recovery-confirm")?.textContent).toBe("Remove guardian");
  });

  test("Cancel resets the flag and nothing is submitted", async () => {
    const { app, calls } = mount("strong-signer", BRAAVOS_REVIEW);
    await open(app);
    app.querySelector<HTMLButtonElement>("#recovery-cancel")?.click();
    expect(app.querySelector("[data-recovery-confirm]")).toBeNull();
    expect(app.querySelector<HTMLButtonElement>("#recover-account")?.disabled).toBe(false);
    expect(calls.submits).toEqual([]);
  });

  test("an armed panel expires back to the flag", async () => {
    const { app, calls, expire, timers } = mount("guardian", ARGENT_START);
    await open(app);
    expect(timers.scheduled).toEqual([RECOVERY_CONFIRM_TTL_MS]);
    expire();
    expect(app.querySelector("[data-recovery-confirm]")).toBeNull();
    expect(app.querySelector("#recover-account")).not.toBeNull();
    expect(calls.submits).toEqual([]);
  });

  test("never attaches to a flag a re-render replaced while reviewing", async () => {
    let release: (value: RecoveryReview) => void = () => undefined;
    const { app } = mount(
      "guardian",
      () =>
        new Promise<RecoveryReview>((resolve) => {
          release = resolve;
        }),
    );
    app.querySelector<HTMLButtonElement>("#recover-account")?.click();
    app.replaceChildren();
    release(ARGENT_START);
    await tick();
    expect(document.querySelector("[data-recovery-confirm]")).toBeNull();
  });

  test("confirm submits exactly the review, then disarms and force-refreshes", async () => {
    const { app, calls, timers } = mount("guardian", ARGENT_START);
    await open(app);
    app.querySelector<HTMLButtonElement>("#recovery-confirm")?.click();
    await tick();
    await tick();
    expect(calls.submits).toEqual([ARGENT_START]);
    expect(timers.cleared).toBeGreaterThan(0);
    expect(app.querySelector("[data-recovery-confirm]")).toBeNull();
    expect(calls.renders).toEqual([[{ status: "loaded" }, "action"]]);
  });

  test("a refused submit still spends the panel", async () => {
    const { app, calls } = mount("strong-signer", BRAAVOS_REVIEW, { submitFails: true });
    await open(app);
    app.querySelector<HTMLButtonElement>("#recovery-confirm")?.click();
    await tick();
    await tick();
    expect(calls.submits).toHaveLength(1);
    expect(app.querySelector("[data-recovery-confirm]")).toBeNull();
  });

  test("a failed review leaves the flag as it was", async () => {
    const { app } = mount("guardian", async () => {
      throw new Error("Guardian removal is still in its waiting period");
    });
    await open(app);
    expect(app.querySelector("[data-recovery-confirm]")).toBeNull();
    expect(app.querySelector<HTMLButtonElement>("#recover-account")?.disabled).toBe(false);
  });
});
