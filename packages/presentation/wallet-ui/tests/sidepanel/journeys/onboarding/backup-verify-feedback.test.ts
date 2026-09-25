/**
 * The "Confirm your backup" step tells a wrong word apart from an unfinished
 * form. Typing stays quiet, so the last word never flashes an error while it
 * is still being entered. Committing a word — blur, Enter, or the disabled
 * Continue control — says so in the danger tone. Continue stays gated on the
 * unchanged backup check, and only that control's own box can advance.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  BACKUP_VERIFY_COPY,
  backupVerifyPositions,
  DEFAULT_BACKUP_VERIFY_POSITIONS,
} from "../../../../src/sidepanel/journeys/onboarding/backup-verify";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../../../src/sidepanel/journeys/onboarding/onboarding-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { ONBOARDING_STYLES } from "../../../../src/sidepanel/styles/onboarding/styles-onboarding";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

// Positional placeholders stand in for generated words: the step only compares
// what is typed against the words at the requested positions.
const PLACEHOLDER = Array.from({ length: 12 }, (_, index) => `w${index + 1}`).join(" ");
const MATCHING = DEFAULT_BACKUP_VERIFY_POSITIONS.map((position) => `w${position}`);

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: false,
  locked: false,
  network: "Starknet Sepolia",
  networkId: "SN_SEPOLIA",
  networks: [{ id: "SN_SEPOLIA", name: "Starknet Sepolia" }],
  ready: true,
};

const click = (app: Element, selector: string): void => {
  const target = app.querySelector<HTMLElement>(selector);
  if (!target) {
    throw new Error(`missing ${selector}`);
  }
  target.click();
};

const verifyInput = (app: Element, index: number): HTMLInputElement => {
  const input = app.querySelector<HTMLInputElement>(`input[name="verify-${index}"]`);
  if (!input) {
    throw new Error(`missing verify-${index}`);
  }
  return input;
};

/** Types into a field without committing it, as a keystroke does. */
const type = (app: Element, index: number, value: string): void => {
  const input = verifyInput(app, index);
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
};

/** Commits a field's value, as leaving it or pressing Enter does. */
const commit = (app: Element, index: number): void => {
  verifyInput(app, index).dispatchEvent(new window.Event("change", { bubbles: true }));
};

const statusLine = (app: Element): HTMLElement | null => app.querySelector("#verify-result");
const continueDisabled = (app: Element): boolean | undefined =>
  app.querySelector<HTMLButtonElement>("#verify-continue")?.disabled;

/** The visible label of each confirmation field, which is its accessible name. */
const verifyLabels = (app: Element): readonly string[] =>
  [...app.querySelectorAll(".verify-grid label > span:first-child")].map(
    (span) => span.textContent ?? "",
  );

const mountAtVerify = async (now?: () => number): Promise<Element> => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  bindOnboarding({
    app,
    ...(now ? { now } : {}),
    render: () => Promise.resolve(),
    wallet: {
      generateMnemonic: () => Promise.resolve(PLACEHOLDER),
      loadStatus: () => Promise.resolve(status),
    } as unknown as SidepanelWallet,
  });
  click(app, "#create-new-button");
  await new Promise((resolve) => setTimeout(resolve, 0));
  click(app, "#phrase-toggle");
  click(app, "#generated-continue");
  return app;
};

describe("backup verification feedback", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("asks for the clock's positions and names them on the fields", async () => {
    // Two wallets created at different moments are confirmed at different
    // positions, so the three words of the first are not the answer to the
    // second. The label is the field's accessible name, so it has to move with
    // the predicate or the form would ask for one word and check another.
    const reading = 2 + 4 * 2 + 16 * 2;
    const app = await mountAtVerify(() => reading);
    expect(backupVerifyPositions(12, reading)).toEqual([3, 7, 11]);
    expect(verifyLabels(app)).toEqual(["Word 3", "Word 7", "Word 11"]);
    type(app, 0, "w3");
    type(app, 1, "w7");
    type(app, 2, "w11");
    expect(statusLine(app)?.textContent).toBe(BACKUP_VERIFY_COPY.confirmed);
    expect(continueDisabled(app)).toBe(false);
  });

  test("falls back to the default positions with no clock injected", async () => {
    const app = await mountAtVerify();
    expect(verifyLabels(app)).toEqual(
      DEFAULT_BACKUP_VERIFY_POSITIONS.map((position) => `Word ${position}`),
    );
  });

  test("an untouched form asks for the words, in the neutral tone", async () => {
    const app = await mountAtVerify();
    expect(statusLine(app)?.textContent).toBe(BACKUP_VERIFY_COPY.incomplete);
    expect(statusLine(app)?.classList.contains("is-invalid")).toBe(false);
    expect(continueDisabled(app)).toBe(true);
  });

  test("typing a wrong last word stays quiet until the word is committed", async () => {
    const app = await mountAtVerify();
    type(app, 0, MATCHING[0] ?? "");
    type(app, 1, MATCHING[1] ?? "");
    type(app, 2, "wrong");
    expect(statusLine(app)?.textContent).toBe(BACKUP_VERIFY_COPY.incomplete);
    expect(statusLine(app)?.classList.contains("is-invalid")).toBe(false);

    commit(app, 2);
    expect(statusLine(app)?.textContent).toBe(BACKUP_VERIFY_COPY.mismatch);
    expect(statusLine(app)?.classList.contains("is-invalid")).toBe(true);
    expect(continueDisabled(app)).toBe(true);
  });

  test("pressing the disabled Continue reports a mismatch without a field commit", async () => {
    const app = await mountAtVerify();
    type(app, 0, MATCHING[0] ?? "");
    type(app, 1, MATCHING[1] ?? "");
    type(app, 2, "wrong");
    expect(statusLine(app)?.textContent).toBe(BACKUP_VERIFY_COPY.incomplete);
    expect(continueDisabled(app)).toBe(true);
    // A disabled button is not a hit target. The click lands on the step
    // action because the control is taken out of pointer events.
    expect(ONBOARDING_STYLES).toContain("#verify-continue:disabled { pointer-events: none; }");
    expect(ONBOARDING_STYLES).toContain(".verify-continue-hit { display: grid; }");
    app
      .querySelector('[data-onboarding-step="verify"] .verify-continue-hit')
      ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(statusLine(app)?.textContent).toBe(BACKUP_VERIFY_COPY.mismatch);
    expect(statusLine(app)?.classList.contains("is-invalid")).toBe(true);
    expect(continueDisabled(app)).toBe(true);
    expect(app.querySelector('[data-onboarding-step="password"]')?.hasAttribute("hidden")).toBe(
      true,
    );
  });

  test("pressing Enter in the last field reports a mismatch without blurring it", async () => {
    const app = await mountAtVerify();
    type(app, 0, MATCHING[0] ?? "");
    type(app, 1, MATCHING[1] ?? "");
    type(app, 2, "wrong");
    expect(statusLine(app)?.textContent).toBe(BACKUP_VERIFY_COPY.incomplete);
    verifyInput(app, 2).dispatchEvent(
      new window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    expect(statusLine(app)?.textContent).toBe(BACKUP_VERIFY_COPY.mismatch);
    expect(statusLine(app)?.classList.contains("is-invalid")).toBe(true);
    expect(continueDisabled(app)).toBe(true);
    expect(app.querySelector('[data-onboarding-step="password"]')?.hasAttribute("hidden")).toBe(
      true,
    );
  });

  test("a click in the padding above Continue does not leave the step", async () => {
    const app = await mountAtVerify();
    type(app, 0, MATCHING[0] ?? "");
    type(app, 1, MATCHING[1] ?? "");
    type(app, 2, MATCHING[2] ?? "");
    expect(continueDisabled(app)).toBe(false);
    app
      .querySelector('[data-onboarding-step="verify"] .onboarding-step-cta')
      ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(app.querySelector('[data-onboarding-step="password"]')?.hasAttribute("hidden")).toBe(
      true,
    );
    click(app, "#verify-continue");
    expect(app.querySelector('[data-onboarding-step="verify"]')?.hasAttribute("hidden")).toBe(true);
    expect(app.querySelector('[data-onboarding-step="password"]')?.hasAttribute("hidden")).toBe(
      false,
    );
  });

  test("committing an unfinished form never reports a mismatch", async () => {
    const app = await mountAtVerify();
    type(app, 0, "wrong");
    commit(app, 0);
    expect(statusLine(app)?.textContent).toBe(BACKUP_VERIFY_COPY.incomplete);
    expect(statusLine(app)?.classList.contains("is-invalid")).toBe(false);
  });

  test("correcting the word clears the error and unlocks Continue", async () => {
    const app = await mountAtVerify();
    type(app, 0, MATCHING[0] ?? "");
    type(app, 1, MATCHING[1] ?? "");
    type(app, 2, "wrong");
    commit(app, 2);
    expect(statusLine(app)?.classList.contains("is-invalid")).toBe(true);

    type(app, 2, MATCHING[2] ?? "");
    expect(statusLine(app)?.textContent).toBe(BACKUP_VERIFY_COPY.confirmed);
    expect(statusLine(app)?.classList.contains("is-invalid")).toBe(false);
    expect(continueDisabled(app)).toBe(false);
  });
});
