/**
 * The QSB backup flow under happy-dom: the vault passphrase
 * is sent once and leaves its field as it is sent, the phrase arrives masked
 * with the shared reveal and guarded copy, "I saved my phrase" empties it
 * before three words are asked at clock-chosen positions, the background's
 * verdict decides, and every field is empty after the flow ends or the screen
 * is wiped — including when a reply lands after the wipe.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import {
  bindQsbBackup,
  type QsbBackupTarget,
  qsbBackupFlow,
} from "../../../../src/sidepanel/journeys/qsb/qsb-backup-ui";
import { qsbCheckPositions } from "../../../../src/sidepanel/journeys/qsb/qsb-model";
import type { QsbWallet } from "../../../../src/sidepanel/journeys/qsb/qsb-runtime";
import { REQUEST_UNKNOWN } from "../../../../src/sidepanel/runtime/friendly-error-copy";
import { resetGuardedCopyClearForTests } from "../../../../src/sidepanel/shared/guarded-copy";
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
  resetGuardedCopyClearForTests();
});

const CLOCK = 1_730_000_000_123;
const confirmed = { ...QSB_VIEWS.backupNeeded, backupConfirmed: true, writer: true };

const mount = (
  script: QsbScript,
  target: QsbBackupTarget = { id: "qsb-1", kind: "account" },
  wallet?: Pick<QsbWallet, "confirmQsbBackup" | "revealQsbPhrase">,
) => {
  const app = mountApp(qsbBackupFlow(qsbStatus));
  const root = app.querySelector<HTMLElement>("#qsb-backup");
  if (!root) throw new Error("missing backup root");
  const scripted = scriptedQsbWallet(script);
  let current = target;
  let done = 0;
  const session = bindQsbBackup({
    done: () => {
      done += 1;
    },
    now: () => CLOCK,
    root,
    target: () => current,
    wallet: wallet ?? scripted.wallet,
  });
  return {
    app,
    calls: scripted.calls,
    done: () => done,
    retarget: (next: QsbBackupTarget) => {
      current = next;
      session.refresh();
    },
    root,
    session,
    step: () => shownStep(root, "data-qsb-step"),
  };
};

const field = (root: ParentNode, selector: string): HTMLInputElement => {
  const input = root.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`missing ${selector}`);
  return input;
};
const passphraseField = (root: ParentNode) => field(root, 'input[name="vaultPassphrase"]');
const cells = (root: ParentNode): HTMLInputElement[] =>
  Array.from(root.querySelectorAll<HTMLInputElement>('input[data-recovery-kind="generated"]'));
const verifyFields = (root: ParentNode): HTMLInputElement[] =>
  Array.from(root.querySelectorAll<HTMLInputElement>('input[name^="qsb-verify-"]'));
const button = (root: ParentNode, selector: string): HTMLButtonElement => {
  const control = root.querySelector<HTMLButtonElement>(selector);
  if (!control) throw new Error(`missing ${selector}`);
  return control;
};
const everyFieldEmpty = (root: ParentNode): boolean =>
  [passphraseField(root), ...cells(root), ...verifyFields(root)].every(
    (input) => input.value === "",
  );

// Reveals the phrase through the passphrase step.
const reveal = async (harness: ReturnType<typeof mount>): Promise<void> => {
  passphraseField(harness.root).value = "correct horse battery";
  submitForm(harness.root.querySelector<HTMLFormElement>("#qsb-reveal-form"));
  await flush();
};

describe("QSB backup", () => {
  test("starts at the passphrase, naming the account", () => {
    const h = mount({});
    expect(h.step()).toBe("passphrase");
    expect(h.root.querySelector("#qsb-backup-account")?.textContent).toBe("QSB vault 1");
    expect(h.app.querySelector("h1")?.textContent).toBe("Back up your phrase");
    expect(h.app.querySelector(".flow-title p")?.textContent).toBe("QSB vault");
    // The QSB screens' word for the password; the rest of the wallet keeps its own.
    expect(passphraseField(h.root).closest("label")?.querySelector("span")?.textContent).toBe(
      "Wallet passphrase",
    );
  });

  test("sends the passphrase once and empties its field as it is sent", async () => {
    const h = mount({ reveal: { resolve: TEST_PHRASE } });
    passphraseField(h.root).value = "correct horse battery";
    submitForm(h.root.querySelector<HTMLFormElement>("#qsb-reveal-form"));
    expect(passphraseField(h.root).value).toBe("");
    await flush();
    expect(h.calls.reveal).toEqual([["qsb-1", "correct horse battery"]]);
    expect(h.step()).toBe("phrase");
  });

  test("the phrase arrives masked; Copy and Continue wait for a deliberate Show", async () => {
    const h = mount({ reveal: { resolve: TEST_PHRASE } });
    await reveal(h);
    const grid = h.root.querySelector<HTMLElement>('[data-recovery-grid="generated"]');
    expect(cells(h.root).map((cell) => cell.value)).toEqual(TEST_PHRASE.split(" "));
    expect(cells(h.root).every((cell) => !cell.hidden)).toBe(true);
    expect(grid?.classList.contains("is-masked")).toBe(true);
    expect(grid?.hasAttribute("inert")).toBe(true);
    expect(grid?.getAttribute("aria-hidden")).toBe("true");
    expect(button(h.root, "#generated-copy-phrase").disabled).toBe(true);
    expect(button(h.root, "#generated-continue").disabled).toBe(true);
    expect(h.root.textContent).toContain(
      "Anyone with these words controls this QSB vault's bitcoin. Bramble cannot recover them for you.",
    );

    expect(button(h.root, "#phrase-toggle").getAttribute("aria-label")).toBe(
      "Show QSB vault phrase",
    );
    expect(button(h.root, "#generated-copy-phrase").getAttribute("aria-label")).toBe(
      "Copy QSB vault phrase",
    );

    button(h.root, "#phrase-toggle").click();
    expect(grid?.classList.contains("is-masked")).toBe(false);
    expect(button(h.root, "#phrase-toggle").getAttribute("aria-label")).toBe(
      "Hide QSB vault phrase",
    );
    expect(button(h.root, "#generated-copy-phrase").disabled).toBe(false);
    expect(button(h.root, "#generated-continue").disabled).toBe(false);
  });

  test("the guarded copy reads the live cells and schedules the clipboard clear", async () => {
    const copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => copied.push(value) },
    });
    const h = mount({ reveal: { resolve: TEST_PHRASE } });
    await reveal(h);
    button(h.root, "#phrase-toggle").click();
    button(h.root, "#generated-copy-phrase").click();
    await flush();
    expect(copied).toEqual([TEST_PHRASE]);
    expect(h.root.querySelector("#qsb-copy-note")?.textContent).toContain(
      "Bramble clears it after about a minute",
    );
  });

  test("I saved my phrase empties the cells, then asks the clock-chosen words", async () => {
    const h = mount({ confirm: { resolve: confirmed }, reveal: { resolve: TEST_PHRASE } });
    await reveal(h);
    button(h.root, "#phrase-toggle").click();
    button(h.root, "#generated-continue").click();
    expect(h.step()).toBe("verify");
    expect(cells(h.root).every((cell) => cell.value === "")).toBe(true);
    const positions = qsbCheckPositions(CLOCK);
    const labels = verifyFields(h.root).map(
      (input) => input.closest("label")?.querySelector("span")?.textContent,
    );
    expect(labels).toEqual(positions.map((position) => `Word ${position}`));

    const submit = button(h.root, '#qsb-verify-form button[type="submit"]');
    expect(submit.disabled).toBe(true);
    const words = TEST_PHRASE.split(" ");
    verifyFields(h.root).forEach((input, index) => {
      typeInto(input, ` ${(words[(positions[index] ?? 1) - 1] ?? "").toUpperCase()} `);
    });
    expect(submit.disabled).toBe(false);
    submitForm(h.root.querySelector<HTMLFormElement>("#qsb-verify-form"));
    await flush();
    expect(h.calls.confirm).toEqual([
      [
        "qsb-1",
        positions.map((position) => ({ index: position - 1, word: words[position - 1] ?? "" })),
      ],
    ]);
    expect(h.step()).toBe("done");
    expect(h.root.textContent).toContain("Backup confirmed.");
    expect(everyFieldEmpty(h.root)).toBe(true);

    button(h.root, "#qsb-backup-done").click();
    expect(h.done()).toBe(1);
  });

  test("a wrong passphrase stays on its step with the reviewed sentence", async () => {
    const h = mount({ reveal: { reject: new Error("Incorrect passphrase") } });
    await reveal(h);
    expect(h.step()).toBe("passphrase");
    expect(h.root.querySelector("#qsb-reveal-result")?.textContent).toBe(
      "That passphrase is wrong.",
    );
    expect(passphraseField(h.root).value).toBe("");
    expect(cells(h.root).every((cell) => cell.value === "")).toBe(true);
  });

  test("a mismatch keeps the words to correct; typing clears the refusal", async () => {
    const h = mount({
      confirm: { reject: new Error(QSB_ACCOUNT_REFUSALS.backupMismatch) },
      reveal: { resolve: TEST_PHRASE },
    });
    await reveal(h);
    button(h.root, "#phrase-toggle").click();
    button(h.root, "#generated-continue").click();
    for (const input of verifyFields(h.root)) typeInto(input, "zoo");
    submitForm(h.root.querySelector<HTMLFormElement>("#qsb-verify-form"));
    await flush();
    const result = h.root.querySelector("#qsb-verify-result");
    expect(h.step()).toBe("verify");
    expect(result?.textContent).toBe(
      "Those words don't match your phrase. Check them and try again.",
    );
    expect(result?.classList.contains("is-invalid")).toBe(true);
    expect(verifyFields(h.root).map((input) => input.value)).toEqual(["zoo", "zoo", "zoo"]);
    typeInto(verifyFields(h.root)[0], "");
    expect(result?.textContent).toBe("Enter the requested words to continue.");
    expect(result?.classList.contains("is-invalid")).toBe(false);
  });

  test("a lost confirmation says the outcome is unknown rather than failed", async () => {
    const h = mount({
      confirm: { reject: new SubmissionUnknownError(REQUEST_UNKNOWN, null) },
      reveal: { resolve: TEST_PHRASE },
    });
    await reveal(h);
    button(h.root, "#phrase-toggle").click();
    button(h.root, "#generated-continue").click();
    for (const input of verifyFields(h.root)) typeInto(input, "abandon");
    submitForm(h.root.querySelector<HTMLFormElement>("#qsb-verify-form"));
    await flush();
    const result = h.root.querySelector("#qsb-verify-result");
    expect(result?.textContent).toBe(
      "Bramble couldn't confirm this finished. Refresh before trying again.",
    );
    // Not styled as a wrong word: the check may already have gone through.
    expect(result?.classList.contains("is-invalid")).toBe(false);
  });

  test("Show phrase again goes back to the passphrase, never to a kept phrase", async () => {
    const h = mount({ reveal: { resolve: TEST_PHRASE } });
    await reveal(h);
    button(h.root, "#phrase-toggle").click();
    button(h.root, "#generated-continue").click();
    typeInto(verifyFields(h.root)[0], "abandon");
    button(h.root, "#qsb-verify-back").click();
    expect(h.step()).toBe("passphrase");
    expect(everyFieldEmpty(h.root)).toBe(true);
  });

  test("wipe empties the phrase, and a reveal answered after it is dropped", async () => {
    const shown = mount({ reveal: { resolve: TEST_PHRASE } });
    await reveal(shown);
    expect(cells(shown.root)[0]?.value).toBe("abandon");
    shown.session.wipe();
    expect(everyFieldEmpty(shown.root)).toBe(true);
    expect(
      shown.root.querySelector('[data-recovery-grid="generated"]')?.classList.contains("is-masked"),
    ).toBe(true);

    let answer: (phrase: string) => void = () => undefined;
    const late = mount(
      {},
      { id: "qsb-1", kind: "account" },
      {
        confirmQsbBackup: () => new Promise(() => undefined),
        revealQsbPhrase: () =>
          new Promise<string>((resolve) => {
            answer = resolve;
          }),
      },
    );
    await reveal(late);
    late.session.wipe();
    answer(TEST_PHRASE);
    await flush();
    expect(late.step()).toBe("passphrase");
    expect(everyFieldEmpty(late.root)).toBe(true);
  });

  test("a check answered after a wipe leaves the emptied words and a disabled submit", async () => {
    const h = mount({ confirm: { resolve: confirmed }, reveal: { resolve: TEST_PHRASE } });
    await reveal(h);
    button(h.root, "#phrase-toggle").click();
    button(h.root, "#generated-continue").click();
    for (const input of verifyFields(h.root)) typeInto(input, "abandon");
    submitForm(h.root.querySelector<HTMLFormElement>("#qsb-verify-form"));
    h.session.wipe();
    await flush();
    expect(h.step()).toBe("verify");
    expect(everyFieldEmpty(h.root)).toBe(true);
    expect(button(h.root, '#qsb-verify-form button[type="submit"]').disabled).toBe(true);
  });

  test("a creation in flight shows progress, then the new account's passphrase", () => {
    const h = mount({}, { kind: "creating" });
    expect(h.step()).toBe("creating");
    expect(h.root.textContent).toContain("Creating QSB vault…");
    h.retarget({ id: "qsb-5", kind: "account" });
    expect(h.step()).toBe("passphrase");
    expect(h.root.querySelector("#qsb-backup-account")?.textContent).toBe("QSB vault 5");
  });

  test("a failed creation or a missing account shows why, with a way to the list", () => {
    const failed = mount({}, { kind: "failed", line: "Couldn't create the QSB vault. Try again." });
    expect(failed.step()).toBe("unavailable");
    expect(failed.root.querySelector("#qsb-backup-error")?.textContent).toBe(
      "Couldn't create the QSB vault. Try again.",
    );
    expect(failed.root.querySelector('[data-view="qsb-accounts"]')?.textContent).toBe(
      "View QSB vaults",
    );
    const none = mount({}, { kind: "none" });
    expect(none.root.querySelector("#qsb-backup-error")?.textContent).toBe(
      "That QSB vault isn't in this wallet.",
    );
    expect(none.calls.reveal).toEqual([]);
  });
});
