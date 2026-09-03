/**
 * Add-account chooser routing: the four routes (regular, ledger, multisig,
 * import) plus the two-stage import chooser, driven against the shared
 * controller harness without any device or wallet.
 */
import { describe, expect, test } from "bun:test";
import { createLedgerOnboardController } from "../../../../src/sidepanel/journeys/ledger/onboard-session";
import { onboardHarness, tick } from "../../../support/ledger-onboard-harness";

describe("add-account chooser routing", () => {
  test("showChooser renders the chooser and a Ledger choice opens connect", () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    expect(h.views.at(-1)).toEqual({ kind: "chooser" });
    controller.choose("ledger");
    expect(h.views.at(-1)?.kind).toBe("connect");
  });

  test("one click routes Multisig without mutating the wallet", () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    expect(h.multisigs()).toBe(0);
    controller.choose("multisig");
    expect(h.views.at(-1)).toBeNull();
    expect(h.multisigs()).toBe(1);
    expect(h.hdAdds()).toBe(0);
  });

  test("choose('import') opens the import chooser; each route dismisses into its flow", () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    controller.choose("import");
    expect(h.views.at(-1)).toEqual({ kind: "import-chooser" });

    controller.choose("import-key");
    expect(h.views.at(-1)).toBeNull();
    expect(h.imports()).toBe(1);
    expect(h.seedImports()).toBe(0);

    controller.showChooser();
    controller.choose("import");
    controller.choose("import-phrase");
    expect(h.views.at(-1)).toBeNull();
    expect(h.seedImports()).toBe(1);
  });

  test("a regular-account choice derives an HD account, dismisses, and refreshes", async () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    controller.choose("regular");
    await tick();
    expect(h.hdAdds()).toBe(1);
    expect(h.views.at(-1)).toBeNull();
    expect(h.refreshed()).toBe(1);
  });

  test("a regular-account choice surfaces the wallet error when derivation fails", async () => {
    const h = onboardHarness({ addHd: () => Promise.reject(new Error("wallet locked")) });
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    controller.choose("regular");
    await tick();
    const final = h.views.at(-1);
    expect(final?.kind === "error" && final.message).toBe("wallet locked");
  });
});
