/**
 * Privilege-gate checks prove the wallet message surface is deny-by-default:
 * the dapp-reachable allowlist exactly matches what the provider bridge and
 * content script actually send, and every other wallet message — including
 * ones added later and never registered anywhere — is extension-page only.
 */
import { describe, expect, test } from "bun:test";
import { DAPP_MESSAGES, isPrivilegedMessage, type RuntimeSender } from "../src/background/senders";
import { handleMessage } from "./support/unavailable-handler";

const contentSender: RuntimeSender = { id: "mc-wallet-test", url: "https://dapp.example/app" };

// The two modules through which a page can reach the background at all.
const DAPP_FACING_SOURCES = ["src/provider/bridge.ts", "src/content/index.ts"];

// Broadcast event envelope: sent by the background, never a request into it.
const OUTBOUND_ONLY = new Set(["wallet.event"]);

const walletLiteralsIn = async (path: string): Promise<readonly string[]> => {
  const source = await Bun.file(path).text();
  return [...source.matchAll(/"(wallet\.[a-zA-Z0-9]+)"/g)].map((match) => match[1] ?? "");
};

describe("privileged message gate", () => {
  test("the dapp allowlist exactly matches what the bridge and content script send", async () => {
    const sent = new Set<string>();
    for (const path of DAPP_FACING_SOURCES) {
      for (const literal of await walletLiteralsIn(path)) {
        if (!OUTBOUND_ONLY.has(literal)) {
          sent.add(literal);
        }
      }
    }
    expect([...sent].sort()).toEqual([...DAPP_MESSAGES].sort());
  });

  test("every wallet message outside the allowlist is privileged by default", () => {
    for (const type of DAPP_MESSAGES) {
      expect(isPrivilegedMessage(type)).toBe(false);
    }
    // Known-privileged operations, including the one that once drifted out of
    // the hand-maintained list and became content-script reachable.
    for (const type of [
      "wallet.setStrk20ProverUrl",
      "wallet.revealSecrets",
      "wallet.unlock",
      "wallet.transfer",
      "wallet.importPreferences",
      // Never-registered types must fail closed rather than default open.
      "wallet.someFutureMessage",
    ]) {
      expect(isPrivilegedMessage(type)).toBe(true);
    }
    // Non-wallet noise stays non-privileged so it falls through to the
    // unsupported-message rejection instead of a misleading privilege error.
    expect(isPrivilegedMessage("ping")).toBe(false);
    expect(isPrivilegedMessage(undefined)).toBe(false);
  });

  test("content scripts cannot reach a privileged settings mutation", async () => {
    await expect(
      handleMessage(
        { type: "wallet.setStrk20ProverUrl", url: "https://attacker.example" },
        contentSender,
      ),
    ).resolves.toEqual({ error: "privileged sender required" });
  });
});
