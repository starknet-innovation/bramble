/**
 * Behavioural coverage for the dashboard chrome bindings under happy-dom:
 * bindDashboard (lock control + reload-balances retry) and bindDeploy (the account
 * deployment action and its post-submit watch kick-off); bindPickers lives in
 * sidepanel-network-picker.test.ts. Each binding is driven against a
 * recording fake wallet with a minimal hand-built DOM carrying exactly the
 * ids/attributes the binders query, then real clicks are dispatched and both the
 * wallet call and the resulting DOM/toast feedback are asserted. Mirrors the
 * registerDom harness used by the account-select and deployment-watch suites.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import type { ActivityEntry } from "@bramble/transactions/activity";
import type {
  DeploymentStatusResponse,
  WalletStatus,
} from "../../../src/popup/responses/responses";
import { outcomeReceiptSection } from "../../../src/sidepanel/shared/outcome-receipt";
import { accountLabel } from "../../../src/sidepanel/shared/parts";
import {
  bindDashboard,
  bindDeploy,
  type ShellBindingDeps,
} from "../../../src/sidepanel/shell/shell-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const HASH = "0x04aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const status: WalletStatus = {
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_SEPOLIA", name: "Starknet Sepolia" },
  ],
  ready: true,
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (html: string): HTMLElement => {
  document.body.replaceChildren();
  const container = document.createElement("div");
  container.id = "app";
  container.append(document.createRange().createContextualFragment(html));
  document.body.append(container);
  return container;
};

// A recording fake wallet whose methods can be swapped per test. Only the
// members the shell bindings call are implemented.
type WalletCalls = {
  lock: number;
  loadStatus: number;
  deploy: number;
  setActiveNetwork: string[];
  setActiveAccount: string[];
};

const click = (element: Element | null): void => {
  if (!(element instanceof window.HTMLElement)) {
    throw new Error("click target missing");
  }
  element.click();
};

const toastTexts = (tone: "error" | "success"): string[] =>
  Array.from(document.querySelectorAll(`.toast.${tone} .toast-text`)).map(
    (node) => node.textContent ?? "",
  );

const errorToasts = (): string[] => toastTexts("error");

describe("bindDashboard", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("locks the vault, toasts success, and re-renders with the returned status", async () => {
    const container = mount(
      `<section class="section">
         <button id="lock-button" type="button"><svg></svg></button>
         <p id="panel-result" role="status"></p>
       </section>
       <button data-reload-balances type="button"></button>`,
    );
    const renders: WalletStatus[] = [];
    const calls: WalletCalls = {
      deploy: 0,
      loadStatus: 0,
      lock: 0,
      setActiveAccount: [],
      setActiveNetwork: [],
    };
    const wallet = {
      lockVault: async () => {
        calls.lock += 1;
        return status;
      },
      loadStatus: async () => {
        calls.loadStatus += 1;
        return status;
      },
    };
    bindDashboard({
      app: container,
      render: async (next) => {
        renders.push(next);
      },
      setActiveView: () => undefined,
      wallet: wallet as unknown as ShellBindingDeps["wallet"],
    });

    click(container.querySelector("#lock-button"));
    await tick();

    expect(calls.lock).toBe(1);
    expect(renders).toEqual([status]);
    expect(document.querySelectorAll(".toast.success").length).toBeGreaterThan(0);
  });

  test("surfaces a lock failure on the panel result without re-rendering", async () => {
    const container = mount(
      `<section class="section">
         <button id="lock-button" type="button"></button>
         <p id="panel-result" role="status"></p>
       </section>`,
    );
    const renders: WalletStatus[] = [];
    const lockButton = container.querySelector<HTMLButtonElement>("#lock-button");
    const wallet = {
      lockVault: async () => {
        throw new Error("The vault refused to lock.");
      },
    };
    bindDashboard({
      app: container,
      render: async (next) => {
        renders.push(next);
      },
      setActiveView: () => undefined,
      wallet: wallet as unknown as ShellBindingDeps["wallet"],
    });

    click(lockButton);
    await tick();

    expect(renders).toEqual([]);
    expect(container.querySelector("#panel-result")?.textContent).toBe(
      "The vault refused to lock.",
    );
    expect(errorToasts()).toContain("The vault refused to lock.");
    // The lock button is re-enabled so the user can retry.
    expect(lockButton?.disabled).toBe(false);
  });

  test("reload-balances controls reload status; a failed reload re-enables the button", async () => {
    const container = mount(
      `<button id="ok-reload" data-reload-balances type="button"></button>
       <button id="bad-reload" data-reload-balances type="button"></button>`,
    );
    const renders: WalletStatus[] = [];
    const reasons: (string | undefined)[] = [];
    let mode: "ok" | "bad" = "ok";
    const wallet = {
      loadStatus: async () => {
        if (mode === "bad") {
          throw new Error("no balances");
        }
        return status;
      },
    };
    bindDashboard({
      app: container,
      render: async (next, reason) => {
        renders.push(next);
        reasons.push(reason);
      },
      setActiveView: () => undefined,
      wallet: wallet as unknown as ShellBindingDeps["wallet"],
    });

    click(container.querySelector("#ok-reload"));
    await tick();
    expect(renders).toEqual([status]);
    // Without this the background serves the snapshot it already holds, and a
    // refresh the user pressed returns the figures they were already looking at.
    expect(reasons).toEqual(["action"]);

    mode = "bad";
    const bad = container.querySelector<HTMLButtonElement>("#bad-reload");
    click(bad);
    await tick();
    // No extra render on failure, and the retry control is re-enabled.
    expect(renders).toEqual([status]);
    expect(bad?.disabled).toBe(false);
  });
});

describe("bindDeploy", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  // The production receipt, so the binder writes into the shape it ships.
  const deployMarkup = `<section class="section">
      <section id="deploy-review-stage">
        <button id="deploy-button" type="button">Deploy</button>
        <div id="deploy-review"></div>
        <p role="status"></p>
      </section>
      ${outcomeReceiptSection("deploy-success")}
    </section>`;

  test("quotes the fee as the screen opens, then submits under it", async () => {
    const container = mount(deployMarkup);
    const calls: unknown[] = [];
    const reviewedFee = { overallFee: "1000000000000000", unit: "FRI" as const };
    const wallet = {
      deployAccount: async (fee?: typeof reviewedFee) => {
        calls.push(fee);
        return fee ? "0xdeploytx" : reviewedFee;
      },
      loadDeploymentStatus: async (): Promise<DeploymentStatusResponse> => ({
        accountId: account.id,
        deployed: true,
        ok: true,
      }),
      loadStatus: async () => status,
    };
    bindDeploy({
      app: container,
      deploymentScope: () => ({ accountId: account.id, stillCurrent: () => true }),
      render: async () => undefined,
      setActiveView: () => undefined,
      wallet: wallet as unknown as ShellBindingDeps["wallet"],
    });

    // The quote is the screen's own first act, so the reader has the figure
    // before pressing rather than as the result of pressing.
    await tick();
    expect(container.querySelector("#deploy-review")?.textContent).toContain("Cost");
    // The quote is a fee line, so the box is "Cost", not "Cost and limits".
    expect(container.querySelector("#deploy-review section")?.getAttribute("aria-label")).toBe(
      "Cost",
    );
    expect(calls).toEqual([undefined]);

    click(container.querySelector("#deploy-button"));
    await tick();
    expect(calls).toEqual([undefined, reviewedFee]);
  });

  // Quotes on a call without a fee and submits HASH under one — the background
  // only submits under a reviewed fee (see deployment-ops) — then reports HASH
  // in the activity log at `chainStatus`.
  const deployingWallet = (chainStatus: ActivityEntry["status"]) => {
    const calls = { deploys: 0, quotes: 0 };
    const wallet = {
      deployAccount: async (fee?: { readonly overallFee: string; readonly unit: "FRI" }) => {
        if (!fee) {
          calls.quotes += 1;
          return { overallFee: "1000000000000000", unit: "FRI" as const };
        }
        calls.deploys += 1;
        return HASH;
      },
      loadActivity: async () => ({
        entries: [
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
    return { calls, wallet: wallet as unknown as ShellBindingDeps["wallet"] };
  };

  // Mounts the screen, lets the quote land, presses Deploy, and lets the
  // confirmation wait reach the chain's answer.
  const deployTo = async (chainStatus: ActivityEntry["status"]) => {
    const container = mount(deployMarkup);
    const { calls, wallet } = deployingWallet(chainStatus);
    const views: string[] = [];
    bindDeploy({
      app: container,
      confirmationDelaysMs: [0],
      render: async () => undefined,
      setActiveView: (view) => {
        views.push(view);
      },
      wallet,
    });
    // The control is busy until the quote lands, so a press can only follow it.
    expect(container.querySelector<HTMLButtonElement>("#deploy-button")?.disabled).toBe(true);
    await tick();
    click(container.querySelector("#deploy-button"));
    await tick();
    await tick();
    await tick();
    return { calls, container, views };
  };

  // Which of the receipt's two sets of actions shows.
  const actionsShown = (container: Element, tone: "failed" | "succeeded"): boolean =>
    container.querySelector(`[data-outcome-actions="${tone}"]`)?.hasAttribute("hidden") === false;

  test("submits a deployment and reports the transaction hash on the status line", async () => {
    const { calls, container } = await deployTo("preconfirmed");

    expect(calls.deploys).toBe(1);
    expect(container.querySelector("#deploy-review-stage")?.hasAttribute("hidden")).toBe(true);
    expect(container.querySelector("#deploy-success")?.hasAttribute("hidden")).toBe(false);
    // Submitted is not deployed: the receipt firms up only once the chain says so.
    expect(container.querySelector("#deploy-success-title")?.textContent).toBe("Account deployed");
    expect(container.querySelector("#deploy-success-description")?.textContent).toContain(
      "can submit transactions",
    );
    expect(container.querySelector("#deploy-success-hash")?.textContent).toBe(accountLabel(HASH));
    expect(container.querySelector('[data-outcome-mark="succeeded"]')?.hasAttribute("hidden")).toBe(
      false,
    );
    expect(container.querySelector('[data-outcome-mark="failed"]')?.hasAttribute("hidden")).toBe(
      true,
    );
    // The toast is the chain's answer; the handoff is the receipt heading's job.
    expect(toastTexts("success")).toEqual(["Transaction pre-confirmed on Starknet"]);
    expect(container.querySelector<HTMLButtonElement>("#deploy-button")?.disabled).toBe(false);
    // A receipt that stands leads with Activity; Try again is for a refusal.
    expect(actionsShown(container, "succeeded")).toBe(true);
    expect(actionsShown(container, "failed")).toBe(false);
  });

  // The chain's two refusals. Each turns the receipt into a failure in place —
  // heading, the chain's reason, mark, tone and toast — and never leaves
  // "Account deployed" over a hash that did not land.
  for (const [chainStatus, reason] of [
    ["rejected", "Starknet rejected this transaction. Nothing changed."],
    [
      "reverted",
      "Starknet reverted this transaction. Review its activity details before retrying.",
    ],
  ] as const) {
    test(`a ${chainStatus} deployment reads as failed, not deployed`, async () => {
      const { calls, container } = await deployTo(chainStatus);
      const receipt = container.querySelector("#deploy-success");

      expect(calls.deploys).toBe(1);
      expect(receipt?.hasAttribute("hidden")).toBe(false);
      expect(container.querySelector("#deploy-success-title")?.textContent).toBe(
        "Deployment failed",
      );
      expect(container.querySelector("#deploy-success-description")?.textContent).toBe(reason);
      // The hash stays: it is how the reader finds out why.
      expect(container.querySelector("#deploy-success-hash")?.textContent).toBe(accountLabel(HASH));
      expect(receipt?.classList.contains("send-failure")).toBe(true);
      expect(receipt?.classList.contains("send-success")).toBe(false);
      expect(receipt?.querySelector('[data-outcome-mark="failed"]')?.hasAttribute("hidden")).toBe(
        false,
      );
      expect(
        receipt?.querySelector('[data-outcome-mark="succeeded"]')?.hasAttribute("hidden"),
      ).toBe(true);
      expect(errorToasts()).toEqual(["Transaction was not confirmed"]);
      expect(toastTexts("success")).toEqual([]);
    });

    test(`a ${chainStatus} deployment leads with Try again`, async () => {
      const { container, views } = await deployTo(chainStatus);
      expect(actionsShown(container, "failed")).toBe(true);
      expect(actionsShown(container, "succeeded")).toBe(false);

      // One primary: the retry. Activity, where the failure is looked up,
      // steps down beside it.
      const [retry, activity] = Array.from(
        container.querySelectorAll('[data-outcome-actions="failed"] button'),
      );
      expect(retry?.textContent).toBe("Try again");
      expect(retry?.classList.contains("secondary")).toBe(false);
      expect(activity?.textContent).toContain("View in Activity tab");
      expect(activity?.classList.contains("secondary")).toBe(true);
      click(activity ?? null);
      expect(views).toEqual(["activity"]);
    });

    test(`Try again after a ${chainStatus} deployment quotes afresh, then deploys`, async () => {
      const { calls, container } = await deployTo(chainStatus);
      const deployButton = container.querySelector<HTMLButtonElement>("#deploy-button");
      click(container.querySelector('[data-outcome-action="retry"]'));

      // Back on the screen it started on, waiting on a new quote rather than
      // offering the refused fee again.
      expect(container.querySelector("#deploy-success")?.hasAttribute("hidden")).toBe(true);
      expect(container.querySelector("#deploy-review-stage")?.hasAttribute("hidden")).toBe(false);
      expect(container.querySelector("#deploy-review")?.textContent).toBe("");
      expect(deployButton?.disabled).toBe(true);
      await tick();
      expect(calls.quotes).toBe(2);
      expect(container.querySelector("#deploy-review")?.textContent).toContain("Cost");
      expect(deployButton?.disabled).toBe(false);

      click(deployButton);
      await tick();
      expect(calls.deploys).toBe(2);
    });
  }

  test("reports a deployment failure on the status line and re-enables the button", async () => {
    const container = mount(deployMarkup);
    const wallet = {
      deployAccount: async () => {
        throw new Error("The deployment was denied.");
      },
    };
    bindDeploy({
      app: container,
      render: async () => undefined,
      setActiveView: () => undefined,
      wallet: wallet as unknown as ShellBindingDeps["wallet"],
    });

    // The quote the screen asked for on its own fails quietly: the reason is on
    // the status line and in the Cost box, and nothing toasts before a press.
    await tick();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "The deployment was denied.",
    );
    expect(errorToasts()).toEqual([]);
    expect(container.querySelector<HTMLButtonElement>("#deploy-button")?.disabled).toBe(false);

    click(container.querySelector("#deploy-button"));
    await tick();

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "The deployment was denied.",
    );
    expect(errorToasts()).toEqual(["The deployment was denied."]);
    expect(container.querySelector<HTMLButtonElement>("#deploy-button")?.disabled).toBe(false);
  });
});

// Keep `preferences` referenced so the shared fixture import is exercised even
// though the hand-built markup does not render preference-derived chrome.
void preferences;
