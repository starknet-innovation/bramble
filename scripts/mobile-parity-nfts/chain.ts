/**
 * The chain blocks:
 *
 * - `ownership`: `getNftOwnership` (the re-proof every discovery candidate, watch and send goes
 *   through) over the fake node: `owner_of`, then `ownerOf`, then `balance_of`, then
 *   `balanceOf`, each `starknet_call` as sent with its answer, and the holding or the refusal;
 * - `tokenUri`: `getNftTokenUri` over the fake node: `token_uri`, `tokenURI`, then `uri`, the
 *   ByteArray and legacy felt-array decodings, `{id}` substitution, and the bounds;
 * - `calls`: `buildErc721TransferCall` and `buildErc1155TransferCall`.
 */
import { buildErc721TransferCall, buildErc1155TransferCall } from "@bramble/portfolio/nft";
import { getNftOwnership, getNftTokenUri } from "@bramble/starknet/rpc";
import {
  type Answer,
  byteArrayReply,
  ERC721,
  ERC1155,
  feltArrayReply,
  plain,
  STRANGER,
  thrownMessage,
  u256Reply,
  withNode,
} from "./shared";

/** The account the chain reads are made for. Made up. */
const HOLDER = "0x2a9f0e1d2c3b4a5968778695a4b3c2d1e0f1a2b3c4d5e6f708192a3b4c5d6e7";
const RPC_URLS = ["https://capture.invalid/rpc"];
const ok = (result: unknown): Answer => ({ result });
const REVERT: Answer = {
  error: {
    code: 40,
    data: { revert_error: "ERC721: invalid token ID" },
    message: "Contract error",
  },
};

type ReadCase = {
  readonly name: string;
  readonly answers: Readonly<Record<string, Answer>>;
  readonly tokenId?: string;
  readonly contract?: string;
  readonly account?: string;
};

const OWNERSHIP_CASES: readonly ReadCase[] = [
  { answers: { owner_of: ok([HOLDER]) }, name: "ERC-721 owned" },
  { answers: { owner_of: ok([STRANGER]) }, name: "ERC-721 owned by someone else" },
  {
    answers: { owner_of: ok([`0x${HOLDER.slice(2).padStart(64, "0")}`]) },
    name: "ERC-721 owner zero-padded",
  },
  {
    answers: { owner_of: ok([`0x${HOLDER.slice(2).toUpperCase()}`]) },
    name: "an uppercase owner felt is not a felt reply",
  },
  { answers: { ownerOf: ok([HOLDER]) }, name: "a legacy camelCase ownerOf" },
  {
    answers: { owner_of: REVERT, ownerOf: REVERT, balance_of: REVERT, balanceOf: REVERT },
    name: "owner_of reverts (an unminted or burned token)",
  },
  {
    answers: { owner_of: ok(["0xzz"]), ownerOf: ok([HOLDER]) },
    name: "a non-felt owner tries the next casing",
  },
  { answers: { owner_of: ok([]), ownerOf: ok([HOLDER]) }, name: "an empty owner reply" },
  {
    answers: { owner_of: ok([HOLDER, "0x1"]) },
    name: "an owner reply with extra felts reads the first",
  },
  { answers: { balance_of: ok(u256Reply(2n)) }, name: "ERC-1155 balance 2" },
  { answers: { balance_of: ok(u256Reply(0n)) }, name: "ERC-1155 balance 0" },
  {
    answers: { balance_of: ok(u256Reply((1n << 128n) + 1n)) },
    name: "ERC-1155 balance with a high limb",
  },
  { answers: { balanceOf: ok(u256Reply(3n)) }, name: "a camelCase balanceOf" },
  {
    answers: { balance_of: ok(["0x1"]), balanceOf: ok(u256Reply(3n)) },
    name: "a one-felt balance tries the next casing",
  },
  {
    answers: { balance_of: ok(["0x1", "0x0", "0x0"]) },
    name: "a three-felt balance",
  },
  {
    answers: { balance_of: ok([`0x1${"0".repeat(32)}`, "0x0"]) },
    name: "a low limb past u128",
  },
  { answers: {}, name: "no NFT entrypoint answers" },
  { answers: { owner_of: "transport" }, name: "a transport failure" },
  {
    answers: { owner_of: ok([HOLDER]) },
    name: "a token id past u128 (two-limb calldata)",
    tokenId: ((1n << 128n) + 5n).toString(),
  },
  { answers: {}, contract: "0x0", name: "a zero contract is refused before any read" },
  { account: "0x0", answers: {}, name: "a zero account is refused before any read" },
];

/** The `ownership` block. */
export const computeOwnership = async () => {
  const cases = [];
  for (const one of OWNERSHIP_CASES) {
    const contract = one.contract ?? ERC721;
    const input = {
      accountAddress: one.account ?? HOLDER,
      contractAddress: contract,
      tokenId: one.tokenId ?? "7",
    };
    const { exchanges, result } = await withNode({ [ERC721]: one.answers }, () =>
      getNftOwnership({ ...input, rpcUrls: RPC_URLS }),
    );
    cases.push({ exchanges, input, name: one.name, result });
  }
  return cases;
};

const LONG_URI = `https://meta.example/collections/punks/${"a".repeat(40)}/7.json`;
// 1058 full words: the most a reply may declare, 32 798 bytes, past the 32 KiB URI bound.
const OVERSIZE_URI = `https://${"x".repeat(1058 * 31 - 8)}`;

const URI_CASES: readonly ReadCase[] = [
  {
    answers: { token_uri: ok(byteArrayReply("https://meta.example/7.json")) },
    name: "a ByteArray",
  },
  { answers: { token_uri: ok(byteArrayReply(LONG_URI)) }, name: "a ByteArray of several words" },
  {
    answers: { token_uri: ok(byteArrayReply("x".repeat(31))) },
    name: "a ByteArray of one full word",
  },
  { answers: { token_uri: ok(feltArrayReply(LONG_URI)) }, name: "a legacy felt array" },
  { answers: { tokenURI: ok(byteArrayReply("ipfs://bafy/7")) }, name: "a camelCase tokenURI" },
  {
    answers: { uri: ok(byteArrayReply("https://meta.example/{id}.json")) },
    contract: ERC1155,
    name: "an ERC-1155 uri with {id}",
  },
  {
    answers: { uri: ok(byteArrayReply("https://meta.example/{id}/{id}.json")) },
    contract: ERC1155,
    name: "{id} twice, past u128",
    tokenId: ((1n << 128n) + 255n).toString(),
  },
  {
    answers: { uri: ok(byteArrayReply("https://meta.example/all.json")) },
    contract: ERC1155,
    name: "an ERC-1155 uri without {id}",
  },
  {
    answers: { token_uri: ok(byteArrayReply("https://meta.example/{id}.json")) },
    name: "{id} in a token_uri is left as is",
  },
  {
    answers: { token_uri: ok(byteArrayReply("")), uri: ok(byteArrayReply("https://b/1")) },
    name: "an empty token_uri tries the next entrypoint",
  },
  { answers: { token_uri: ok(byteArrayReply("")) }, name: "only an empty URI" },
  {
    answers: { token_uri: ok(["0x2", "0x41"]) },
    name: "a declared length that matches neither layout",
  },
  {
    answers: { token_uri: ok(["0x0", "0x41", "0x1f"]) },
    name: "a pending word length past 30",
  },
  {
    answers: { token_uri: ok(["0x1", "0x0"]) },
    name: "a felt array with an empty piece",
  },
  {
    answers: { token_uri: ok(["0x1", "0x410a"]) },
    name: "a felt array with a control character",
  },
  {
    answers: { token_uri: ok(["0x1", "0xzz"]) },
    name: "a felt array with a non-felt",
  },
  {
    answers: { token_uri: ok(byteArrayReply(OVERSIZE_URI)) },
    name: "a ByteArray past the 32 KiB bound",
  },
  { answers: { token_uri: REVERT }, name: "every entrypoint reverts" },
  { answers: { token_uri: "transport" }, name: "a transport failure" },
  { answers: {}, contract: "0x0", name: "a zero contract is refused before any read" },
];

/** The `tokenUri` block. */
export const computeTokenUri = async () => {
  const cases = [];
  for (const one of URI_CASES) {
    const input = { contractAddress: one.contract ?? ERC721, tokenId: one.tokenId ?? "7" };
    const { exchanges, result } = await withNode(
      { [ERC721]: one.answers, [ERC1155]: one.answers },
      async () => ({ uri: await getNftTokenUri({ ...input, rpcUrls: RPC_URLS }) }),
    );
    cases.push({ exchanges, input, name: one.name, result });
  }
  return cases;
};

const FROM = HOLDER;
const TO = STRANGER;

/** The `calls` block: the transfer call each standard builds, or its refusal. */
export const computeCalls = () => {
  const build = (
    name: string,
    standard: "ERC721" | "ERC1155",
    contract: string,
    from: string,
    to: string,
    tokenId: bigint,
  ) => {
    const builder = standard === "ERC721" ? buildErc721TransferCall : buildErc1155TransferCall;
    try {
      const call = builder(contract, from, to, tokenId);
      return {
        input: { contract, from, standard, to, tokenId: tokenId.toString() },
        name,
        result: { call: plain({ ...call, calldata: [...(call.calldata as string[])] }) },
      };
    } catch (error) {
      return {
        input: { contract, from, standard, to, tokenId: tokenId.toString() },
        name,
        result: { error: thrownMessage(error) },
      };
    }
  };
  const max = (1n << 256n) - 1n;
  return (["ERC721", "ERC1155"] as const).flatMap((standard) => [
    build(`${standard} token 7`, standard, ERC721, FROM, TO, 7n),
    build(`${standard} token 0`, standard, ERC721, FROM, TO, 0n),
    build(`${standard} token past u128`, standard, ERC721, FROM, TO, (1n << 128n) + 1n),
    build(`${standard} the largest token id`, standard, ERC721, FROM, TO, max),
    build(
      `${standard} a padded uppercase contract`,
      standard,
      `0x00${ERC721.slice(2).toUpperCase()}`,
      FROM,
      TO,
      7n,
    ),
    build(`${standard} a zero recipient`, standard, ERC721, FROM, "0x0", 7n),
    build(`${standard} a non-felt contract`, standard, "0xzz", FROM, TO, 7n),
    build(
      `${standard} a recipient past the field`,
      standard,
      ERC721,
      FROM,
      `0x8${"0".repeat(62)}1`,
      7n,
    ),
  ]);
};
