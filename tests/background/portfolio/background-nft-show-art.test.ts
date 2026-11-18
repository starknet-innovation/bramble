/**
 * "Show art" on a discovered NFT card reuses `wallet.addNft`: the privacy rule
 * is that a sender-controlled metadata URL is contacted only for an NFT the
 * user chose. A discovered NFT stays unread until that click; the click is
 * refused (and reads nothing) when the chain does not prove ownership; and
 * once it is watched, the watched lane reads its metadata and art.
 */
import { describe, expect, test } from "bun:test";
import type { NftTokenMetadata } from "@bramble/portfolio/nft-token-metadata";
import { account, candidate, makeHandler, sender } from "../../support/nft-discovery-harness";

const ART: NftTokenMetadata = {
  animationUrl: "",
  attributes: [],
  collection: "Airdrops",
  description: "",
  externalUrl: "",
  image: "data:image/png;base64,iVBORw0KGgo=",
  name: "Airdrop 11",
};

// Starkscan candidates carry no name or image: only a watch resolves them.
const discovered = { ...candidate("11", "0x7330000"), collection: "", image: "", name: "" };

describe("Show art on a discovered NFT", () => {
  test("reads no metadata until the user watches the NFT, then loads its art", async () => {
    const metadataCalls: string[] = [];
    const { handler } = makeHandler({
      candidates: [discovered],
      async getNftMetadata(input) {
        metadataCalls.push(`${input.contractAddress}:${input.tokenId}`);
        return ART;
      },
      owners: { [discovered.contract]: account.address },
    });

    await expect(handler({ type: "wallet.discoverNfts" }, sender)).resolves.toMatchObject({
      nfts: [{ id: discovered.id, image: "" }],
      ok: true,
    });
    await expect(handler({ type: "wallet.loadWatchedNfts" }, sender)).resolves.toEqual({
      nfts: [],
      ok: true,
    });
    expect(metadataCalls).toEqual([]);

    // The panel's Show art click: the same message the watch form sends.
    await expect(
      handler(
        {
          contract: discovered.contract,
          label: "NFT 11",
          networkId: "SN_MAIN",
          tokenId: discovered.tokenId,
          type: "wallet.addNft",
        },
        sender,
      ),
    ).resolves.toMatchObject({
      ok: true,
      preferences: {
        nfts: [{ contract: discovered.contract, owner: account.address, tokenId: "11" }],
      },
    });
    expect(metadataCalls).toEqual([]);

    await expect(handler({ type: "wallet.loadWatchedNfts" }, sender)).resolves.toMatchObject({
      nfts: [{ id: discovered.id, image: ART.image, name: ART.name }],
      ok: true,
    });
    expect(metadataCalls).toEqual([`${discovered.contract}:11`]);
  });

  test("refuses to watch an NFT the account does not own and reads nothing", async () => {
    let metadataCalls = 0;
    const { handler, preferencesStore } = makeHandler({
      candidates: [discovered],
      async getNftMetadata() {
        metadataCalls += 1;
        return ART;
      },
      owners: { [discovered.contract]: "0x987" },
    });

    await expect(
      handler(
        {
          contract: discovered.contract,
          networkId: "SN_MAIN",
          tokenId: discovered.tokenId,
          type: "wallet.addNft",
        },
        sender,
      ),
    ).resolves.toEqual({ error: "this account does not own that NFT" });
    expect((await preferencesStore.read()).nfts ?? []).toEqual([]);
    await handler({ type: "wallet.loadWatchedNfts" }, sender);
    expect(metadataCalls).toBe(0);
  });

  // Issue 901: a watched NFT whose metadata or art cannot be found used to stay
  // a silent placeholder. The watched lane now marks it so the card can say so.
  test("marks a watched NFT whose metadata read fails or names no art", async () => {
    const watch = {
      contract: discovered.contract,
      networkId: "SN_MAIN",
      tokenId: discovered.tokenId,
      type: "wallet.addNft",
    };
    for (const getNftMetadata of [
      async (): Promise<NftTokenMetadata> => {
        throw new Error("Could not read NFT metadata URI");
      },
      async (): Promise<null> => null,
      async (): Promise<NftTokenMetadata> => ({ ...ART, image: "" }),
    ]) {
      const { handler } = makeHandler({
        candidates: [discovered],
        getNftMetadata,
        owners: { [discovered.contract]: account.address },
      });
      await handler(watch, sender);
      await expect(handler({ type: "wallet.loadWatchedNfts" }, sender)).resolves.toMatchObject({
        nfts: [{ artUnavailable: true, id: discovered.id, image: "" }],
        ok: true,
      });
    }
  });

  test("leaves a watched NFT with art or an animation unmarked", async () => {
    for (const metadata of [ART, { ...ART, animationUrl: "data:text/html,<p>hi</p>", image: "" }]) {
      const { handler } = makeHandler({
        candidates: [discovered],
        async getNftMetadata() {
          return metadata;
        },
        owners: { [discovered.contract]: account.address },
      });
      await handler(
        {
          contract: discovered.contract,
          networkId: "SN_MAIN",
          tokenId: discovered.tokenId,
          type: "wallet.addNft",
        },
        sender,
      );
      const loaded = (await handler({ type: "wallet.loadWatchedNfts" }, sender)) as {
        readonly nfts: readonly Record<string, unknown>[];
      };
      expect(loaded.nfts).toHaveLength(1);
      expect(loaded.nfts[0]).not.toHaveProperty("artUnavailable");
    }
  });
});
