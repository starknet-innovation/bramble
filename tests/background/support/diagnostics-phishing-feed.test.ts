/**
 * Support diagnostics carry the live phishing feed's health (issue 772), so a
 * source that quietly stops answering shows up in an exported report.
 */
import { describe, expect, test } from "bun:test";
import type { PhishingFeedHealth } from "@bramble/permissions/phishing-feed";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createWallet, extensionSender, testExtension } from "../../support/background-wallet-stub";

const health: PhishingFeedHealth = {
  ageHours: 30,
  cacheWriteFailed: false,
  consecutiveFailures: 5,
  domains: 109_652,
  stale: true,
};

const diagnostics = async (phishingFeedHealth?: () => PhishingFeedHealth) => {
  const handler = createMessageHandler(
    createWallet(),
    testExtension,
    phishingFeedHealth ? { phishingFeedHealth } : {},
  );
  return (await handler({ type: "wallet.diagnostics" }, extensionSender)) as {
    readonly diagnostics: { readonly phishingFeed: PhishingFeedHealth | null };
  };
};

describe("support diagnostics: phishing feed", () => {
  test("reports the running feed's health", async () => {
    expect((await diagnostics(() => health)).diagnostics.phishingFeed).toEqual(health);
  });

  test("reports null when no feed is running", async () => {
    expect((await diagnostics()).diagnostics.phishingFeed).toBeNull();
  });
});
