/**
 * Account-group message checks: the group preference operations round-trip
 * through the background dispatcher, need an extension-page sender, and reject
 * malformed payloads.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@mc-wallet/settings/preferences";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import {
  account,
  contentSender,
  createWallet,
  extensionSender,
} from "../../support/background-wallet-stub";

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

  test("buckets several accounts into a group and keeps membership exclusive", async () => {
    const handler = handlerWithGroups();
    // Distinct, well-formed account ids spanning networks — the bulk editor
    // lists every wallet account regardless of network.
    const ids = ["SN_MAIN:0x1", "SN_MAIN:0x2", "SN_SEPOLIA:0x3"] as const;

    await handler({ icon: "briefcase", name: "Work", type: "wallet.createGroup" }, extensionSender);
    await handler({ icon: "user", name: "Personal", type: "wallet.createGroup" }, extensionSender);

    let latest: unknown;
    for (const accountId of ids) {
      latest = await handler(
        { accountId, groupId: "work", member: true, type: "wallet.setAccountInGroup" },
        extensionSender,
      );
    }
    expect(latest).toMatchObject({
      ok: true,
      preferences: { groups: [{ id: "work", accountIds: [...ids] }, { id: "personal" }] },
    });

    // A no-op re-toggle keeps membership stable (idempotent).
    latest = await handler(
      { accountId: ids[0], groupId: "work", member: true, type: "wallet.setAccountInGroup" },
      extensionSender,
    );
    expect(latest).toMatchObject({
      preferences: {
        groups: [
          { id: "work", accountIds: [...ids] },
          { id: "personal", accountIds: [] },
        ],
      },
    });

    // Filing an account into a second group moves it out of the first — an
    // account belongs to a single folder (exclusive).
    await handler(
      { accountId: ids[0], groupId: "personal", member: true, type: "wallet.setAccountInGroup" },
      extensionSender,
    );
    // Removing the remaining accounts from "work" leaves "personal" intact.
    await handler(
      { accountId: ids[1], groupId: "work", member: false, type: "wallet.setAccountInGroup" },
      extensionSender,
    );
    const removed = await handler(
      { accountId: ids[2], groupId: "work", member: false, type: "wallet.setAccountInGroup" },
      extensionSender,
    );
    expect(removed).toMatchObject({
      ok: true,
      preferences: {
        groups: [
          { id: "work", accountIds: [] },
          { id: "personal", accountIds: [ids[0]] },
        ],
      },
    });
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
