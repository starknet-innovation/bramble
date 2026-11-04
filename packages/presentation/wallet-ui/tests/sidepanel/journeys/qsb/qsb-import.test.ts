/**
 * The QSB phrase import under happy-dom: all 24 cells show,
 * the submit waits for every word, word membership stays advisory, the phrase
 * is sent once as typed, a refusal keeps the words, and a success or a wipe
 * empties every cell.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { bindQsbImport, qsbImportFlow } from "../../../../src/sidepanel/journeys/qsb/qsb-import-ui";
import { REQUEST_UNKNOWN } from "../../../../src/sidepanel/runtime/friendly-error-copy";
import { registerDom, unregisterDom } from "../../../support/groups-harness";
import {
  flush,
  mountApp,
  QSB_VIEWS,
  type QsbScript,
  qsbStatus,
  scriptedQsbWallet,
  shownStep,
  submitForm,
  TEST_PHRASE,
  typeInto,
} from "../../../support/qsb-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => {
  document.body.replaceChildren();
});

const mount = (script: QsbScript) => {
  const app = mountApp(qsbImportFlow(qsbStatus));
  const form = app.querySelector<HTMLFormElement>("#qsb-import-form");
  if (!form) throw new Error("missing form");
  const { calls, wallet } = scriptedQsbWallet(script);
  let done = 0;
  const session = bindQsbImport({
    done: () => {
      done += 1;
    },
    form,
    wallet,
  });
  const cells = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[data-recovery-kind="import"]'),
  );
  return {
    app,
    calls,
    cells,
    done: () => done,
    form,
    result: () => form.querySelector("#qsb-import-result")?.textContent ?? "",
    session,
    step: () => shownStep(form, "data-qsb-import-step"),
    submit: () => form.querySelector<HTMLButtonElement>("#qsb-import-submit"),
  };
};

const fill = (cells: readonly HTMLInputElement[], words: readonly string[]): void => {
  cells.forEach((cell, index) => {
    typeInto(cell, words[index] ?? "");
  });
};

describe("QSB phrase import", () => {
  test("shows 24 cells and states the read-only consequence before the user commits", () => {
    const h = mount({});
    expect(h.cells).toHaveLength(24);
    expect(h.cells.every((cell) => !cell.hidden)).toBe(true);
    expect(h.app.querySelector('[role="note"]')?.textContent).toBe(
      "An imported phrase can't take new deposits here.",
    );
    expect(h.app.querySelector("#phrase-length-toggle")).toBeNull();
    expect(h.submit()?.disabled).toBe(true);
    expect(h.step()).toBe("entry");
  });

  test("the submit waits for every word; unknown words are advisory only", () => {
    const h = mount({});
    fill(h.cells, TEST_PHRASE.split(" ").slice(0, 23));
    expect(h.submit()?.disabled).toBe(true);
    expect(h.result()).toBe("Enter all 24 words to continue.");
    typeInto(h.cells[23], "zzzz");
    expect(h.submit()?.disabled).toBe(false);
    expect(h.result()).toBe("Highlighted words are not in the BIP39 English list.");
    expect(h.cells[23]?.getAttribute("aria-invalid")).toBe("true");
  });

  test("a pasted 12-word phrase keeps all 24 cells", () => {
    const h = mount({});
    typeInto(h.cells[0], TEST_PHRASE.split(" ").slice(0, 12).join(" "));
    expect(h.cells.every((cell) => !cell.hidden)).toBe(true);
    expect(h.cells[11]?.value).toBe("abandon");
    expect(h.cells[12]?.value).toBe("");
    expect(h.submit()?.disabled).toBe(true);
  });

  test("sends the typed phrase once, then empties every cell and names the new row", async () => {
    const h = mount({ import: { resolve: QSB_VIEWS.readOnly } });
    typeInto(h.cells[0], TEST_PHRASE);
    expect(h.cells.map((cell) => cell.value).join(" ")).toBe(TEST_PHRASE);
    submitForm(h.form);
    await flush();
    expect(h.calls.import).toEqual([TEST_PHRASE]);
    expect(h.step()).toBe("done");
    expect(h.form.querySelector("#qsb-import-done")?.textContent).toBe("Imported as QSB vault 3.");
    expect(h.cells.every((cell) => cell.value === "")).toBe(true);
    h.form.querySelector<HTMLButtonElement>("#qsb-import-finish")?.click();
    expect(h.done()).toBe(1);
  });

  test("a refusal keeps the words to correct, with its reviewed sentence", async () => {
    for (const [refusal, shown] of [
      [
        QSB_ACCOUNT_REFUSALS.notDedicated,
        "This is your Starknet recovery phrase. A QSB vault needs a phrase of its own.",
      ],
      [QSB_ACCOUNT_REFUSALS.duplicatePhrase, "This phrase is already in this wallet."],
      [QSB_ACCOUNT_REFUSALS.invalidPhrase, "That isn't a valid 24-word phrase. Check each word."],
    ] as const) {
      const h = mount({ import: { reject: new Error(refusal) } });
      typeInto(h.cells[0], TEST_PHRASE);
      submitForm(h.form);
      await flush();
      expect(h.step()).toBe("entry");
      expect(h.result()).toBe(shown);
      expect(h.cells.map((cell) => cell.value).join(" ")).toBe(TEST_PHRASE);
      expect(h.submit()?.disabled).toBe(false);
    }
  });

  test("a lost reply says the outcome is unknown", async () => {
    const h = mount({ import: { reject: new SubmissionUnknownError(REQUEST_UNKNOWN, null) } });
    typeInto(h.cells[0], TEST_PHRASE);
    submitForm(h.form);
    await flush();
    expect(h.result()).toBe("Bramble couldn't confirm this finished. Refresh before trying again.");
  });

  test("wipe empties every cell, and an answer after it is dropped", async () => {
    const h = mount({ import: { resolve: QSB_VIEWS.readOnly } });
    typeInto(h.cells[0], TEST_PHRASE);
    submitForm(h.form);
    h.session.wipe();
    await flush();
    expect(h.cells.every((cell) => cell.value === "")).toBe(true);
    expect(h.step()).toBe("entry");
    expect(h.submit()?.disabled).toBe(true);
  });
});
