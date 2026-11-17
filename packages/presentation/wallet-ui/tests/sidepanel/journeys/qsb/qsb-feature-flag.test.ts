/**
 * Every QSB vault entry point carries the `qsb.vaults` feature flag, so the
 * side panel's feature gate can keep it hidden until the flag is on. This is
 * markup only: nothing here reads a flag.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { preferences } from "@bramble/testkit/sidepanel";
import {
  addAccountChooser,
  importAccountChooser,
} from "../../../../src/sidepanel/journeys/ledger/onboard-views";
import { QSB_FEATURE_FLAG } from "../../../../src/sidepanel/journeys/qsb/qsb-model";
import { accountDrawer } from "../../../../src/sidepanel/shell/account-drawer";
import { acctA, registerDom, status, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const parse = (markup: string): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return root;
};

describe("the qsb.vaults flag on QSB entry points", () => {
  test("is the bramble-ff key", () => {
    expect(QSB_FEATURE_FLAG).toBe("qsb.vaults");
  });

  test("marks the drawer's QSB vaults row, and nothing else in the drawer", () => {
    const drawer = parse(accountDrawer(status, acctA, preferences));
    const gated = [...drawer.querySelectorAll<HTMLElement>("[data-feature]")];
    expect(gated.map((element) => [element.dataset["feature"], element.dataset["view"]])).toEqual([
      ["qsb.vaults", "qsb-accounts"],
    ]);
  });

  test("marks only the QSB choices in the add-account chooser", () => {
    const chooser = parse(addAccountChooser());
    const kinds = (selector: string) =>
      [...chooser.querySelectorAll<HTMLElement>(selector)].map((el) => el.dataset["addKind"]);
    expect(kinds('[data-feature="qsb.vaults"]')).toEqual(["qsb-create"]);
    expect(kinds("[data-add-kind]:not([data-feature])")).not.toContain("qsb-create");
  });

  test("marks only the QSB phrase choice in the import chooser", () => {
    const chooser = parse(importAccountChooser());
    const gated = [...chooser.querySelectorAll<HTMLElement>('[data-feature="qsb.vaults"]')];
    expect(gated.map((element) => element.dataset["addKind"])).toEqual(["qsb-import"]);
  });
});
