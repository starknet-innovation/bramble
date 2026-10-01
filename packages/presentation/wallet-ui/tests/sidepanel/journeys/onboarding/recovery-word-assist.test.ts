/**
 * Keyboard completion on the recovery import grid (audit #260). Tab and Enter
 * complete a partial word, but never replace a cell that already holds a BIP39
 * word: "act" is a word and a prefix of "action", and turning one into the
 * other restores a different seed or strands the user on a checksum error.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { suggestBip39EnglishWords } from "../../../../src/recovery/bip39-english";
import { bindRecoveryWordAssist } from "../../../../src/sidepanel/journeys/onboarding/recovery-word-assist";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const mount = (): readonly HTMLInputElement[] => {
  const host = document.createElement("form");
  const inputs = [0, 1, 2].map(() => {
    const input = document.createElement("input");
    host.append(input);
    return input;
  });
  document.body.append(host);
  bindRecoveryWordAssist(inputs, host);
  return inputs;
};

/** Types `value` into the cell the way a user does, then presses `key`. */
const press = (
  input: HTMLInputElement,
  value: string,
  key: string,
  shiftKey = false,
): KeyboardEvent => {
  const cell = input;
  cell.focus();
  cell.value = value;
  cell.dispatchEvent(new window.Event("input", { bubbles: true }));
  const event = new window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    shiftKey,
  });
  cell.dispatchEvent(event);
  return event as unknown as KeyboardEvent;
};

const suggestionsShown = (): number =>
  document.querySelectorAll(".recovery-suggestions:not([hidden]) .recovery-suggestion").length;

beforeEach(() => {
  document.body.replaceChildren();
});

describe("recovery word assist keyboard completion", () => {
  test("Tab keeps a complete word that is also a prefix of longer words", () => {
    const [first] = mount();
    if (!first) throw new Error("missing input");
    first.focus();
    first.value = "act";
    first.dispatchEvent(new window.Event("input", { bubbles: true }));
    // The longer words are still offered for a mouse pick.
    expect(suggestionsShown()).toBeGreaterThan(0);
    const event = press(first, "act", "Tab");
    expect(first.value).toBe("act");
    expect(event.defaultPrevented).toBe(false);
  });

  test("Enter keeps a complete word and falls through like a word with no extension", () => {
    const [first] = mount();
    if (!first) throw new Error("missing input");
    const extended = press(first, "act", "Enter");
    expect(first.value).toBe("act");
    expect(extended.defaultPrevented).toBe(false);
    // "zoo" has no longer extension, so it never had a panel: same outcome.
    const plain = press(first, "zoo", "Enter");
    expect(first.value).toBe("zoo");
    expect(plain.defaultPrevented).toBe(false);
  });

  test("Tab still completes a partial word and moves to the next cell", () => {
    const [first, second] = mount();
    if (!first || !second) throw new Error("missing inputs");
    const event = press(first, "acti", "Tab");
    expect(first.value).toBe("action");
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(second);
  });

  test("Shift+Tab never applies a suggestion", () => {
    const [first] = mount();
    if (!first) throw new Error("missing input");
    const event = press(first, "acti", "Tab", true);
    expect(first.value).toBe("acti");
    expect(event.defaultPrevented).toBe(false);
  });

  test("no wordlist word that prefixes another is rewritten by Tab", () => {
    const everyWord = [..."abcdefghijklmnopqrstuvwxyz"].flatMap((letter) =>
      suggestBip39EnglishWords(letter, 2048),
    );
    expect(everyWord).toHaveLength(2048);
    const prefixWords = everyWord.filter((word) =>
      suggestBip39EnglishWords(word, 2).some((match) => match !== word),
    );
    // The audit counted 49; pin the scan actually covers them.
    expect(prefixWords).toContain("act");
    expect(prefixWords.length).toBeGreaterThan(40);
    const [first] = mount();
    if (!first) throw new Error("missing input");
    for (const word of prefixWords) {
      press(first, word, "Tab");
      expect(first.value).toBe(word);
    }
  });
});
