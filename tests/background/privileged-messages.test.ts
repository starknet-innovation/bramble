/**
 * Privilege-gate checks prove the wallet message surface is deny-by-default:
 * the dapp-reachable allowlist exactly matches what the provider bridge and
 * content script actually send, and every other wallet message — including
 * ones added later and never registered anywhere — is extension-page only.
 */
import { describe, expect, test } from "bun:test";
import {
  DAPP_MESSAGES,
  isPrivilegedMessage,
  type RuntimeSender,
} from "../../apps/extension/src/background/senders";
import { handleMessage } from "../support/unavailable-handler";

const contentSender: RuntimeSender = { id: "mc-wallet-test", url: "https://dapp.example/app" };

// The two modules through which a page can reach the background at all.
const DAPP_FACING_SOURCES = [
  "packages/foundation/wallet-protocol/src/bridge.ts",
  "apps/extension/src/content/index.ts",
];

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
      "wallet.setStrk20NetworkConfig",
      "wallet.revealSecrets",
      "wallet.unlock",
      "wallet.transfer",
      "wallet.importPreferences",
      // Raw-key import carries a private key in its payload, so it must never be
      // dapp-reachable; pin it explicitly so it can never drift into DAPP_MESSAGES.
      "wallet.importAccount",
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
        { config: null, networkId: "SN_MAIN", type: "wallet.setStrk20NetworkConfig" },
        contentSender,
      ),
    ).resolves.toEqual({ error: "privileged sender required" });
  });

  test("content scripts cannot reach the raw-key import path", async () => {
    // A dapp-origin sender presenting a private key must be turned away at the
    // privilege gate — before any parsing or vault access — so the key-import
    // path is only ever reachable from an extension page.
    const response = await handleMessage(
      {
        networkId: "SN_MAIN",
        privateKey: "0xfeedface",
        type: "wallet.importAccount",
      },
      contentSender,
    );
    expect(response).toEqual({ error: "privileged sender required" });
    // The rejection must not echo the attacker-supplied key anywhere.
    expect(JSON.stringify(response)).not.toContain("feedface");
  });
});
