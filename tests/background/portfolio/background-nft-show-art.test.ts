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
});
