/**
 * The Sepolia verification run (tools/vendor-dataset/verify-sepolia*.ts) types
 * real seeds and keys, some of them derived during the run. No seed, phrase or
 * derived private key may reach the console, a top-level failure, or the
 * scorecard (PR 855 review). Sentinel values only: nothing here reads the
 * seed file or touches a network.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { guarded, redact, secret } from "../../tools/vendor-dataset/sepolia-redact";

const PHRASE = "sentinel alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo";
// Stands in for a key the run derives (readyKeypair(...).priv): leading zeros on purpose.
const DERIVED = `0x00${"5e".repeat(30)}`;
const DIGITS = BigInt(DERIVED).toString(16);

secret(PHRASE);
secret(DERIVED);

const leaks = (text: string): boolean =>
  text.includes(PHRASE) ||
  text.toLowerCase().includes(DIGITS) ||
  text.includes(BigInt(DERIVED).toString(10)) ||
  /alpha\W+bravo/.test(text);

describe("sepolia redactor", () => {
  test("a thrown error carrying a registered phrase is redacted, reflowed or partial", () => {
    for (const message of [
      `fill("${PHRASE}") failed`,
      `words: ${PHRASE.split(" ").join(", ")}`,
      `words: ${PHRASE.split(" ").join("\n")}`,
      `typed "alpha bravo charlie…" then timed out`,
    ]) {
      const out = redact(String(new Error(message)));
      expect(out).toContain("[redacted]");
      expect(leaks(out)).toBe(false);
    }
  });

  test("a derived key is redacted in every spelling", () => {
    for (const form of [
      DERIVED,
      `0x${DIGITS}`,
      DIGITS.toUpperCase(),
      `0X${DIGITS.toUpperCase()}`,
      BigInt(DERIVED).toString(10),
    ]) {
      const out = redact(String(new Error(`bad key ${form} for TA-06`)));
      expect(out).toBe("Error: bad key [redacted] for TA-06");
    }
  });

  test("text with no secret passes through unchanged", () => {
    expect(redact("Found your account. 0x1234 view only")).toBe(
      "Found your account. 0x1234 view only",
    );
  });

  test("a top-level failure prints no secret and reports failure, so the runner exits non-zero", async () => {
    const printed: string[] = [];
    const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    });
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    let ok = true;
    try {
      ok = await guarded(async () => {
        throw new Error(`onboarding failed for ${PHRASE} with key ${DERIVED}`);
      });
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
    expect(ok).toBe(false);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("verification failed");
    expect(leaks(printed.join("\n"))).toBe(false);
  });

  test("a run that succeeds reports success", async () => {
    expect(await guarded(async () => undefined)).toBe(true);
  });
});
