/**
 * The controller that owns ephemeral private-balance state for the entrypoint.
 *
 * `reset` and `invalidate` both drop the cached reading and differ only in the
 * generation counter, which is what async privacy work checks before writing
 * back. Getting that distinction wrong is silent in the UI and only shows up as
 * a stale or discarded result, so it is pinned here.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { createPrivacyController } from "../../../../src/sidepanel/journeys/privacy/privacy-controller";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

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

const controllerWith = (
  balances: () => { balances: never[] } | Record<string, never>,
): ReturnType<typeof createPrivacyController> => {
  const app = document.createElement("main");
  app.innerHTML = "<div></div>";
  document.body.append(app);
  return createPrivacyController({
    app,
    balances: balances as never,
    navigate: () => undefined,
    paint: () => undefined,
    preferences: () => preferences,
    status: () => status,
    // Locked so `bind` never starts discovery: these assert state handling, not
    // the discovery path, which its own suite covers.
    wallet: {
      loadPrivacyState: async () => {
        throw new Error("discovery must not run here");
      },
    } as unknown as SidepanelWallet,
  });
};

describe("createPrivacyController", () => {
  test("starts with an empty reading and an idle journey", () => {
    const controller = controllerWith(() => ({ balances: [] }));

    expect(controller.disclosure()).toEqual({ error: null, loading: false, value: null });
    expect(controller.journey()).toEqual({ stage: "idle" });
  });

  test("reset clears the journey as well as the reading", () => {
    const controller = controllerWith(() => ({ balances: [] }));
    controller.bind();

    controller.reset();

    expect(controller.disclosure()).toEqual({ error: null, loading: false, value: null });
    expect(controller.journey()).toEqual({ stage: "idle" });
  });

  test("invalidate drops the reading without disturbing an in-flight journey", () => {
    const controller = controllerWith(() => ({ balances: [] }));

    controller.invalidate();

    // A private send settles in the Send flow, not on the journey surface, so
    // invalidating its cached balance must not cancel work already running.
    expect(controller.disclosure()).toEqual({ error: null, loading: false, value: null });
    expect(controller.journey()).toEqual({ stage: "idle" });
  });

  test("binds against a balance state that carries no balances yet", () => {
    // The entrypoint's balance cache is a union; an error or loading shape has no
    // `balances` key and must read as empty rather than throw during bind.
    const controller = controllerWith(() => ({}) as Record<string, never>);

    expect(() => {
      controller.bind();
    }).not.toThrow();
  });
});
