/** Durable NFT snapshots remain validated, scoped, and removable after mutations. */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@mc-wallet/store/kv";
import {
  createNftSnapshotStore,
  NFT_SNAPSHOTS_KEY,
} from "../../../apps/extension/src/background/portfolio/nft-snapshots";

const nft = {
  collection: "Punks",
  contract: "0x123",
  id: "SN_MAIN:0x123:1",
  image: "",
  name: "Punk #1",
  networkId: "SN_MAIN" as const,
  tokenId: "1",
};

describe("NFT snapshots", () => {
  test("persists lanes by account and clears every lane after an ownership mutation", async () => {
    const storage = createMemoryStore();
    const snapshots = createNftSnapshotStore(storage);
    await snapshots.write({
      accountId: "SN_MAIN:0x1",
      checkedAt: 42,
      fetchedAt: 42,
      lane: "indexed",
      networkId: "SN_MAIN",
      nfts: [nft],
    });

    expect(await createNftSnapshotStore(storage).read("SN_MAIN:0x1", "SN_MAIN", "indexed")).toEqual(
      { checkedAt: 42, fetchedAt: 42, nfts: [nft] },
    );
    expect(await snapshots.read("SN_MAIN:0x1", "SN_MAIN", "watched")).toBeNull();
    await snapshots.clear("SN_MAIN:0x1", "SN_MAIN");
    expect(await snapshots.read("SN_MAIN:0x1", "SN_MAIN", "indexed")).toBeNull();
    await snapshots.write({
      accountId: "SN_MAIN:0x2",
      checkedAt: 43,
      fetchedAt: 43,
      lane: "watched",
      networkId: "SN_MAIN",
      nfts: [nft],
    });
    await snapshots.clearAll();
    expect(await snapshots.read("SN_MAIN:0x2", "SN_MAIN", "watched")).toBeNull();
  });

  test("drops malformed public cache rows", async () => {
    const storage = createMemoryStore();
    await storage.set(NFT_SNAPSHOTS_KEY, [
      {
        accountId: "SN_MAIN:0x1",
        checkedAt: 42,
        fetchedAt: 42,
        lane: "indexed",
        networkId: "SN_MAIN",
        nfts: [{ ...nft, networkId: "SN_SEPOLIA" }],
      },
    ]);

    expect(
      await createNftSnapshotStore(storage).read("SN_MAIN:0x1", "SN_MAIN", "indexed"),
    ).toBeNull();
  });
});
