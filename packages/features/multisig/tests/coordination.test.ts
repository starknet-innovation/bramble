/** Nostr relay checkpoints persist only bounded public receipt metadata. */
import { describe, expect, test } from "bun:test";
import { createNostrCoordinationStore } from "@bramble/multisig/coordination";
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
