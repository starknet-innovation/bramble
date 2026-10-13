/**
 * Add-account chooser routing: the five routes (regular, ledger, restore a
 * Ready Ledger account, multisig, import) plus the two-stage import chooser,
 * driven against the shared controller harness without any device or wallet.
 * The two device routes differ only in the EIP-2645 path scheme they read the
 * device at, which must reach enumeration, derivation, and the picker intact.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerEip2645Application } from "@bramble/wallet-model/ledger-path";
import { createLedgerOnboardController } from "../../../../src/sidepanel/journeys/ledger/onboard-session";
import {
  candidateAccount,
  onboardHarness,
  pickerIndexes,
  tick,
} from "../../../support/ledger-onboard-harness";

// Records every (family, scheme) the controller asks the background to derive
// and every scheme it enumerates the device at.
const schemeSpy = () => {
  const derived: [string, LedgerEip2645Application][] = [];
  const enumerated: LedgerEip2645Application[] = [];
  const h = onboardHarness({
    derive: (entries, accountContractType, application) => {
      derived.push([accountContractType, application]);
      return Promise.resolve(
        entries.map((entry) => ({
          ...candidateAccount(entry.accountIndex, accountContractType),
          derivation: {
            ...candidateAccount(entry.accountIndex, accountContractType).derivation,
            eip2645application: application,
          },
        })),
      );
    },
    enumerate: (_client, startIndex, _readiness, application) => {
      enumerated.push(application);
      return Promise.resolve(
        [0, 1].map((offset) => ({
          accountIndex: startIndex + offset,
          publicKeyX: `0x${startIndex + offset + 1}`,
        })),
      );
    },
  });
  return { derived, enumerated, h };
};

describe("add-account chooser routing", () => {
  test("showChooser renders the chooser and a Ledger choice opens connect", () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    expect(h.views.at(-1)).toEqual({ kind: "chooser" });
    controller.choose("ledger");
    expect(h.views.at(-1)?.kind).toBe("connect");
  });

  test("the Ledger route reads Bramble's scheme and derives both families from it", async () => {
    const { derived, enumerated, h } = schemeSpy();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    controller.choose("ledger");
    controller.connect();
    await tick();
    expect(enumerated).toEqual(["LedgerW"]);
    expect(derived.sort()).toEqual([
      ["argent", "LedgerW"],
      ["openzeppelin", "LedgerW"],
    ]);
    const final = h.views.at(-1);
    expect(final?.kind === "picker" && final.application).toBe("LedgerW");
  });

  test("restoring a Ready Ledger account reads Ready's scheme and derives Argent and Braavos", async () => {
    const { derived, enumerated, h } = schemeSpy();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    controller.choose("restore-ready-ledger");
    expect(h.views.at(-1)?.kind).toBe("connect");
    controller.connect();
    await tick();
    expect(enumerated).toEqual(["argentx"]);
    // Ready and Braavos both own their Ledger accounts at `argentx`, so the same
    // device key derives one of each family — the picker probes which is live.
    expect(derived.sort()).toEqual([
      ["argent", "argentx"],
      ["braavos", "argentx"],
    ]);
    const final = h.views.at(-1);
    expect(final?.kind === "picker" && final.application).toBe("argentx");
    expect(pickerIndexes(final, "argent")).toEqual([0, 1]);
    expect(pickerIndexes(final, "braavos")).toEqual([0, 1]);
    expect(pickerIndexes(final, "openzeppelin")).toEqual([]);
    // "Show more" keeps reading the scheme the route chose.
    controller.loadMore();
    await tick();
    expect(enumerated).toEqual(["argentx", "argentx"]);
    expect(derived.every(([, application]) => application === "argentx")).toBe(true);
    expect(pickerIndexes(h.views.at(-1), "argent")).toEqual([0, 1, 2, 3]);
    expect(pickerIndexes(h.views.at(-1), "braavos")).toEqual([0, 1, 2, 3]);
  });

  test("the first-run device setup stays on Bramble's scheme after a Ready restore", async () => {
    const { enumerated, h } = schemeSpy();
    const controller = createLedgerOnboardController(h.deps);
    controller.choose("restore-ready-ledger");
    controller.cancel();
    controller.start();
    controller.connect();
    await tick();
    expect(enumerated).toEqual(["LedgerW"]);
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
    expect(final?.kind === "error" && final.message).toBe(
      "The wallet is locked or unavailable. Unlock it and try again.",
    );
  });
});
