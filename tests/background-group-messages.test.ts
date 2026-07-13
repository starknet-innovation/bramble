/**
 * Account-group message checks: the group preference operations round-trip
 * through the background dispatcher, need an extension-page sender, and reject
 * malformed payloads.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import { createMemoryStore } from "../src/storage/kv";
import { createPreferencesStore } from "../src/storage/preferences-store";
import {
  account,
  contentSender,
  createWallet,
  extensionSender,
} from "./support/background-wallet-stub";

const handlerWithGroups = () =>
  createMessageHandler(createWallet(), "extension-id", {
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
  });

describe("account group messages", () => {
  test("creates, assigns, edits, and removes groups from an extension page", async () => {
    const handler = handlerWithGroups();

    const created = await handler(
      { icon: "briefcase", name: "Trading", type: "wallet.createGroup" },
      extensionSender,
    );
    expect(created).toMatchObject({
      ok: true,
      preferences: { groups: [{ icon: "briefcase", id: "trading", name: "Trading" }] },
    });

    const assigned = await handler(
      { accountId: account.id, groupId: "trading", member: true, type: "wallet.setAccountInGroup" },
      extensionSender,
    );
    expect(assigned).toMatchObject({
      ok: true,
      preferences: { groups: [{ accountIds: [account.id] }] },
    });

    await handler({ id: "trading", name: "Desk", type: "wallet.renameGroup" }, extensionSender);
    const reIconed = await handler(
      { icon: "rocket", id: "trading", type: "wallet.setGroupIcon" },
      extensionSender,
    );
    expect(reIconed).toMatchObject({
      ok: true,
      preferences: { groups: [{ icon: "rocket", name: "Desk" }] },
    });

    const removed = await handler({ id: "trading", type: "wallet.removeGroup" }, extensionSender);
    expect(removed).toMatchObject({ ok: true, preferences: { groups: [] } });
  });

  test("rejects malformed group requests", async () => {
    const handler = handlerWithGroups();

    await expect(
      handler({ icon: "not-an-icon", name: "X", type: "wallet.createGroup" }, extensionSender),
    ).resolves.toEqual({ error: "invalid group request" });
    await expect(
      handler(
        { accountId: "nope", groupId: "trading", member: true, type: "wallet.setAccountInGroup" },
        extensionSender,
      ),
    ).resolves.toEqual({ error: "invalid group request" });
  });

  test("refuses group mutations from content-script senders", async () => {
    const handler = handlerWithGroups();

    await expect(
      handler({ icon: "folder", name: "Trading", type: "wallet.createGroup" }, contentSender),
    ).resolves.toEqual({ error: "privileged sender required" });
  });
});
