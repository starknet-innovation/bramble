/**
 * The onboarding "Save your recovery phrase" step offers the Reveal screen's
 * guarded copy: locked until the words are deliberately revealed, the same
 * warning beside it, the live words read at click time (never a copy kept in
 * markup), and the same best-effort clear a minute later. A regenerated phrase
 * locks the copy again and copies the new words.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import { bindOnboarding } from "../../../../src/sidepanel/journeys/onboarding/onboarding-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import {
  bindGuardedCopy,
  GUARDED_COPY_CLEAR_MS,
  GUARDED_COPY_NOTE,
  guardedCopyClearIsPending,
  guardedCopyPendingClear,
  resetGuardedCopyClearForTests,
} from "../../../../src/sidepanel/shared/guarded-copy";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

// Positional placeholders stand in for generated words: the step only displays
// and copies what the runtime hands it.
const placeholder = (prefix: string): string =>
  Array.from({ length: 12 }, (_, index) => `${prefix}${index + 1}`).join(" ");
const FIRST = placeholder("w");
const SECOND = placeholder("v");

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

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const click = (app: Element, selector: string): void => {
  const target = app.querySelector<HTMLElement>(selector);
  if (!target) {
    throw new Error(`missing ${selector}`);
  }
  target.click();
};

const copyButton = (app: Element): HTMLButtonElement | null =>
  app.querySelector<HTMLButtonElement>("#generated-copy-phrase");

let copied: string[] = [];
let clears: Array<() => void> = [];
let rejectWrites = false;
// The DOM (and so `window`) only exists once registerDom has run.
let realSetTimeout: typeof window.setTimeout;

beforeEach(() => {
  document.body.replaceChildren();
  copied = [];
  clears = [];
  rejectWrites = false;
  resetGuardedCopyClearForTests();
  realSetTimeout = window.setTimeout;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        if (rejectWrites) {
          throw new Error("denied");
        }
        copied.push(value);
      },
    },
  });
  Object.defineProperty(window, "setTimeout", {
    configurable: true,
    value: (callback: () => void, delay?: number) => {
      // Only intercept the clipboard clear; leave toast and test timers alone.
      if (delay === GUARDED_COPY_CLEAR_MS) {
        clears.push(callback);
        return 0;
      }
      return realSetTimeout(callback, delay);
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, "setTimeout", { configurable: true, value: realSetTimeout });
});

/** Mounts onboarding on the generated-phrase step; each generation yields the next phrase. */
const mountAtGenerated = async (phrases: readonly string[] = [FIRST]): Promise<Element> => {
  const app = document.createElement("div");
  app.replaceChildren(document.createRange().createContextualFragment(onboarding(status)));
  document.body.append(app);
  let call = 0;
  bindOnboarding({
    app,
    render: () => Promise.resolve(),
    wallet: {
      generateMnemonic: () => Promise.resolve(phrases[call++] ?? ""),
      loadStatus: () => Promise.resolve(status),
    } as unknown as SidepanelWallet,
  });
  click(app, "#create-new-button");
  await tick();
  return app;
};

describe("onboarding phrase copy", () => {
  test("is locked until the words are revealed, like I saved my phrase", async () => {
    const app = await mountAtGenerated();
    expect(copyButton(app)?.disabled).toBe(true);
    expect(app.querySelector<HTMLButtonElement>("#generated-continue")?.disabled).toBe(true);

    click(app, "#phrase-toggle");
    expect(copyButton(app)?.disabled).toBe(false);
    expect(app.querySelector<HTMLButtonElement>("#generated-continue")?.disabled).toBe(false);

    // Hiding the words again keeps what the reveal unlocked, as before.
    click(app, "#phrase-toggle");
    expect(copyButton(app)?.disabled).toBe(false);
  });

  test("copies the live words and schedules the same one-minute clear", async () => {
    const app = await mountAtGenerated();
    click(app, "#phrase-toggle");
    click(app, "#generated-copy-phrase");
    await tick();

    expect(copied).toEqual([FIRST]);
    expect(clears).toHaveLength(1);
    clears[0]?.();
    await tick();
    expect(copied).toEqual([FIRST, ""]);
    expect(document.querySelector(".toast.success")?.textContent).toContain(
      "cleared in about a minute",
    );
  });

  test("a regenerated phrase locks the copy again and copies the new words", async () => {
    const app = await mountAtGenerated([FIRST, SECOND]);
    click(app, "#phrase-toggle");
    expect(copyButton(app)?.disabled).toBe(false);

    click(app, '[data-onboarding-step="generated"] [data-onboarding-back]');
    click(app, "#create-new-button");
    await tick();
    expect(copyButton(app)?.disabled).toBe(true);
    expect(app.querySelector("#phrase-toggle")?.textContent).toContain("Show recovery phrase");
    expect(
      app.querySelector('[data-recovery-grid="generated"]')?.classList.contains("is-masked"),
    ).toBe(true);

    click(app, "#phrase-toggle");
    click(app, "#generated-copy-phrase");
    await tick();
    expect(copied).toEqual([SECOND]);
  });

  test("states the consequence once and keeps the words out of the markup", async () => {
    const app = await mountAtGenerated();
    // This screen states what holding the words means, not what the clipboard
    // does; the clipboard note (GUARDED_COPY_NOTE) stays on the Reveal screen,
    // which is where someone copies an existing wallet's phrase.
    const note = app.querySelector("#generated-copy-note")?.textContent;
    expect(note).toBe(
      "Anyone with these words controls the wallet and its funds. Bramble cannot recover them for you.",
    );
    expect(note).not.toBe(GUARDED_COPY_NOTE);
    click(app, "#phrase-toggle");
    const html = copyButton(app)?.outerHTML ?? "";
    expect(html).not.toContain("data-copy");
    expect(html).not.toContain("w1 w2");
    expect(onboarding(status)).not.toContain("data-copy");
  });

  test("holds the completion close until the clipboard clear has run", async () => {
    const app = await mountAtGenerated();
    click(app, "#phrase-toggle");
    click(app, "#generated-copy-phrase");
    await tick();
    expect(guardedCopyClearIsPending()).toBe(true);
    let closed = 0;
    void guardedCopyPendingClear().then(() => {
      closed += 1;
    });
    await tick();
    expect(closed).toBe(0);

    clears[0]?.();
    await tick();
    expect(closed).toBe(1);
    expect(guardedCopyClearIsPending()).toBe(false);
    expect(copied).toEqual([FIRST, ""]);
  });

  test("does not hold the completion close when nothing was copied", async () => {
    let closed = 0;
    void guardedCopyPendingClear().then(() => {
      closed += 1;
    });
    await tick();
    expect(closed).toBe(1);
    expect(guardedCopyClearIsPending()).toBe(false);
  });

  test("reports a clipboard that refuses the write and schedules no clear", async () => {
    const app = await mountAtGenerated();
    click(app, "#phrase-toggle");
    rejectWrites = true;
    click(app, "#generated-copy-phrase");
    await tick();
    await tick();
    expect(copied).toEqual([]);
    expect(clears).toHaveLength(0);
    expect(document.querySelector(".toast.error")?.textContent).toContain("Copy failed");
  });
});

describe("bindGuardedCopy", () => {
  test("refuses empty text without touching the clipboard", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    bindGuardedCopy(button, () => "");
    button.click();
    await tick();
    expect(copied).toEqual([]);
    expect(document.querySelector(".toast.error")?.textContent).toContain("Nothing to copy");
  });

  test("is a no-op for a missing control", () => {
    expect(() => bindGuardedCopy(null, () => FIRST)).not.toThrow();
  });
});
