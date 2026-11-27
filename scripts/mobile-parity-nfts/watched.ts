/**
 * The `watched` block: the watched-NFT record (`withNftId`, `isWatchedNft`), the preference
 * writes over a real store (`addNft`, `setNftSpam`, `removeNft`: the list after each, or the
 * refusal), and which watched NFTs the gallery treats as candidates for an owner and network
 * (`watchedCandidates`) and how they merge with an indexer's (`mergeNftCandidates`).
 *
 * There is no cap on how many NFTs may be watched: the store keeps every distinct id.
 */
import { isWatchedNft, withNftId } from "@bramble/portfolio/watched-nft";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import {
  mergeNftCandidates,
  watchedCandidates,
} from "../../apps/extension/src/background/portfolio/nft-candidates";
import { ERC721, ERC1155, plain, STRANGER, thrownMessage } from "./shared";

const OWNER = "0x2a9f0e1d2c3b4a5968778695a4b3c2d1e0f1a2b3c4d5e6f708192a3b4c5d6e7";
const padded = (felt: string) => `0x${felt.slice(2).padStart(64, "0").toUpperCase()}`;

const INPUTS = [
  { contract: padded(ERC721), networkId: "SN_MAIN", tokenId: "007" },
  {
    contract: ERC721,
    label: "  My punk  ",
    networkId: "SN_MAIN",
    owner: padded(OWNER),
    spam: false,
    tokenId: "7",
  },
  { contract: ERC1155, networkId: "SN_SEPOLIA", tokenId: "0x1f" },
] as const;

const good = withNftId({ contract: ERC721, networkId: "SN_MAIN", owner: OWNER, tokenId: "7" });
const RECORDS: readonly (readonly [string, unknown])[] = [
  ["canonical", good],
  ["with label and spam", { ...good, label: "Mine", spam: true }],
  // No `owner` key at all: `{ owner: undefined }` is refused by `hasOnlyKnownKeys` but writes
  // to JSON as this record, so the recorded verdict would not be the one for the recorded value.
  ["legacy, no owner", Object.fromEntries(Object.entries(good).filter(([key]) => key !== "owner"))],
  ["an id that does not match", { ...good, id: `SN_MAIN:${ERC721}:8` }],
  ["a padded contract (id mismatch)", { ...good, contract: padded(ERC721) }],
  ["a zero contract", { ...good, contract: "0x0", id: "SN_MAIN:0x0:7" }],
  ["a hex token id", { ...good, id: `SN_MAIN:${ERC721}:0x7`, tokenId: "0x7" }],
  [
    "a token id of 79 digits",
    { ...good, id: `SN_MAIN:${ERC721}:${"9".repeat(79)}`, tokenId: "9".repeat(79) },
  ],
  [
    "a token id of 78 digits",
    { ...good, id: `SN_MAIN:${ERC721}:${"9".repeat(78)}`, tokenId: "9".repeat(78) },
  ],
  ["a blank label", { ...good, label: "   " }],
  ["a 65-character label", { ...good, label: "x".repeat(65) }],
  ["a zero owner", { ...good, owner: "0x0" }],
  ["a non-boolean spam", { ...good, spam: "yes" }],
  ["another network", { ...good, id: `SN_GOERLI:${ERC721}:7`, networkId: "SN_GOERLI" }],
  ["an extra key", { ...good, image: "https://x.example" }],
  ["not a record", "nft"],
];

const storeOps = async () => {
  const store = createPreferencesStore({ store: createMemoryStore() });
  const steps: object[] = [];
  const step = async (op: string, input: unknown, run: () => Promise<{ nfts?: unknown }>) => {
    try {
      steps.push({ input, nfts: plain((await run()).nfts ?? []), op });
    } catch (error) {
      steps.push({
        error: thrownMessage(error),
        input,
        nfts: plain((await store.read()).nfts ?? []),
        op,
      });
    }
  };
  const a = { contract: ERC721, networkId: "SN_MAIN", owner: OWNER, tokenId: "7" } as const;
  const b = {
    contract: ERC1155,
    label: " Sword ",
    networkId: "SN_MAIN",
    owner: OWNER,
    tokenId: "3",
  } as const;
  await step("addNft", a, () => store.addNft(a));
  await step("addNft", b, () => store.addNft(b));
  const relabel = { ...a, contract: padded(ERC721), label: "Again" };
  await step("addNft", relabel, () => store.addNft(relabel));
  const bad = { ...a, tokenId: "-1" };
  await step("addNft", bad, () => store.addNft(bad));
  const spam = { id: withNftId(b).id, spam: true };
  await step("setNftSpam", spam, () => store.setNftSpam(spam));
  const unknown = { id: "SN_MAIN:0x1:1", spam: true };
  await step("setNftSpam", unknown, () => store.setNftSpam(unknown));
  await step("removeNft", withNftId(a).id, () => store.removeNft(withNftId(a).id));
  await step("removeNft", "", () => store.removeNft(""));
  return steps;
};

const candidates = () => {
  const nfts = [
    withNftId({
      contract: ERC721,
      label: "Mine",
      networkId: "SN_MAIN",
      owner: OWNER,
      tokenId: "1",
    }),
    withNftId({ contract: ERC721, networkId: "SN_MAIN", tokenId: "2" }),
    withNftId({ contract: ERC721, networkId: "SN_MAIN", owner: STRANGER, tokenId: "3" }),
    withNftId({ contract: ERC721, networkId: "SN_MAIN", owner: OWNER, spam: true, tokenId: "4" }),
    withNftId({ contract: ERC721, networkId: "SN_SEPOLIA", owner: OWNER, tokenId: "5" }),
  ];
  const watched = watchedCandidates({ nfts } as never, "SN_MAIN", padded(OWNER));
  const indexed = [
    {
      ...watched[0],
      collection: "Indexed",
      image: "https://img.example/1.png",
      name: "From indexer",
    },
    { ...watched[0], id: `SN_MAIN:${ERC721}:9`, name: "", tokenId: "9" },
  ] as typeof watched;
  return {
    merged: plain(mergeNftCandidates(indexed, watched)),
    indexed: plain(indexed),
    network: "SN_MAIN",
    nfts: plain(nfts),
    owner: padded(OWNER),
    watched: plain(watched),
  };
};

/** The `watched` block. */
export const computeWatched = async () => [
  {
    name: "withNftId",
    pairs: INPUTS.map((input) => ({ input, output: plain(withNftId(input as never)) })),
  },
  {
    name: "isWatchedNft",
    pairs: RECORDS.map(([label, value]) => ({
      label,
      value: plain(value) ?? null,
      valid: isWatchedNft(value),
    })),
  },
  { name: "preference writes", steps: await storeOps() },
  { name: "gallery candidates", ...candidates() },
];
