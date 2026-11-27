/**
 * The `watchAsset` block: a site's `wallet_watchAsset` for an ERC-721/1155 (`watch-nft.ts`),
 * read through the bridge as a page sends it, through the real handler (`./flows.ts`): the card
 * queued without a chain read, the decision (approve re-proves and stores), the page's answers,
 * and each refusal. Every JSON-RPC exchange is the approve's: none happens before it.
 */
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import {
  readProviderRequest,
  readProviderRequestArguments,
  toProviderPayload,
  toRuntimeMessage,
} from "@bramble/wallet-protocol/bridge";
import {
  contentSender,
  extensionSender,
  grantedOrigin,
} from "../../tests/support/background-wallet-stub";
import { flushHeld } from "../../tests/support/held";
import { createBackground, watchedNow } from "./flows";
import {
  type Answer,
  type Contracts,
  ERC721,
  ERC1155,
  LEGACY721,
  NOT_NFT,
  parityAccount,
  STRANGER,
  u256Reply,
  withNode,
} from "./shared";

const ok = (result: unknown): Answer => ({ result });

type WatchCase = {
  readonly name: string;
  readonly params: unknown;
  readonly contracts?: Contracts;
  readonly nftsOff?: boolean;
  readonly decide?: "approve" | "deny";
  /** Sends the same request twice before deciding (one card). */
  readonly twice?: boolean;
};

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";

/** The `watchAsset` block (Sepolia, the phrase's account 0, from `https://example.com`). */
export const computeWatchAsset = async () => {
  const { account: owner } = await parityAccount("SN_SEPOLIA", 0);
  const mine: Contracts = {
    [ERC721]: { owner_of: ok([owner.address]) },
    [LEGACY721]: { ownerOf: ok([STRANGER]) },
    [ERC1155]: { balance_of: ok(u256Reply(4n)) },
  };
  const nft = (type: string, options: Record<string, unknown>) => ({ options, type });
  const CASES: readonly WatchCase[] = [
    {
      decide: "approve",
      name: "an owned ERC-721, approved",
      params: nft("ERC721", { address: ERC721, tokenId: "7" }),
    },
    {
      decide: "approve",
      name: "an owned ERC-1155 with a hex id, approved",
      params: nft("ERC1155", { address: ERC1155, tokenId: "0x1f" }),
    },
    {
      decide: "approve",
      name: "the site's image and name are dropped",
      params: nft("ERC721", {
        address: ERC721,
        image: "https://evil.example/x.png",
        name: "Free",
        tokenId: "7",
      }),
    },
    {
      decide: "approve",
      name: "someone else's ERC-721, approved",
      params: nft("ERC721", { address: LEGACY721, tokenId: "7" }),
    },
    {
      decide: "approve",
      name: "the site claims ERC-1155 for an ERC-721: the chain decides",
      params: nft("ERC1155", { address: ERC721, tokenId: "7" }),
    },
    {
      decide: "approve",
      name: "not an NFT contract, approved",
      params: nft("ERC721", { address: NOT_NFT, tokenId: "7" }),
    },
    { decide: "deny", name: "denied", params: nft("ERC721", { address: ERC721, tokenId: "7" }) },
    {
      decide: "approve",
      name: "NFTs turned off: the card still waits, approve refused",
      nftsOff: true,
      params: nft("ERC721", { address: ERC721, tokenId: "7" }),
    },
    {
      decide: "approve",
      name: "the same NFT twice: one card answers both",
      params: nft("ERC721", { address: ERC721, tokenId: "7" }),
      twice: true,
    },
    { name: "a negative token id", params: nft("ERC721", { address: ERC721, tokenId: "-1" }) },
    {
      name: "a token id past u256",
      params: nft("ERC721", { address: ERC721, tokenId: (1n << 256n).toString() }),
    },
    { name: "a numeric token id", params: nft("ERC721", { address: ERC721, tokenId: 7 }) },
    { name: "a zero contract", params: nft("ERC721", { address: "0x0", tokenId: "7" }) },
    {
      name: "an unknown option",
      params: nft("ERC721", { address: ERC721, symbol: "P", tokenId: "7" }),
    },
    {
      name: "a non-string image",
      params: nft("ERC721", { address: ERC721, image: 1, tokenId: "7" }),
    },
    { name: "an unknown type", params: nft("ERC404", { address: ERC721, tokenId: "7" }) },
  ];
  const cases = [];
  for (const one of CASES) {
    const background = await createBackground({
      account: owner,
      ...(one.nftsOff
        ? {
            preferences: (store: WalletPreferencesStore) =>
              store.setDisplay({ collectiblesPreview: false }),
          }
        : {}),
    });
    const { exchanges, result } = await withNode(one.contracts ?? mine, async () => {
      const answers: unknown[] = [];
      const ask = async (index: number) => {
        const args = readProviderRequestArguments({
          method: "wallet_watchAsset",
          params: one.params as never,
        });
        const request =
          args && readProviderRequest({ ...args, id: REQUEST_ID, target: "bramble:content" });
        const message = request && toRuntimeMessage(request, grantedOrigin);
        answers[index] = message
          ? toProviderPayload(await background.handler(message, contentSender), "wallet_watchAsset")
          : { refused: "the bridge refused the params" };
      };
      answers.push("pending");
      if (one.twice) answers.push("pending");
      const held = answers.map((_, index) => ask(index));
      await flushHeld();
      const listed = (await background.handler(
        { type: "wallet.pendingApprovals" },
        extensionSender,
      )) as {
        readonly pending: readonly {
          readonly id: string;
          readonly kind: string;
          readonly nft?: unknown;
        }[];
      };
      const cards = listed.pending.map((card) => ({ kind: card.kind, nft: card.nft ?? null }));
      let decided: unknown = null;
      const card = listed.pending[0];
      if (one.decide && card) {
        const type = one.decide === "approve" ? "wallet.approveOrigin" : "wallet.denyOrigin";
        const reply = (await background.handler({ id: card.id, type }, extensionSender)) as Record<
          string,
          unknown
        >;
        decided = "error" in reply ? { error: reply["error"] } : { ok: reply["ok"] };
      }
      await Promise.race([Promise.all(held), flushHeld()]);
      return { answers: [...answers], cards, decided };
    });
    cases.push({
      account: { address: owner.address, id: owner.id, networkId: owner.networkId },
      exchanges,
      name: one.name,
      origin: grantedOrigin,
      params: one.params,
      ...(result as Record<string, unknown>),
      watched: await watchedNow(background),
    });
  }
  return cases;
};
