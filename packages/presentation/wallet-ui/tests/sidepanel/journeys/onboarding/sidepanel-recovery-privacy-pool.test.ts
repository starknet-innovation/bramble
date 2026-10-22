/**
 * Privacy-pool gate in the recovery picker: an account another wallet
 * registered with the pool, or one whose registration could not be read, is
 * listed but never selected, and a rescan that blocks a picked row drops it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  brambleAccount,
  click,
  mount,
  reachPicker,
  readyIdleAccount,
  rowsIn,
  tick,
} from "../../../support/recovery-picker-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

describe("recovery picker privacy-pool gate", () => {
  test("refuses an account another wallet registered with the privacy pool", async () => {
    // The pool never replaces a viewing key, so Bramble could never shield or
    // unshield for it: listed, never auto-selected, and not selectable.
    const shielded: DerivedAccountRef = {
      ...readyIdleAccount,
      address: "0xshielded",
      id: "SN_MAIN:0xshielded",
    };
    const app = mount([
      { account: shielded, deployed: true, funded: false, privacyPool: "registered-elsewhere" },
      {
        account: { ...shielded, address: "0xunchecked", id: "SN_MAIN:0xunchecked" },
        deployed: true,
        funded: false,
        privacyPool: "unchecked",
      },
    ]);
    await reachPicker(app);

    const rows = rowsIn(app)("argent");
    expect(rows.map((row) => row.textContent?.includes("· can't be imported"))).toContain(true);
    // A pool that could not be read blocks too, until the search is retried.
    expect(rows.map((row) => row.textContent?.includes("Couldn't check privacy setup"))).toContain(
      true,
    );
    for (const row of rows) {
      const checkbox = row.querySelector<HTMLInputElement>("input[type=checkbox]");
      expect(checkbox?.disabled).toBe(true);
      expect(checkbox?.checked).toBe(false);
    }
    expect(rows.length).toBe(2);
  });

  test("a rescan that blocks a picked account drops the pick", async () => {
    // Picked while the pool answered "not registered", then the retried
    // search could not read the pool: the restore must not carry it.
    const batches: Array<Awaited<ReturnType<SidepanelWallet["discoverRecoveryAccounts"]>>> = [
      {
        candidates: [{ account: brambleAccount, deployed: true, funded: false }],
        complete: true,
        nextIndex: 20,
        ok: true,
      },
      {
        candidates: [
          { account: brambleAccount, deployed: true, funded: false, privacyPool: "unchecked" },
        ],
        complete: true,
        nextIndex: 20,
        ok: true,
      },
    ];
    const app = mount([], () => Promise.resolve(batches.shift() ?? batches[0]) as never);
    await reachPicker(app);
    const restore = app.querySelector<HTMLButtonElement>("#recover-accounts-button");
    expect(restore?.disabled).toBe(false);

    click(app, "#recovery-scan-retry");
    await tick();
    const box =
      rowsIn(app)("openzeppelin")[0]?.querySelector<HTMLInputElement>("input.select-check");
    expect(box?.disabled).toBe(true);
    expect(box?.checked).toBe(false);
    expect(restore?.disabled).toBe(true);
  });
});
