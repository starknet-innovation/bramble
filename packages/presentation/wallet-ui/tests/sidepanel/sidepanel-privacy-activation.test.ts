/**
 * Deploy-then-register sequencing. Starknet cannot batch a DEPLOY_ACCOUNT with
 * an invoke, so a fresh account's activation is two transactions run in order
 * behind one control: the registration journey must start only once the account
 * reports deployed, and never before the deployment is submitted.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { bindDeployAndRegister } from "../../src/sidepanel/privacy-activation-ui";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const originalSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  document.body.replaceChildren();
  // The deployment poll waits five seconds between attempts; run it inline.
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout;
});

afterEach(() => {
  (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
});

const flush = (): Promise<void> => new Promise((resolve) => originalSetTimeout(resolve, 0));

const mount = (): HTMLElement => {
  const app = document.createElement("main");
  app.innerHTML =
    '<button data-privacy-deploy-register="" type="button">Deploy and register</button>';
  document.body.append(app);
  return app;
};

const bind = (
  app: HTMLElement,
  wallet: Partial<SidepanelWallet>,
  stillCurrent: () => boolean = () => true,
): { readonly started: number[] } => {
  const started: number[] = [];
  bindDeployAndRegister({
    app,
    deploymentScope: () => ({ accountId: "SN_MAIN:0x1", stillCurrent }),
    startRegistration: () => started.push(1),
    wallet: wallet as SidepanelWallet,
  });
  return { started };
};

describe("deploy then register", () => {
  test("registers only after the deployment reports deployed", async () => {
    const calls: string[] = [];
    let deployed = false;
    const app = mount();
    const { started } = bind(app, {
      async deployAccount() {
        calls.push("deploy");
        // The account goes live between the submit and the first poll.
        deployed = true;
        return "0xdeadbeef";
      },
      async loadDeploymentStatus() {
        calls.push("status");
        return { accountId: "SN_MAIN:0x1", deployed, ok: true } as const;
      },
    });

    app.querySelector<HTMLButtonElement>("[data-privacy-deploy-register]")?.click();
    await flush();

    // Order is load-bearing: a registration invoke sent before the account
    // exists cannot succeed.
    expect(calls[0]).toBe("deploy");
    expect(calls).toContain("status");
    expect(started).toEqual([1]);
  });

  test("does not register when the deployment has not landed in time", async () => {
    const app = mount();
    const { started } = bind(app, {
      async deployAccount() {
        return "0xdeadbeef";
      },
      // Never deployed within the attempt budget.
      async loadDeploymentStatus() {
        return { accountId: "SN_MAIN:0x1", deployed: false, ok: true } as const;
      },
    });

    app.querySelector<HTMLButtonElement>("[data-privacy-deploy-register]")?.click();
    await flush();

    expect(started).toEqual([]);
    // The control is usable again rather than stuck busy.
    expect(app.querySelector<HTMLButtonElement>("[data-privacy-deploy-register]")?.disabled).toBe(
      false,
    );
  });

  test("a failed deployment neither registers nor leaves the control busy", async () => {
    const app = mount();
    let polled = 0;
    const { started } = bind(app, {
      async deployAccount() {
        throw new Error("insufficient balance");
      },
      async loadDeploymentStatus() {
        polled += 1;
        return { accountId: "SN_MAIN:0x1", deployed: true, ok: true } as const;
      },
    });

    app.querySelector<HTMLButtonElement>("[data-privacy-deploy-register]")?.click();
    await flush();

    expect(started).toEqual([]);
    // Nothing is polled when there is no submitted deployment to wait for.
    expect(polled).toBe(0);
    expect(app.querySelector<HTMLButtonElement>("[data-privacy-deploy-register]")?.disabled).toBe(
      false,
    );
  });

  test("does not continue registration after the active account changes", async () => {
    let current = true;
    const app = mount();
    const { started } = bind(
      app,
      {
        async deployAccount() {
          current = false;
          return "0xdeadbeef";
        },
        async loadDeploymentStatus() {
          return { accountId: "SN_MAIN:0x2", deployed: true, ok: true } as const;
        },
      },
      () => current,
    );

    app.querySelector<HTMLButtonElement>("[data-privacy-deploy-register]")?.click();
    await flush();

    expect(started).toEqual([]);
  });
});
