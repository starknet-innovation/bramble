/**
 * MCW-V09-126: a wallet.status read that fails must not render the first-run
 * screen.
 *
 * The panel chooses between the first-run journey and the unlock gate on
 * `hasVault`, and the client answered an unreadable status with `hasVault:
 * false` — indistinguishable from a browser that has never held a wallet. A
 * user whose background was momentarily unreachable was therefore invited to
 * set up a new wallet on top of the vault they could not currently see.
 *
 * These pin that a failed read produces an explicit fault state instead: a
 * locked gate that is not ready, and never the onboarding branch.
 */
import { describe, expect, test } from "bun:test";
import { locked } from "../../../src/sidepanel/journeys/onboarding/gate-views";
import { createSidepanelRuntime, emptyStatus } from "../../../src/sidepanel/runtime/runtime";
import { unavailableStatus } from "../../../src/sidepanel/runtime/runtime-status";

const runtimeAnswering = (respond: () => Promise<unknown>) =>
  createSidepanelRuntime({ sendMessage: async () => respond() });

describe("status read failure", () => {
  test("an error envelope does not report an absent vault", async () => {
    const wallet = runtimeAnswering(async () => ({ error: "storage unavailable" }));

    const status = await wallet.loadStatus();

    expect(status).toEqual(unavailableStatus());
    // What the panel branches on to choose the first-run journey.
    expect(status.hasVault).toBe(true);
    expect(status.locked).toBe(true);
    expect(status.ready).toBe(false);
  });

  test("a rejected transport read is a fault, not an absent vault", async () => {
    const wallet = runtimeAnswering(async () => {
      throw new Error("Could not establish connection");
    });

    await expect(wallet.loadStatus()).resolves.toEqual(unavailableStatus());
  });

  test("a genuinely vault-less background still reports no vault", async () => {
    const firstRun = {
      accountCount: 0,
      accounts: [],
      activeAccountId: null,
      hasVault: false,
      locked: true,
      network: "Starknet Mainnet",
      networkId: "SN_MAIN" as const,
      networks: [{ id: "SN_MAIN" as const, name: "Starknet Mainnet" }],
      ready: true,
    };

    const status = await runtimeAnswering(async () => firstRun).loadStatus();

    // Fail-closed must not become fail-useless: a real "no vault" answer still
    // opens the first-run journey.
    expect(status.hasVault).toBe(false);
    expect(status).toEqual(firstRun);
  });

  test("the fault state and the pre-load placeholder are different statuses", () => {
    expect(unavailableStatus().hasVault).not.toBe(emptyStatus().hasVault);
  });

  test("the gate it renders offers unlock with the action disabled", () => {
    const markup = locked(unavailableStatus());

    expect(markup).toContain("Unlock");
    // `ready: false` disables the submit, so the fault screen cannot be
    // mistaken for a working unlock prompt.
    expect(markup).toContain("disabled");
  });
});
