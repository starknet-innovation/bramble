/**
 * The deploy screen across repaints (mc-wallet issue 476).
 *
 * Every paint rebuilds the screen's markup and runs the binder again. State
 * kept on the controls was lost on each one: the fee was quoted again, a quoted
 * fee was dropped, and a repaint during the receipt wait re-offered Deploy over
 * a transaction already sent. The screen's state now survives a repaint for one
 * account and network, and is dropped when the screen is left.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, secondAccount } from "@bramble/testkit/sidepanel";
import type { ActivityEntry } from "@bramble/transactions/activity";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import type { WalletStatus } from "../../../src/popup/responses/responses";
import { outcomeReceiptSection } from "../../../src/sidepanel/shared/outcome-receipt";
import { bindDeploy, type ShellBindingDeps } from "../../../src/sidepanel/shell/shell-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const HASH = "0x04aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FEE = { overallFee: "1000000000000000", unit: "FRI" as const };

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

const deployMarkup = `<section class="section">
    <section id="deploy-review-stage">
      <button id="deploy-button" type="button">Deploy</button>
      <div id="deploy-review"></div>
      <p role="status"></p>
    </section>
    ${outcomeReceiptSection("deploy-success")}
  </section>`;

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await tick();
};

const errorToasts = (): string[] =>
  Array.from(document.querySelectorAll(".toast.error .toast-text")).map(
    (node) => node.textContent ?? "",
  );

// One mount, painted again as the side panel does: new markup, binder again.
const panel = () => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  document.body.append(app);
  const paint = (html = deployMarkup): void => {
    app.innerHTML = html;
  };
  paint();
  return { app, paint };
};

const deployingWallet = () => {
  const calls = { deploys: 0, quotes: 0 };
  let chainStatus: ActivityEntry["status"] | null = null;
  const wallet = {
    deployAccount: async (fee?: typeof FEE) => {
      if (!fee) {
        calls.quotes += 1;
        return FEE;
      }
      calls.deploys += 1;
      return HASH;
    },
    loadActivity: async () => ({
      entries:
        chainStatus === null
          ? []
          : [
              {
                accountId: account.id,
                hash: HASH,
                kind: "deploy" as const,
                networkId: "SN_MAIN" as const,
                status: chainStatus,
                submittedAt: 1,
                summary: "Deploy account contract",
              },
            ],
      historyUnavailable: false,
    }),
    loadStatus: async () => status,
  };
  return {
    calls,
    land: (next: ActivityEntry["status"]) => {
      chainStatus = next;
    },
    wallet: wallet as unknown as ShellBindingDeps["wallet"],
  };
};

const depsFor = (
  app: Element,
  wallet: ShellBindingDeps["wallet"],
  accountId = account.id,
): ShellBindingDeps => ({
  app,
  confirmationDelaysMs: [0, 0, 0, 0, 0, 0, 0, 0],
  deploymentScope: () => ({ accountId, stillCurrent: () => true }),
  render: async () => undefined,
  setActiveView: () => undefined,
  wallet,
});

const press = (app: Element): void => {
  app.querySelector<HTMLButtonElement>("#deploy-button")?.click();
};

describe("deploy screen across repaints", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("a repaint shows the fee in hand and asks for no new quote", async () => {
    const { app, paint } = panel();
    const { calls, wallet } = deployingWallet();
    bindDeploy(depsFor(app, wallet));
    await settle();
    expect(calls.quotes).toBe(1);

    paint();
    bindDeploy(depsFor(app, wallet));
    paint();
    bindDeploy(depsFor(app, wallet));
    await settle();

    expect(calls.quotes).toBe(1);
    expect(app.querySelector("#deploy-review")?.textContent).toContain("Maximum network fee");
    // The fee survived the repaints, so the press deploys rather than quotes.
    press(app);
    await settle();
    expect(calls.deploys).toBe(1);
    expect(calls.quotes).toBe(1);
  });

  test("a quote that lands after a repaint is shown on the rebuilt screen", async () => {
    const { app, paint } = panel();
    const { calls, wallet } = deployingWallet();
    bindDeploy(depsFor(app, wallet));
    paint();
    bindDeploy(depsFor(app, wallet));
    await settle();

    expect(calls.quotes).toBe(1);
    expect(app.querySelector("#deploy-review")?.textContent).toContain("Maximum network fee");
    expect(app.querySelector<HTMLButtonElement>("#deploy-button")?.disabled).toBe(false);
  });

  test("a repaint during the receipt wait keeps the receipt and never re-offers Deploy", async () => {
    const { app, paint } = panel();
    const { calls, land, wallet } = deployingWallet();
    bindDeploy(depsFor(app, wallet));
    await settle();
    press(app);
    await tick();

    paint();
    bindDeploy(depsFor(app, wallet));
    await tick();
    expect(app.querySelector("#deploy-review-stage")?.hasAttribute("hidden")).toBe(true);
    expect(app.querySelector("#deploy-success")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#deploy-success-title")?.textContent).toBe("Deployment submitted");

    land("accepted");
    await settle();
    expect(app.querySelector("#deploy-success-title")?.textContent).toBe("Account deployed");
    expect(calls.deploys).toBe(1);
    expect(calls.quotes).toBe(1);
  });

  test("a repaint while Deploy is in flight keeps it busy, and the hash lands on the rebuilt screen", async () => {
    const { app, paint } = panel();
    let release: (hash: string) => void = () => undefined;
    const calls = { deploys: 0, quotes: 0 };
    const wallet = {
      deployAccount: async (fee?: typeof FEE) => {
        if (!fee) {
          calls.quotes += 1;
          return FEE;
        }
        calls.deploys += 1;
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
      loadActivity: async () => ({ entries: [], historyUnavailable: false }),
      loadStatus: async () => status,
    } as unknown as ShellBindingDeps["wallet"];
    bindDeploy(depsFor(app, wallet));
    await settle();
    press(app);
    await tick();

    paint();
    bindDeploy(depsFor(app, wallet));
    const rebuilt = app.querySelector<HTMLButtonElement>("#deploy-button");
    expect(rebuilt?.disabled).toBe(true);
    // A second press on the rebuilt screen sends nothing, even if something
    // re-enabled the control.
    if (rebuilt) rebuilt.disabled = false;
    rebuilt?.click();
    await tick();
    expect(calls.deploys).toBe(1);

    release(HASH);
    await settle();
    expect(app.querySelector("#deploy-review-stage")?.hasAttribute("hidden")).toBe(true);
    expect(app.querySelector("#deploy-success")?.hasAttribute("hidden")).toBe(false);
    expect(app.querySelector("#deploy-success-title")?.textContent).toBe("Deployment submitted");
    expect(calls.deploys).toBe(1);
    expect(calls.quotes).toBe(1);
  });

  test("a lost reply that lands after a repaint is amber, not a red failure", async () => {
    const { app, paint } = panel();
    let fail: (error: unknown) => void = () => undefined;
    const wallet = {
      deployAccount: async (fee?: typeof FEE) =>
        fee
          ? new Promise<string>((_, reject) => {
              fail = reject;
            })
          : FEE,
      loadActivity: async () => ({ entries: [], historyUnavailable: false }),
      loadStatus: async () => status,
    } as unknown as ShellBindingDeps["wallet"];
    bindDeploy(depsFor(app, wallet));
    await settle();
    press(app);
    await tick();
    paint();
    bindDeploy(depsFor(app, wallet));

    fail(new SubmissionUnknownError("status unknown", null));
    await settle();
    // The deployment may be on chain, so it is never reported as failed.
    expect(document.querySelectorAll(".toast.warning")).toHaveLength(1);
    expect(errorToasts()).toEqual([]);
  });

  test("leaving the screen drops its state, so coming back quotes afresh", async () => {
    const { app, paint } = panel();
    const { calls, wallet } = deployingWallet();
    bindDeploy(depsFor(app, wallet));
    await settle();

    paint("<section>Home</section>");
    bindDeploy(depsFor(app, wallet));
    paint();
    bindDeploy(depsFor(app, wallet));
    await settle();

    expect(calls.quotes).toBe(2);
  });

  test("another account's screen quotes its own fee", async () => {
    const { app, paint } = panel();
    const { calls, wallet } = deployingWallet();
    bindDeploy(depsFor(app, wallet));
    await settle();

    paint();
    bindDeploy(depsFor(app, wallet, secondAccount.id));
    await settle();

    expect(calls.quotes).toBe(2);
  });

  test("a quote that fails as the screen opens is not toasted", async () => {
    const { app } = panel();
    const wallet = {
      deployAccount: async () => {
        throw new Error("The node did not answer.");
      },
    } as unknown as ShellBindingDeps["wallet"];
    bindDeploy(depsFor(app, wallet));
    await settle();

    expect(errorToasts()).toEqual([]);
    expect(app.querySelector("#deploy-review")?.textContent).toContain("The node did not answer.");
  });
});
