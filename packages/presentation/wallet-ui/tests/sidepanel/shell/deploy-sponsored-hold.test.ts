/**
 * The deploy screen while a sponsored attempt's hold stands (issue 788). The
 * account may be deploying, so the screen says so in one sentence, busy, with
 * no Deploy, and re-checks on its own: the chain showing the account deployed
 * repaints it deployed, and the hold ending brings back the plain self-paid
 * screen. The re-check belongs to this account's screen: leaving it, locking or
 * switching away stops it, and a callback from a stopped one does nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { DEPLOYMENT_IN_PROGRESS } from "@bramble/privacy/sponsored-deploy";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import type { DeploySponsorship } from "../../../src/sidepanel/runtime/runtime-deploy";
import { DEPLOY_HOLD_RECHECK_MS } from "../../../src/sidepanel/shell/deploy-journey";
import { deployCostLine } from "../../../src/sidepanel/shell/deploy-sponsorship";
import {
  bindDeployScreen as bind,
  deployQuote,
  mountDeployScreen as mount,
  press,
  repaintDeployScreen,
  screen,
  tick,
  deployWallet as wallet,
} from "../../support/deploy-screen-harness";
import { registerDom, unregisterDom } from "../../support/groups-harness";
import { manualTimers } from "../../support/manual-timers";

beforeAll(registerDom);
afterAll(unregisterDom);

const PLAIN_FEE = `Cost ${deployCostLine(deployQuote, "none")}`;

// The deploy screen as it stands while held.
const expectDeploying = (container: HTMLElement): void => {
  const view = screen(container);
  expect(view.status).toBe(DEPLOYMENT_IN_PROGRESS);
  expect(view.button?.hidden).toBe(true);
  expect(view.button?.disabled).toBe(true);
  expect(view.stage?.getAttribute("aria-busy")).toBe("true");
  expect(view.cost).toBe("");
  expect(view.cost + view.status).not.toMatch(/sponsor|may (still )?land/i);
};

// A sponsorship answer that reads from a list, then repeats its last entry.
const sequence = (...answers: DeploySponsorship[]): (() => DeploySponsorship) => {
  let index = 0;
  return () => answers[Math.min(index++, answers.length - 1)] ?? "none";
};

describe("deploy screen during a sponsored attempt's hold", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("says the account is deploying, busy, with no Deploy and no toast", async () => {
    const timers = manualTimers();
    const container = mount();
    const stub = wallet({ sponsored: async () => "0x5ab", sponsorship: "held" });
    bind(container, stub.wallet, { current: () => true, timers });
    await tick();
    expectDeploying(container);
    expect(document.querySelectorAll(".toast").length).toBe(0);
    expect(timers.pending()).toBe(1);
  });

  test("keeps re-checking while held, without user action", async () => {
    const timers = manualTimers();
    const container = mount();
    const stub = wallet({ sponsored: async () => "0x5ab", sponsorship: "held" });
    bind(container, stub.wallet, { current: () => true, timers });
    await tick();
    for (let round = 0; round < 3; round += 1) {
      timers.advance(DEPLOY_HOLD_RECHECK_MS);
      await tick();
      expectDeploying(container);
      expect(timers.pending()).toBe(1);
    }
    expect(stub.calls.filter((call) => call === "deploySponsorship")).toHaveLength(4);
  });

  test("moves to the deployed screen when the chain shows the account deployed", async () => {
    const timers = manualTimers();
    const container = mount();
    let deployed = false;
    const repainted: unknown[] = [];
    const stub = wallet({
      deployed: () => deployed,
      sponsored: async () => "0x5ab",
      sponsorship: sequence("held", "held", "none"),
    });
    bind(container, stub.wallet, {
      current: () => true,
      render: async (status) => {
        repainted.push(status);
      },
      timers,
    });
    await tick();
    timers.advance(DEPLOY_HOLD_RECHECK_MS);
    await tick();
    expect(repainted).toEqual([]);
    deployed = true;
    timers.advance(DEPLOY_HOLD_RECHECK_MS);
    await tick();
    expect(repainted).toEqual([{ networkId: "SN_SEPOLIA" }]);
    expect(timers.pending()).toBe(0);
  });

  test("shows the plain self-paid screen when the hold ends, without user action", async () => {
    const timers = manualTimers();
    const container = mount();
    const stub = wallet({ sponsored: async () => "0x5ab", sponsorship: sequence("held", "none") });
    bind(container, stub.wallet, { current: () => true, timers });
    await tick();
    expectDeploying(container);
    timers.advance(DEPLOY_HOLD_RECHECK_MS);
    await tick();
    const view = screen(container);
    expect(view.cost).toBe(PLAIN_FEE);
    expect(view.status).toBe("");
    expect(view.button?.hidden).toBe(false);
    expect(view.button?.disabled).toBe(false);
    expect(view.stage?.hasAttribute("aria-busy")).toBe(false);
    expect(timers.pending()).toBe(0);
    press(container);
    await tick();
    expect(stub.calls.filter((call) => call.startsWith("deployAccount"))).toEqual([
      "deployAccount:quote",
      "deployAccount:quote",
      "deployAccount:fee",
    ]);
  });

  test("a lost sponsored reply shows the deploying screen, not a warning", async () => {
    const timers = manualTimers();
    const container = mount();
    const stub = wallet({
      sponsored: async () => {
        throw new SubmissionUnknownError("deployment failed", null);
      },
      sponsorship: sequence("available", "held"),
    });
    bind(container, stub.wallet, { current: () => true, timers });
    await tick();
    press(container);
    await tick();
    expectDeploying(container);
    expect(document.querySelectorAll(".toast").length).toBe(0);
    expect(timers.pending()).toBe(1);
  });

  test("a deploy press refused by the hold shows the deploying screen", async () => {
    const timers = manualTimers();
    const container = mount();
    const stub = wallet({
      selfPaid: async () => {
        throw new Error(DEPLOYMENT_IN_PROGRESS);
      },
      sponsored: async () => "0x5ab",
      sponsorship: "none",
    });
    bind(container, stub.wallet, { current: () => true, timers });
    await tick();
    press(container);
    await tick();
    expectDeploying(container);
    expect(timers.pending()).toBe(1);
  });

  test("leaving the screen (or locking) stops the re-check, and a stale callback does nothing", async () => {
    const timers = manualTimers();
    const container = mount();
    const stub = wallet({ sponsored: async () => "0x5ab", sponsorship: "held" });
    bind(container, stub.wallet, { current: () => true, timers });
    await tick();
    expect(timers.pending()).toBe(1);
    // A paint with no deploy screen: another view, or the lock screen.
    container.replaceChildren();
    bind(container, stub.wallet, { current: () => true, timers });
    expect(timers.pending()).toBe(0);
    const asked = stub.calls.length;
    timers.flush();
    await tick();
    expect(stub.calls.length).toBe(asked);
  });

  test("switching account or network stops the re-check", async () => {
    const timers = manualTimers();
    const container = mount();
    let current = true;
    const stub = wallet({ sponsored: async () => "0x5ab", sponsorship: "held" });
    bind(container, stub.wallet, { current: () => current, timers });
    await tick();
    current = false;
    const asked = stub.calls.length;
    // Due before the switch repaints anything: the callback sees the switch.
    timers.advance(DEPLOY_HOLD_RECHECK_MS);
    await tick();
    expect(stub.calls.length).toBe(asked);
    expect(timers.pending()).toBe(0);
    // The repaint for the new account starts its own screen.
    current = true;
    const next = mount();
    bind(next, stub.wallet, { current: () => true, timers });
    await tick();
    expect(timers.pending()).toBe(1);
  });

  test("a repaint for another account drops the held account's re-check", async () => {
    const timers = manualTimers();
    const container = mount();
    const held = wallet({ sponsored: async () => "0x5ab", sponsorship: "held" });
    bind(container, held.wallet, { current: () => true, timers });
    await tick();
    expect(timers.pending()).toBe(1);
    repaintDeployScreen(container);
    const other = wallet({ sponsored: async () => "0x5ab", sponsorship: "none" });
    bind(container, other.wallet, { accountId: "SN_SEPOLIA:0xdef", current: () => true, timers });
    await tick();
    expect(timers.pending()).toBe(0);
    expect(screen(container).status).toBe("");
  });

  test("a repaint while held keeps one re-check, not two", async () => {
    const timers = manualTimers();
    const container = mount();
    const stub = wallet({ sponsored: async () => "0x5ab", sponsorship: "held" });
    bind(container, stub.wallet, { current: () => true, timers });
    await tick();
    bind(container, stub.wallet, { current: () => true, timers });
    await tick();
    expectDeploying(container);
    expect(timers.pending()).toBe(1);
  });
});
