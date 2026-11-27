/**
 * The handler blocks, through the extension's real background message handler
 * (`createMessageHandler`) over the background suites' wallet stub, with the production NFT
 * readers behind it: `getNftOwnership`, `getNftTokenUri` + `resolveNftMetadataUri` (as
 * `getNftMetadata` composes them) and the indexer/Starkscan composition, over the fake node and a
 * recording HTTP transport (`./shared.ts`). Each case writes the preferences it starts from, the
 * message(s) sent, the reply, every JSON-RPC and HTTP exchange in order, and the watched list
 * after.
 *
 * - `discover`: `wallet.discoverNfts` (indexer, re-proof of every candidate, watched merge,
 *   metadata for watched NFTs only, coverage);
 * - `addNft`: `wallet.addNft`, the watch form (re-proof, then the stored record).
 *
 * `createBackground` is shared with `./watch.ts` and `./transfer.ts`.
 */
import { createHttpNftIndexer } from "@bramble/portfolio/nft-indexer";
import { resolveNftMetadataUri } from "@bramble/portfolio/nft-token-metadata";
import { createPreferencesStore, type WalletPreferencesStore } from "@bramble/settings/preferences";
import { getNftOwnership, getNftTokenUri } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { createStarkscanClient } from "@bramble/transactions/starkscan";
import { createStarkscanNftSource } from "@bramble/transactions/starkscan-nfts";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import {
  starkscanPage,
  starkscanPosition,
} from "../../packages/features/transactions/tests/support/starkscan-nft-fixture";
import {
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "../../tests/support/background-wallet-stub";
import { makeRuntimeRpc } from "../../tests/support/runtime-rpc-stub";
import {
  type Answer,
  byteArrayReply,
  type Contracts,
  ERC721,
  ERC1155,
  type HttpExchange,
  type HttpReply,
  LEGACY721,
  NOT_NFT,
  parityAccount,
  plain,
  STRANGER,
  u256Reply,
  withNode,
} from "./shared";

const STARKSCAN_BASE = "https://starkscan.co/v1";
const ok = (result: unknown): Answer => ({ result });

/** One background: the handler, its stores, and what it recorded over HTTP. */
export type Background = Awaited<ReturnType<typeof createBackground>>;

/**
 * The real handler for `account` (active, unlocked at clock 1 000), with `rpc` laid over the
 * production NFT readers; HTTP is answered by `http` and recorded.
 */
export const createBackground = async (setup: {
  readonly account: DerivedAccountRef;
  readonly http?: (url: string) => HttpReply;
  readonly preferences?: (store: WalletPreferencesStore) => Promise<unknown>;
  readonly rpc?: Partial<RuntimeRpc>;
  readonly signHash?: Parameters<typeof createMessageHandler>[0]["signHash"];
  readonly locked?: boolean;
}) => {
  const httpExchanges: HttpExchange[] = [];
  const http = recordingHttpFor(setup.http, httpExchanges);
  const stub = createWallet({
    accounts: [setup.account],
    activeAccountId: () => setup.account.id,
    grantAccountIds: [setup.account.id],
  });
  const wallet = setup.signHash ? { ...stub, signHash: setup.signHash } : stub;
  const session = createUnlockSession({ now: () => 1_000, ttlMs: 60 * 60 * 1000 });
  if (!setup.locked) session.unlock(vaultPassphrase);
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork(setup.account.networkId);
  await setup.preferences?.(preferencesStore);
  const activity = memoryActivityLog(() => 1_000);
  const handler = createMessageHandler(wallet, testExtension, {
    activity,
    preferencesStore,
    runtimeRpc: makeRuntimeRpc({
      getNftMetadata: async (input) => resolveNftMetadataUri(await getNftTokenUri(input), http),
      getNftOwnership,
      nftIndexer: createHttpNftIndexer(
        http,
        createStarkscanNftSource({
          client: createStarkscanClient({ baseUrl: STARKSCAN_BASE, http }),
          readPreferences: () => preferencesStore.read(),
        }),
      ),
      ...setup.rpc,
    }),
    session,
  });
  return { activity, handler, httpExchanges, preferencesStore, session };
};

const recordingHttpFor =
  (replies: ((url: string) => HttpReply) | undefined, into: HttpExchange[]) =>
  async (url: string, init: RequestInit): Promise<Response> => {
    const { signal: _signal, ...rest } = init;
    const reply = replies?.(url) ?? "transport";
    into.push({ reply, request: { init: plain(rest) as Record<string, unknown>, url } });
    if (reply === "transport") throw new TypeError("fetch failed");
    const text = reply.raw ? String(reply.body) : JSON.stringify(reply.body);
    return new Response(text, {
      headers: { "content-type": "application/json", ...reply.headers },
      status: reply.status ?? 200,
    });
  };

/** The watched list a background holds now. */
export const watchedNow = async (background: Background) =>
  plain((await background.preferencesStore.read()).nfts ?? []);

const metadataUri = (value: object) =>
  `data:application/json,${encodeURIComponent(JSON.stringify(value))}`;

type DiscoverCase = {
  readonly name: string;
  readonly message?: Record<string, unknown>;
  readonly contracts: Contracts;
  readonly http?: (url: string) => HttpReply;
  readonly preferences?: (store: WalletPreferencesStore) => Promise<unknown>;
  readonly locked?: boolean;
};

const runDiscover = async (owner: DerivedAccountRef, one: DiscoverCase) => {
  const background = await createBackground({
    account: owner,
    ...(one.http ? { http: one.http } : {}),
    ...(one.locked ? { locked: true } : {}),
    ...(one.preferences ? { preferences: one.preferences } : {}),
  });
  const watched = await watchedNow(background);
  const message = { type: "wallet.discoverNfts", ...one.message };
  const { exchanges, result } = await withNode(one.contracts, () =>
    background.handler(message, extensionSender),
  );
  return {
    account: { address: owner.address, id: owner.id, networkId: owner.networkId },
    exchanges,
    http: background.httpExchanges,
    message,
    name: one.name,
    reply: plain(result),
    watched,
  };
};

/** The `discover` block (Mainnet, the phrase's account 0). */
export const computeDiscover = async () => {
  const { account: owner } = await parityAccount("SN_MAIN", 0);
  const pageFor = (items: unknown[]) => ({
    body: starkscanPage(items, { ownerAddress: owner.address }),
  });
  const starkscan =
    (items: unknown[]) =>
    (url: string): HttpReply =>
      url.startsWith(STARKSCAN_BASE) ? pageFor(items) : "transport";
  const chain: Contracts = {
    [ERC721]: { owner_of: ok([owner.address]) },
    [LEGACY721]: { ownerOf: ok([STRANGER]) },
    [ERC1155]: {
      balance_of: ok(u256Reply(2n)),
      uri: ok(byteArrayReply(metadataUri({ image: "ipfs://bafy/{id}.png", name: "Sword" }))),
    },
  };
  const watch =
    (contract: string, tokenId: string, extra: Record<string, unknown> = {}) =>
    async (store: WalletPreferencesStore) =>
      store.addNft({ contract, networkId: "SN_MAIN", owner: owner.address, tokenId, ...extra });
  const both =
    (...writes: ((store: WalletPreferencesStore) => Promise<unknown>)[]) =>
    async (store: WalletPreferencesStore) => {
      for (const write of writes) await write(store);
    };
  const items = [
    starkscanPosition("1", { tokenAddress: ERC721 }),
    starkscanPosition("2", { tokenAddress: LEGACY721 }),
    starkscanPosition("3", { tokenAddress: NOT_NFT }),
  ];
  const CASES: readonly DiscoverCase[] = [
    {
      contracts: chain,
      http: starkscan(items.slice(0, 2)),
      name: "Starkscan candidates re-proved: owned kept, someone else's dropped",
    },
    {
      contracts: chain,
      http: starkscan(items),
      name: "a candidate whose ownership read fails makes a complete list incomplete",
    },
    {
      contracts: chain,
      http: starkscan([starkscanPosition("1", { tokenAddress: ERC721 })]),
      name: "watched NFTs merge after the indexer's, with metadata for watched ones only",
      preferences: both(
        watch(ERC1155, "5", { label: "Sword" }),
        watch(ERC721, "1", { label: "Also indexed" }),
        watch(LEGACY721, "2"),
        watch(ERC721, "9", { spam: true }),
      ),
    },
    {
      contracts: chain,
      http: starkscan([starkscanPosition("1", { tokenAddress: ERC721 })]),
      message: { includeWatched: false },
      name: "the indexed lane alone: watched ids left out, no metadata",
      preferences: watch(ERC721, "1"),
    },
    {
      contracts: {
        ...chain,
        [ERC721]: {
          owner_of: ok([owner.address]),
          token_uri: ok(byteArrayReply("http://insecure.example/1.json")),
        },
      },
      http: starkscan([]),
      name: "a watched NFT whose metadata is refused is marked art unavailable",
      preferences: watch(ERC721, "1"),
    },
    {
      contracts: chain,
      http: starkscan(items),
      name: "NFTs turned off: no indexer request, watched NFTs still re-proved",
      preferences: both(
        (store) => store.setDisplay({ collectiblesPreview: false }),
        watch(ERC721, "1"),
      ),
    },
    {
      contracts: chain,
      http: (url) =>
        url.startsWith("https://indexer.example")
          ? {
              body: [
                { contract_address: ERC721, token_id: "1" },
                { contract_address: ERC1155, token_id: 5 },
              ],
            }
          : "transport",
      name: "a saved indexer URL replaces Starkscan",
      preferences: (store) => store.setNftIndexerUrl({ url: "https://indexer.example/api" }),
    },
    {
      contracts: chain,
      http: () => ({ body: { error: "busy" }, status: 503 }),
      name: "Starkscan unavailable: watched NFTs still shown",
      preferences: watch(ERC721, "1"),
    },
    {
      contracts: chain,
      http: starkscan(items),
      locked: true,
      name: "locked",
    },
  ];
  const cases = [];
  for (const one of CASES) cases.push(await runDiscover(owner, one));
  return cases;
};

type AddCase = {
  readonly name: string;
  readonly message: Record<string, unknown>;
  readonly contracts: Contracts;
};

/** The `addNft` block (Sepolia, the phrase's account 0). */
export const computeAddNft = async () => {
  const { account: owner } = await parityAccount("SN_SEPOLIA", 0);
  const mine: Contracts = {
    [ERC721]: { owner_of: ok([owner.address]) },
    [LEGACY721]: { ownerOf: ok([STRANGER]) },
    [ERC1155]: { balance_of: ok(u256Reply(1n)) },
  };
  const add = (over: Record<string, unknown>) => ({
    contract: ERC721,
    networkId: "SN_SEPOLIA",
    tokenId: "7",
    type: "wallet.addNft",
    ...over,
  });
  const CASES: readonly AddCase[] = [
    {
      contracts: mine,
      message: add({ label: "  Punk  " }),
      name: "an owned ERC-721, label trimmed",
    },
    {
      contracts: mine,
      message: add({ contract: ERC1155, tokenId: "3" }),
      name: "an owned ERC-1155",
    },
    {
      contracts: mine,
      message: add({ contract: `0x00${ERC721.slice(2).toUpperCase()}` }),
      name: "an uppercase contract is refused",
    },
    { contracts: mine, message: add({ contract: LEGACY721 }), name: "someone else's NFT" },
    {
      contracts: { [ERC1155]: { balance_of: ok(u256Reply(0n)) } },
      message: add({ contract: ERC1155 }),
      name: "an ERC-1155 balance of 0",
    },
    { contracts: {}, message: add({ contract: NOT_NFT }), name: "not an NFT contract" },
    { contracts: mine, message: add({ networkId: "SN_MAIN" }), name: "another network" },
    { contracts: mine, message: add({ tokenId: "0x7" }), name: "a hex token id" },
    { contracts: mine, message: add({ label: "x".repeat(65) }), name: "a label past 64" },
    { contracts: mine, message: add({ contract: "0x0" }), name: "a zero contract" },
    { contracts: mine, message: add({ extra: 1 }), name: "an unknown key" },
  ];
  const cases = [];
  for (const one of CASES) {
    const background = await createBackground({ account: owner });
    const { exchanges, result } = await withNode(one.contracts, () =>
      background.handler(one.message, extensionSender),
    );
    cases.push({
      account: { address: owner.address, id: owner.id, networkId: owner.networkId },
      exchanges,
      message: one.message,
      name: one.name,
      reply: {
        ...("error" in (result as object)
          ? { error: (result as { error: string }).error }
          : { ok: true }),
      },
      watched: await watchedNow(background),
    });
  }
  return cases;
};
