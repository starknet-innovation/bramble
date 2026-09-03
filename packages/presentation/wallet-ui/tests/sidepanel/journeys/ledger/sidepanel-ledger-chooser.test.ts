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
    expect(h.views.at(-1)).toEqual({ kind: "chooser", selected: null });
    controller.choose("ledger");
    expect(h.views.at(-1)?.kind).toBe("connect");
  });

  test("selection requires Continue and routes Multisig without mutating the wallet", () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    controller.select("multisig");
    expect(h.views.at(-1)).toEqual({ kind: "chooser", selected: "multisig" });
    expect(h.multisigs()).toBe(0);
    controller.continueChoice();
    expect(h.views.at(-1)).toBeNull();
    expect(h.multisigs()).toBe(1);
    expect(h.hdAdds()).toBe(0);
  });

  test("choose('import') opens the import chooser; each route dismisses into its flow", () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    controller.select("import");
    expect(h.views.at(-1)).toEqual({ kind: "chooser", selected: "import" });
    controller.continueChoice();
    expect(h.views.at(-1)).toEqual({ kind: "import-chooser", selected: null });

    controller.select("import-key");
    expect(h.views.at(-1)).toEqual({ kind: "import-chooser", selected: "import-key" });
    controller.continueChoice();
    expect(h.views.at(-1)).toBeNull();
    expect(h.imports()).toBe(1);
    expect(h.seedImports()).toBe(0);

    controller.showChooser();
    controller.choose("import");
    controller.select("import-phrase");
    controller.continueChoice();
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
