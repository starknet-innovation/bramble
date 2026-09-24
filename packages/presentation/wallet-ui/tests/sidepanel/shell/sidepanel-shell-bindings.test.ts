/**
 * Behavioural coverage for the dashboard chrome bindings under happy-dom:
 * bindDashboard (lock control + reload-balances retry), bindDeploy (the account
 * deployment action and its post-submit watch kick-off), and the bindPickers
 * network-switch and error branches not exercised by
 * tests/sidepanel/sidepanel-account-select.test.ts. Each binding is driven against a
 * recording fake wallet with a minimal hand-built DOM carrying exactly the
 * ids/attributes the binders query, then real clicks are dispatched and both the
 * wallet call and the resulting DOM/toast feedback are asserted. Mirrors the
 * registerDom harness used by the account-select and deployment-watch suites.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import type {
  DeploymentStatusResponse,
  WalletStatus,
} from "../../../src/popup/responses/responses";
import type { WalletView } from "../../../src/sidepanel/app/screens/views";
import {
  bindDashboard,
  bindDeploy,
  bindPickers,
  type ShellBindingDeps,
} from "../../../src/sidepanel/shell/shell-bindings";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

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

const errorToasts = (): string[] =>
  Array.from(document.querySelectorAll(".toast.error .toast-text")).map(
    (node) => node.textContent ?? "",
  );

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
        throw new Error("boom lock");
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
    expect(container.querySelector("#panel-result")?.textContent).toBe("boom lock");
    expect(errorToasts()).toContain("boom lock");
    // The lock button is re-enabled so the user can retry.
    expect(lockButton?.disabled).toBe(false);
  });

  test("reload-balances controls reload status; a failed reload re-enables the button", async () => {
    const container = mount(
      `<button id="ok-reload" data-reload-balances type="button"></button>
       <button id="bad-reload" data-reload-balances type="button"></button>`,
    );
    const renders: WalletStatus[] = [];
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
      render: async (next) => {
        renders.push(next);
      },
      setActiveView: () => undefined,
      wallet: wallet as unknown as ShellBindingDeps["wallet"],
    });

    click(container.querySelector("#ok-reload"));
    await tick();
    expect(renders).toEqual([status]);

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

  const deployMarkup = `<section class="section">
      <section id="deploy-review-stage">
        <button id="deploy-button" type="button">Review deployment</button>
        <div id="deploy-review"></div>
        <p role="status"></p>
      </section>
      <section id="deploy-success" hidden><code id="deploy-hash"></code></section>
    </section>`;

  test("shows the decision anatomy before echoing the reviewed deployment fee", async () => {
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

    click(container.querySelector("#deploy-button"));
    await tick();
    expect(container.querySelector("#deploy-review")?.textContent).toContain("Cost");

    click(container.querySelector("#deploy-button"));
    await tick();
    expect(calls).toEqual([undefined, reviewedFee]);
  });

  test("submits a deployment and reports the transaction hash on the status line", async () => {
    const container = mount(deployMarkup);
    let deploys = 0;
    const wallet = {
      deployAccount: async () => {
        deploys += 1;
        return "0xdeploytx";
      },
    };
    bindDeploy({
      app: container,
      render: async () => undefined,
      setActiveView: () => undefined,
      wallet: wallet as unknown as ShellBindingDeps["wallet"],
    });

    click(container.querySelector("#deploy-button"));
    await tick();

    expect(deploys).toBe(1);
    expect(container.querySelector("#deploy-review-stage")?.hasAttribute("hidden")).toBe(true);
    expect(container.querySelector("#deploy-success")?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector("#deploy-hash")?.textContent).toBe("0xdeploytx");
    expect(document.querySelectorAll(".toast.success").length).toBeGreaterThan(0);
    expect(container.querySelector<HTMLButtonElement>("#deploy-button")?.disabled).toBe(false);
  });

  test("reports a deployment failure on the status line and re-enables the button", async () => {
    const container = mount(deployMarkup);
    const wallet = {
      deployAccount: async () => {
        throw new Error("deploy denied");
      },
    };
    bindDeploy({
      app: container,
      render: async () => undefined,
      setActiveView: () => undefined,
      wallet: wallet as unknown as ShellBindingDeps["wallet"],
    });

    click(container.querySelector("#deploy-button"));
    await tick();

    expect(container.querySelector('[role="status"]')?.textContent).toBe("deploy denied");
    expect(errorToasts()).toContain("deploy denied");
    expect(container.querySelector<HTMLButtonElement>("#deploy-button")?.disabled).toBe(false);
  });
});

describe("bindPickers", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  const pickerMarkup = `
    <button data-network-id="SN_SEPOLIA" aria-pressed="false" type="button">Sepolia</button>
    <button data-network-id="SN_MAIN" aria-pressed="true" type="button">Mainnet</button>
    <button data-account-id="${secondAccount.id}" aria-pressed="false" type="button">acct</button>
    <p id="picker-result" role="status"></p>`;

  const makeDeps = (
    container: HTMLElement,
    wallet: Partial<Record<string, unknown>>,
    sinks: { renders: WalletStatus[]; views: WalletView[] },
  ): ShellBindingDeps => ({
    app: container,
    render: async (next) => {
      sinks.renders.push(next);
    },
    setActiveView: (view) => {
      sinks.views.push(view);
    },
    wallet: wallet as unknown as ShellBindingDeps["wallet"],
  });

  test("ignores a non-button carrying the network, and everything inside it", async () => {
    // The Send form carries its own network for the explorer link. Binding on
    // the attribute alone made every click inside it switch network and leave
    // for settings, because the click bubbled to the form.
    const container = mount(`
      <form data-network-id="SN_SEPOLIA">
        <button id="inner" type="button">Choose a recipient</button>
      </form>
      <p id="picker-result" role="status"></p>`);
    const sinks = { renders: [] as WalletStatus[], views: [] as WalletView[] };
    const seen: string[] = [];
    bindPickers(
      makeDeps(
        container,
        {
          setActiveNetwork: async (id: string) => {
            seen.push(id);
            return status;
          },
        },
        sinks,
      ),
    );

    click(container.querySelector("#inner"));
    await tick();
    click(container.querySelector("form"));
    await tick();

    expect(seen).toEqual([]);
    expect(sinks.views).toEqual([]);
  });

  test("switches the network, returns to settings, and re-renders", async () => {
    const container = mount(pickerMarkup);
    const sinks = { renders: [] as WalletStatus[], views: [] as WalletView[] };
    const seen: string[] = [];
    bindPickers(
      makeDeps(
        container,
        {
          setActiveNetwork: async (id: string) => {
            seen.push(id);
            return status;
          },
        },
        sinks,
      ),
    );

    click(container.querySelector('[data-network-id="SN_SEPOLIA"]'));
    await tick();

    expect(seen).toEqual(["SN_SEPOLIA"]);
    expect(sinks.views).toEqual(["settings"]);
    expect(sinks.renders).toEqual([status]);
  });

  test("tapping the already-active network is a no-op", async () => {
    const container = mount(pickerMarkup);
    const sinks = { renders: [] as WalletStatus[], views: [] as WalletView[] };
    let called = 0;
    bindPickers(
      makeDeps(
        container,
        {
          setActiveNetwork: async () => {
            called += 1;
            return status;
          },
        },
        sinks,
      ),
    );

    click(container.querySelector('[data-network-id="SN_MAIN"]'));
    await tick();

    expect(called).toBe(0);
    expect(sinks.views).toEqual([]);
    expect(sinks.renders).toEqual([]);
  });

  test("reports a network switch failure on the picker result line", async () => {
    const container = mount(pickerMarkup);
    const sinks = { renders: [] as WalletStatus[], views: [] as WalletView[] };
    const button = container.querySelector<HTMLButtonElement>('[data-network-id="SN_SEPOLIA"]');
    bindPickers(
      makeDeps(
        container,
        {
          setActiveNetwork: async () => {
            throw new Error("switch failed");
          },
        },
        sinks,
      ),
    );

    click(button);
    await tick();

    expect(sinks.views).toEqual([]);
    expect(container.querySelector("#picker-result")?.textContent).toBe("switch failed");
    expect(errorToasts()).toContain("switch failed");
    expect(button?.disabled).toBe(false);
  });

  test("reports an account switch failure on the picker result line", async () => {
    const container = mount(pickerMarkup);
    const sinks = { renders: [] as WalletStatus[], views: [] as WalletView[] };
    const button = container.querySelector<HTMLButtonElement>(
      `[data-account-id="${secondAccount.id}"]`,
    );
    bindPickers(
      makeDeps(
        container,
        {
          loadStatus: async () => status,
          setActiveAccount: async () => {
            throw new Error("account switch failed");
          },
        },
        sinks,
      ),
    );

    click(button);
    await tick();

    expect(sinks.views).toEqual([]);
    expect(container.querySelector("#picker-result")?.textContent).toBe("account switch failed");
    expect(errorToasts()).toContain("account switch failed");
    expect(button?.disabled).toBe(false);
  });
});

// Keep `preferences` referenced so the shared fixture import is exercised even
// though the hand-built markup does not render preference-derived chrome.
void preferences;
