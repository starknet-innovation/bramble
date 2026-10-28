/** Nostr relay checkpoints persist only bounded public receipt metadata. */
import { describe, expect, test } from "bun:test";
import {
  createNostrCoordinationStore,
  NOSTR_REMOVED_INTENTS_STORE_KEY,
} from "@bramble/multisig/coordination";
import { createMemoryStore } from "@bramble/store/kv";

const ACCOUNT_ID = "SN_MAIN:0x123";
const RELAY = "wss://relay.team.example";

describe("Nostr coordination receipts", () => {
  test("persists, merges, and relay-scopes bounded sync checkpoints", async () => {
    const storage = createMemoryStore();
    const store = createNostrCoordinationStore({ store: storage });
    const firstEvent = "11".repeat(32);
    const secondEvent = "22".repeat(32);

    await expect(
      store.recordSync({
        accountId: ACCOUNT_ID,
        eventIds: [firstEvent],
        relayUrls: [RELAY],
        syncedAt: 1_000,
      }),
    ).resolves.toBe("stored");
    await createNostrCoordinationStore({ store: storage }).recordSync({
      accountId: ACCOUNT_ID,
      eventIds: [secondEvent],
      relayUrls: [RELAY],
      syncedAt: 2_000,
    });

    await expect(store.getCheckpoint(ACCOUNT_ID, [RELAY])).resolves.toEqual({
      accountId: ACCOUNT_ID,
      eventIds: [secondEvent, firstEvent],
      relayUrls: [RELAY],
      syncedAt: 2_000,
    });
    await expect(
      store.getCheckpoint(ACCOUNT_ID, ["wss://another-relay.example"]),
    ).resolves.toBeNull();
  });

  test("refuses malformed or unauthorized receipt writes", async () => {
    const store = createNostrCoordinationStore({ store: createMemoryStore() });
    await expect(
      store.recordSync(
        {
          accountId: ACCOUNT_ID,
          eventIds: ["invalid"],
          relayUrls: [RELAY],
          syncedAt: 1_000,
        },
        () => true,
      ),
    ).resolves.toBe("invalid");
    await expect(
      store.recordSync(
        {
          accountId: ACCOUNT_ID,
          eventIds: [],
          relayUrls: [RELAY],
          syncedAt: 1_000,
        },
        () => false,
      ),
    ).resolves.toBe("unauthorized");
  });
});

describe("removed intents (Sherlock 168, 237)", () => {
  const intentId = (hash: number) => `${ACCOUNT_ID}:0x${hash.toString(16)}`;

  test("remembers a removal per account, across store instances", async () => {
    const storage = createMemoryStore();
    const store = createNostrCoordinationStore({ store: storage });
    await expect(store.recordRemovedIntent(ACCOUNT_ID, intentId(1))).resolves.toBe("stored");

    const reopened = createNostrCoordinationStore({ store: storage });
    await expect(reopened.isRemovedIntent(ACCOUNT_ID, intentId(1))).resolves.toBe(true);
    await expect(reopened.isRemovedIntent(ACCOUNT_ID, intentId(2))).resolves.toBe(false);
    await expect(reopened.isRemovedIntent("SN_MAIN:0x456", intentId(1))).resolves.toBe(false);
  });

  test("keeps the newest removals when the bound is reached", async () => {
    const store = createNostrCoordinationStore({ store: createMemoryStore() });
    for (let hash = 1; hash <= 101; hash += 1) {
      await store.recordRemovedIntent(ACCOUNT_ID, intentId(hash));
    }
    await expect(store.isRemovedIntent(ACCOUNT_ID, intentId(1))).resolves.toBe(false);
    await expect(store.isRemovedIntent(ACCOUNT_ID, intentId(2))).resolves.toBe(true);
    await expect(store.isRemovedIntent(ACCOUNT_ID, intentId(101))).resolves.toBe(true);
  });

  test("refuses an intent id from another account, malformed ids, and a locked wallet", async () => {
    const store = createNostrCoordinationStore({ store: createMemoryStore() });
    await expect(store.recordRemovedIntent(ACCOUNT_ID, "SN_MAIN:0x456:0x1")).resolves.toBe(
      "invalid",
    );
    await expect(store.recordRemovedIntent(ACCOUNT_ID, `${ACCOUNT_ID}:zz`)).resolves.toBe(
      "invalid",
    );
    await expect(store.recordRemovedIntent("not-an-account", "x")).resolves.toBe("invalid");
    await expect(store.recordRemovedIntent(ACCOUNT_ID, intentId(1), () => false)).resolves.toBe(
      "unauthorized",
    );
    await expect(store.isRemovedIntent(ACCOUNT_ID, intentId(1))).resolves.toBe(false);
  });

  test("ignores malformed stored records", async () => {
    const storage = createMemoryStore();
    await storage.set(NOSTR_REMOVED_INTENTS_STORE_KEY, [
      { accountId: ACCOUNT_ID, intentIds: ["SN_MAIN:0x456:0x1"] },
      { accountId: ACCOUNT_ID, extra: true, intentIds: [intentId(1)] },
    ]);
    const store = createNostrCoordinationStore({ store: storage });
    await expect(store.isRemovedIntent(ACCOUNT_ID, intentId(1))).resolves.toBe(false);
    await store.recordRemovedIntent(ACCOUNT_ID, intentId(2));
    await expect(store.isRemovedIntent(ACCOUNT_ID, intentId(2))).resolves.toBe(true);
  });
});
