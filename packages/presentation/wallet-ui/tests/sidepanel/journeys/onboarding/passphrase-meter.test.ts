/**
 * The setup passphrase meter follows the typed passphrase: its fill and band
 * come from the strength estimate, its line reports the hint until the
 * confirmation agrees, and it never reads as ready before a valid match.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { applyPassphraseMeter } from "../../../../src/sidepanel/journeys/onboarding/passphrase-meter";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const meterFixture = (): { requirement: HTMLElement; result: HTMLElement } => {
  const requirement = document.createElement("div");
  requirement.className = "password-requirement";
  requirement.innerHTML =
    '<span class="password-requirement-bar"><span></span></span><span data-password-result></span>';
  const result = requirement.querySelector<HTMLElement>("[data-password-result]");
  if (!result) throw new Error("fixture");
  return { requirement, result };
};

describe("applyPassphraseMeter", () => {
  test("steps the band from weak to fair to strong as the passphrase grows", () => {
    const meter = meterFixture();
    applyPassphraseMeter(meter, "short", "");
    expect(meter.requirement.dataset["strength"]).toBe("weak");
    expect(meter.result.textContent).toBe("Enter at least 12 characters");

    applyPassphraseMeter(meter, "correcthorse", "");
    expect(meter.requirement.dataset["strength"]).toBe("fair");
    expect(meter.result.textContent).toContain("Fair");

    applyPassphraseMeter(meter, "correct horse battery staple", "");
    expect(meter.requirement.dataset["strength"]).toBe("strong");
    expect(meter.requirement.style.getPropertyValue("--meter-fill")).toBe("1");
    expect(meter.result.textContent).toBe("Strong passphrase");
    expect(meter.requirement.classList.contains("is-ready")).toBe(false);
  });

  test("is ready only once a valid passphrase is confirmed", () => {
    const meter = meterFixture();
    applyPassphraseMeter(meter, "correct horse battery staple", "correct horse");
    expect(meter.result.textContent).toBe("Passphrases do not match");
    expect(meter.requirement.classList.contains("is-ready")).toBe(false);

    applyPassphraseMeter(meter, "correct horse battery staple", "correct horse battery staple");
    expect(meter.result.textContent).toBe("Strong passphrase · Passphrases match");
    expect(meter.requirement.classList.contains("is-ready")).toBe(true);

    // A short passphrase that "matches" its confirmation is still not ready.
    applyPassphraseMeter(meter, "short", "short");
    expect(meter.requirement.classList.contains("is-ready")).toBe(false);
    expect(meter.requirement.dataset["strength"]).toBe("weak");
  });

  test("clears to empty when the passphrase is erased", () => {
    const meter = meterFixture();
    applyPassphraseMeter(meter, "correcthorse", "");
    applyPassphraseMeter(meter, "", "");
    expect(meter.requirement.dataset["strength"]).toBe("empty");
    expect(meter.requirement.style.getPropertyValue("--meter-fill")).toBe("0");
  });
});
