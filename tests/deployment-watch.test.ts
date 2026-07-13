/**
 * Tests for the bounded post-deploy watcher that clears the home "deploy now"
 * banner once a freshly submitted account reports deployed — without any
 * background transaction poller. Exercises the polling loop with a mocked deps
 * double and a zero interval so the attempt budget resolves synchronously.
 */
import { describe, expect, test } from "bun:test";

import type { DeploymentStatusResponse, WalletStatus } from "../src/popup/responses";
import { emptyStatus } from "../src/sidepanel/runtime";
import type { DeploymentWatchDeps } from "../src/sidepanel/shell-bindings";
import { watchDeployment } from "../src/sidepanel/shell-bindings";

const deploymentStatus = (deployed: boolean): DeploymentStatusResponse => ({
  accountId: "account-1",
  deployed,
  ok: true,
});

type Harness = {
  readonly deps: DeploymentWatchDeps;
  readonly renders: WalletStatus[];
  loads: number;
};

// Builds a deps double whose deployment loader is driven by `statuses` (one
// entry consumed per attempt; `null` models a load rejection), recording every
// render so a test can assert how many times the banner would be repainted.
const makeHarness = (statuses: readonly (boolean | null)[]): Harness => {
  const renders: WalletStatus[] = [];
  const harness: Harness = {
    loads: 0,
    renders,
    deps: {
      async render(status: WalletStatus): Promise<void> {
        renders.push(status);
      },
      wallet: {
        async loadDeploymentStatus(): Promise<DeploymentStatusResponse | null> {
          const outcome = statuses[harness.loads] ?? false;
          harness.loads += 1;
          if (outcome === null) {
            throw new Error("deployment status unavailable");
          }
          return deploymentStatus(outcome);
        },
        async loadStatus(): Promise<WalletStatus> {
          return emptyStatus();
        },
      },
    },
  };
  return harness;
};

describe("watchDeployment", () => {
  test("renders exactly once when deployment status flips to deployed", async () => {
    const harness = makeHarness([false, false, true, true]);

    await watchDeployment(harness.deps, { attempts: 12, intervalMs: 0 });

    expect(harness.renders).toHaveLength(1);
    // Stops the moment it observes deployment; later attempts are not spent.
    expect(harness.loads).toBe(3);
  });

  test("stops without rendering when the account never deploys in budget", async () => {
    const harness = makeHarness([false, false, false]);

    await watchDeployment(harness.deps, { attempts: 3, intervalMs: 0 });

    expect(harness.renders).toHaveLength(0);
    expect(harness.loads).toBe(3);
  });

  test("tolerates a deployment status load rejection without throwing or rendering", async () => {
    const harness = makeHarness([null, null]);

    await expect(
      watchDeployment(harness.deps, { attempts: 2, intervalMs: 0 }),
    ).resolves.toBeUndefined();
    expect(harness.renders).toHaveLength(0);
    expect(harness.loads).toBe(2);
  });
});
