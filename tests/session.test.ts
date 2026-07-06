/**
 * Unlock session checks prove passphrases expire from background memory.
 */
import { describe, expect, test } from "bun:test";
import { createUnlockSession } from "../src/background/session";

describe("createUnlockSession", () => {
  test("expires passphrases", () => {
    let now = 1_000;
    const session = createUnlockSession(100, () => now);

    session.unlock("correct horse battery staple");
    expect(session.getPassphrase()).toBe("correct horse battery staple");

    now = 1_101;
    expect(session.getPassphrase()).toBeNull();
    expect(session.isUnlocked()).toBe(false);
  });

  test("rejects unsafe passphrases", () => {
    const session = createUnlockSession();
    session.unlock("correct horse battery staple");

    expect(() => session.unlock("too short")).toThrow("Invalid unlock session passphrase");
    expect(session.getPassphrase()).toBe("correct horse battery staple");
  });

  test("rejects unsafe ttl values", () => {
    expect(() => createUnlockSession(0)).toThrow("Invalid unlock session ttl");
    expect(() => createUnlockSession(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "Invalid unlock session ttl",
    );
    expect(() => createUnlockSession(5 * 60 * 1000 + 1)).toThrow("Invalid unlock session ttl");
  });
});
