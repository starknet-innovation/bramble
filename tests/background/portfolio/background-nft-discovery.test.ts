/**
 * NFT auto-discovery message checks: the gallery is populated from the indexer
 * but every candidate is re-proven through its ERC721 owner or ERC1155 balance,
 * so tokens the account no longer owns (or that fail to read) never surface,
 * and an unconfigured indexer yields an empty gallery.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import { createHttpNftIndexer } from "@bramble/portfolio/nft-indexer";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import type { NftTokenMetadata } from "@bramble/portfolio/nft-token-metadata";
import { ARGENT_MULTISIG_CONTRACT } from "@bramble/starknet/account-contracts";
import { createMemoryStore } from "@bramble/store/kv";
import { createStarkscanClient } from "@bramble/transactions/starkscan";
import { createStarkscanNftSource } from "@bramble/transactions/starkscan-nfts";
import { createNftSnapshotStore } from "../../../apps/extension/src/background/portfolio/nft-snapshots";
import { account, candidate, makeHandler, sender } from "../../support/nft-discovery-harness";

describe("NFT auto-discovery messages", () => {
  test("serves a durable ownership snapshot and refreshes stale data once", async () => {
    let now = 1_000;
    const snapshots = createNftSnapshotStore(createMemoryStore());
    const owned = candidate("5", "0x511a2b3");
    const { handler, indexerCalls } = makeHandler({
      candidates: [owned],
      nftSnapshots: snapshots,
      now: () => now,
      owners: { [owned.contract]: account.address },
    });

    await handler({ type: "wallet.discoverNfts" }, sender);
    await handler({ type: "wallet.discoverNfts" }, sender);
    expect(indexerCalls()).toBe(1);

    now += 120_000;
    await expect(handler({ type: "wallet.discoverNfts" }, sender)).resolves.toEqual({
      coverage: "none",
      nfts: [owned],
      ok: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(indexerCalls()).toBe(2);
  });

  test("backs off a failed stale-snapshot refresh without dropping the gallery", async () => {
    const snapshots = createNftSnapshotStore(createMemoryStore());
    const owned = candidate("5", "0x511a2b3");
    await snapshots.write({
      accountId: account.id,
      checkedAt: 1,
      fetchedAt: 1,
      lane: "complete",
      networkId: "SN_MAIN",
      nfts: [owned],
    });
    const { handler, indexerCalls } = makeHandler({
      candidates: [],
      indexerFails: true,
      nftSnapshots: snapshots,
      now: () => 200_000,
      owners: {},
    });

    await expect(handler({ type: "wallet.discoverNfts" }, sender)).resolves.toEqual({
      coverage: "none",
      nfts: [owned],
      ok: true,
    });
    await handler({ type: "wallet.discoverNfts" }, sender);
    expect(indexerCalls()).toBe(1);
  });

  test("a failed refresh no longer claims a cached complete list is whole", async () => {
    const snapshots = createNftSnapshotStore(createMemoryStore());
    const owned = candidate("5", "0x511a2b3");
    await snapshots.write({
      accountId: account.id,
      checkedAt: 1,
      coverage: "complete",
      fetchedAt: 1,
      lane: "complete",
      networkId: "SN_MAIN",
      nfts: [owned],
    });
    const { handler, indexerCalls } = makeHandler({
      candidates: [],
      indexerFails: true,
      nftSnapshots: snapshots,
      now: () => 200_000,
      owners: {},
    });
    const stale = { coverage: "incomplete", nfts: [owned], ok: true } as const;
    await expect(handler({ type: "wallet.discoverNfts" }, sender)).resolves.toEqual(stale);
    // During the retry backoff the cached answer keeps saying so.
    await expect(handler({ type: "wallet.discoverNfts" }, sender)).resolves.toEqual(stale);
    expect(indexerCalls()).toBe(1);
  });

  test("returns only candidates the account still owns on-chain", async () => {
    const owned = candidate("5", "0x511a2b3");
    const stale = candidate("9", "0x6220000");
    const unreadable = candidate("7", "0x7330000");
    const { handler } = makeHandler({
      candidates: [owned, stale, unreadable],
      owners: {
        "0x511a2b3": account.address,
        "0x6220000": "0x999",
        // 0x7330000 intentionally absent -> owner_of throws -> dropped
      },
    });
    const response = await handler({ type: "wallet.discoverNfts" }, sender);
    expect(response).toEqual({ coverage: "none", nfts: [owned], ok: true });
  });

  test("an unconfigured indexer yields an empty gallery", async () => {
    const { handler } = makeHandler({ candidates: [], owners: {} });
    await expect(handler({ type: "wallet.discoverNfts" }, sender)).resolves.toEqual({
      coverage: "none",
      nfts: [],
      ok: true,
    });
  });

  test("a saved indexer is used only while the collectibles preview is on", async () => {
    const { handler, indexerUrls, preferencesStore } = makeHandler({ candidates: [], owners: {} });
    await preferencesStore.setNftIndexerUrl({ url: "https://indexer.example" });
    await handler({ type: "wallet.discoverNfts" }, sender);
    await preferencesStore.setDisplay({ collectiblesPreview: true });
    await handler({ includeWatched: false, type: "wallet.discoverNfts" }, sender);
    expect(indexerUrls).toEqual([null, "https://indexer.example"]);
  });

  test("scopes shared-account discovery to a watched multisig address", async () => {
    const shared: ArgentMultisigRecord = {
      accountContractType: "argent-multisig",
      address: "0x456",
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      id: "SN_MAIN:0x456",
      networkId: "SN_MAIN",
    };
    const owned = candidate("5", "0x511a2b3");
    const { handler, indexedAddresses, multisigStore } = makeHandler({
      candidates: [owned],
      owners: { [owned.contract]: shared.address },
    });
    await multisigStore.upsertMultisig(shared);

    await expect(
      handler({ multisigId: shared.id, type: "wallet.discoverNfts" }, sender),
    ).resolves.toEqual({ coverage: "none", nfts: [owned], ok: true });
    expect(indexedAddresses).toEqual([shared.address]);
  });

  test("rejects discovery for an unwatched shared account", async () => {
    const { handler, indexerCalls } = makeHandler({ candidates: [], owners: {} });
    await expect(
      handler({ multisigId: "SN_MAIN:0x999", type: "wallet.discoverNfts" }, sender),
    ).resolves.toEqual({ error: "multisig not found on the active network" });
    expect(indexerCalls()).toBe(0);
  });

  test("discovers and hydrates an owned watch without an indexer", async () => {
    const contract = "0x511a2b3";
    const metadata: NftTokenMetadata = {
      animationUrl: "",
      attributes: [{ traitType: "Punk ID", value: "0" }],
      collection: "MC Punks",
      description: "A test collectible",
      externalUrl: "https://example.com/punks/0",
      image: "https://cdn.example/punk0000.png",
      name: "Starknet Test Punk #0",
    };
    const metadataCalls: string[] = [];
    const { handler, preferencesStore } = makeHandler({
      candidates: [],
      async getNftMetadata(input) {
        metadataCalls.push(input.contractAddress);
        return metadata;
      },
      owners: { [contract]: account.address },
    });
    await preferencesStore.addNft({
      contract,
      label: "My first punk",
      networkId: "SN_MAIN",
      tokenId: "0",
    });

    const response = await handler({ type: "wallet.discoverNfts" }, sender);

    expect(response).toEqual({
      coverage: "none",
      nfts: [
        {
          attributes: metadata.attributes,
          collection: metadata.collection,
          contract,
          description: metadata.description,
          externalUrl: metadata.externalUrl,
          id: `SN_MAIN:${contract}:0`,
          image: metadata.image,
          name: metadata.name,
          networkId: "SN_MAIN",
          tokenId: "0",
        },
      ],
      ok: true,
    });
    expect(metadataCalls).toEqual([contract]);
  });

  test("loads watched artwork without waiting for or contacting the indexer", async () => {
    const contract = "0x511a2b3";
    const metadata: NftTokenMetadata = {
      animationUrl: "",
      attributes: [],
      collection: "MC Punks",
      description: "",
      externalUrl: "",
      image: "https://cdn.example/punk0000.png",
      name: "Starknet Test Punk #0",
    };
    const { handler, indexerCalls, preferencesStore } = makeHandler({
      candidates: [],
      async getNftMetadata() {
        return metadata;
      },
      owners: { [contract]: account.address },
    });
    await preferencesStore.addNft({
      contract,
      networkId: "SN_MAIN",
      tokenId: "0",
    });

    const response = await handler({ type: "wallet.loadWatchedNfts" }, sender);

    expect(response).toMatchObject({
      nfts: [{ contract, image: metadata.image, tokenId: "0" }],
      ok: true,
    });
    expect(indexerCalls()).toBe(0);
  });

  test("excludes watches explicitly scoped to another account before ownership reads", async () => {
    const contract = "0x511a2b3";
    const { handler, preferencesStore } = makeHandler({
      candidates: [],
      owners: { [contract]: account.address },
    });
    await preferencesStore.addNft({
      contract,
      networkId: "SN_MAIN",
      owner: "0x987",
      tokenId: "0",
    });

    await expect(handler({ type: "wallet.loadWatchedNfts" }, sender)).resolves.toEqual({
      nfts: [],
      ok: true,
    });
  });

  test("indexed-only discovery excludes watched NFTs and their metadata work", async () => {
    const watched = candidate("0", "0x511a2b3");
    const unsolicited = candidate("5", "0x6220000");
    let metadataCalls = 0;
    const { handler, preferencesStore } = makeHandler({
      candidates: [watched, unsolicited],
      async getNftMetadata() {
        metadataCalls += 1;
        return null;
      },
      owners: {
        [unsolicited.contract]: account.address,
        [watched.contract]: account.address,
      },
    });
    await preferencesStore.addNft({
      contract: watched.contract,
      networkId: "SN_MAIN",
      tokenId: watched.tokenId,
    });

    await expect(
      handler({ includeWatched: false, type: "wallet.discoverNfts" }, sender),
    ).resolves.toEqual({ coverage: "none", nfts: [unsolicited], ok: true });
    expect(metadataCalls).toBe(0);
  });

  test("does not fetch metadata for unsolicited indexer candidates", async () => {
    const owned = candidate("5", "0x511a2b3");
    let metadataCalls = 0;
    const { handler } = makeHandler({
      candidates: [owned],
      async getNftMetadata() {
        metadataCalls += 1;
        return null;
      },
      owners: { [owned.contract]: account.address },
    });

    await expect(handler({ type: "wallet.discoverNfts" }, sender)).resolves.toEqual({
      coverage: "none",
      nfts: [owned],
      ok: true,
    });
    expect(metadataCalls).toBe(0);
  });

  test("a failed ownership read makes a complete list incomplete", async () => {
    const owned = candidate("5", "0x511a2b3");
    const notOwned = candidate("9", "0x6220000");
    const unreadable = candidate("7", "0x7330000");
    const run = async (candidates: readonly DiscoveredNft[]) => {
      const { handler, preferencesStore } = makeHandler({
        candidates,
        // 0x7330000 is absent, so its owner read throws.
        owners: { "0x511a2b3": account.address, "0x6220000": "0x999" },
      });
      await preferencesStore.setDisplay({ collectiblesPreview: true });
      await preferencesStore.setNftIndexerUrl({ url: "https://indexer.example" });
      return handler({ includeWatched: false, type: "wallet.discoverNfts" }, sender);
    };
    // Someone else owning a candidate is a real answer; the list stays complete.
    await expect(run([owned, notOwned])).resolves.toEqual({
      coverage: "complete",
      nfts: [owned],
      ok: true,
    });
    await expect(run([owned, unreadable])).resolves.toEqual({
      coverage: "incomplete",
      nfts: [owned],
      ok: true,
    });
  });

  test("Starkscan candidates are shown only once the chain proves ownership", async () => {
    const requested: string[] = [];
    let now = 1_000;
    const page = {
      chainId: "SN_MAIN",
      coverage: {
        completeWithinScope: false,
        declaredScope: "indexed_standard_erc721_transfers",
        globallyComplete: false,
        indexedFromBlock: 0,
        indexedThroughBlock: 10,
        reasonCodes: ["indexed_history_floor"],
        status: "partial",
      },
      hasMore: false,
      items: ["0x511a2b3", "0x6220000"].map((tokenAddress) => ({
        collection: { metadataStatus: "indexed", name: "Punks", symbol: null },
        evidenceSource: "indexed_erc721_ownership",
        lastTransferHash: "0x1",
        observedAtBlock: 1,
        standard: "erc721",
        tokenAddress,
        tokenId: "5",
      })),
      nextCursor: null,
      ownerAddress: account.address,
      schemaVersion: "starkscan.nft_positions.v1",
      snapshotBlock: 10,
    };
    // The wallet's existing Starkscan client, with only its transport faked.
    const client = createStarkscanClient({
      baseUrl: "https://starkscan.co/v1",
      http: async (url) => {
        requested.push(url);
        return new Response(JSON.stringify(page));
      },
    });
    const { handler, preferencesStore } = makeHandler({
      candidates: [],
      nftIndexer: createHttpNftIndexer(
        async () => {
          throw new Error("no custom indexer is saved");
        },
        createStarkscanNftSource({ client, readPreferences: async () => ({}) }),
      ),
      nftSnapshots: createNftSnapshotStore(createMemoryStore()),
      now: () => now,
      // Starkscan lists both; the chain says the second belongs to someone else.
      owners: { "0x511a2b3": account.address, "0x6220000": "0x999" },
    });
    const message = { includeWatched: false, type: "wallet.discoverNfts" };
    // Preview off: Starkscan is never asked.
    await expect(handler(message, sender)).resolves.toEqual({
      coverage: "none",
      nfts: [],
      ok: true,
    });
    expect(requested).toEqual([]);
    await preferencesStore.setDisplay({ collectiblesPreview: true });
    now += 120_000;
    const expected = {
      coverage: "incomplete",
      nfts: [expect.objectContaining({ contract: "0x511a2b3", tokenId: "5" })],
      ok: true,
    } as const;
    await expect(handler(message, sender)).resolves.toEqual(expected);
    // The cached answer keeps saying the list is incomplete.
    await expect(handler(message, sender)).resolves.toEqual(expected);
    expect(requested).toEqual([
      `https://starkscan.co/v1/SN_MAIN/address/${account.address}/nft-positions?limit=100`,
    ]);
  });

  test("rejects a malformed discover request", async () => {
    const { handler } = makeHandler({ candidates: [], owners: {} });
    await expect(handler({ extra: true, type: "wallet.discoverNfts" }, sender)).resolves.toEqual({
      error: "invalid discover nfts request",
    });
  });
});
