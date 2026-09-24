/**
 * Token parity blocks: ids and validators, the curated registry and spam heuristics, Home's
 * visible list, token glyphs, the real add-token handler over scripted metadata replies, and
 * `getTokenBalances` over scripted balance replies.
 */
import { unavailablePriceService } from "@bramble/portfolio/prices";
import { knownTokensForNetwork, tokenSpamReasons } from "@bramble/portfolio/token-registry";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { getTokenBalances, getTokenMetadata } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import {
  canonicalAddress,
  DEFAULT_TOKENS,
  normalizeFeltInput,
} from "@bramble/wallet-model/networks";
import { isTokenConfig, withTokenId } from "@bramble/wallet-model/preferences";
import type { RpcProvider } from "starknet";
import { handleTokenOps } from "../../apps/extension/src/background/portfolio/token-ops";
import {
  unifiedHomeBalances,
  visibleHomeBalances,
} from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/home-tabs";
import { tokenGlyph } from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/token-row";
import { readGlyph } from "./shared";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const USDC_ALIAS = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

/** A scripted JSON-RPC answer: a result, a node error code, or a transport failure. */
export type Scripted = { readonly result: unknown } | { readonly code: number } | "transport";

// Every run gets endpoints no earlier run touched, so `withRpcFallback`'s process-wide endpoint
// cooldowns can never make one case's outcome depend on another's.
let endpointCounter = 0;
const freshEndpoint = (): string => {
  endpointCounter += 1;
  return `https://parity-${endpointCounter}.invalid/rpc`;
};

const answer = async (scripted: Scripted | undefined): Promise<string[]> => {
  if (scripted === undefined || scripted === "transport") {
    throw new TypeError("fetch failed");
  }
  if ("code" in scripted) {
    throw Object.assign(new Error("node error"), {
      baseError: { code: scripted.code, message: "error" },
    });
  }
  return scripted.result as string[];
};

const fakeProvider =
  (reply: (call: { contractAddress: string; entrypoint: string }) => Scripted | undefined) =>
  (): RpcProvider =>
    ({
      callContract: (call: { contractAddress: string; entrypoint: string }) => answer(reply(call)),
    }) as unknown as RpcProvider;

/** Ids, validators, registry, spam, Home rows and glyphs. */
export const tokensBlock = () => {
  const candidate = (over: Record<string, unknown>) => ({
    address: "0xdead",
    decimals: 18,
    name: "Token",
    networkId: "SN_MAIN",
    symbol: "TOK",
    ...over,
  });
  const spam = [
    candidate({ address: USDC_ALIAS, decimals: 6, name: "USD Coin", symbol: "USDC" }),
    candidate({ address: "0xbadc0de", decimals: 6, name: "USD Coin", symbol: "USDC" }),
    candidate({ address: "0xbeef", decimals: 8, name: "Airdrop", symbol: "VVBTC" }),
    candidate({ address: "0xbeed", decimals: 6, name: "Airdrop", symbol: "VSDC" }),
    candidate({ address: "0xbeef", name: "Airdrop", symbol: "5TRK" }),
    candidate({ address: STRK, name: "Starknet Token", symbol: "STRK" }),
    candidate({ address: "0xabc", decimals: 30, name: "Weird", symbol: "WEIRD" }),
    candidate({ address: "0xabc", name: "   ", symbol: "GHOST" }),
    candidate({
      address: "0x0033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
      decimals: 6,
      name: "USD Coin",
      symbol: "USDC",
    }),
    candidate({ address: "0xabc", networkId: "SN_SEPOLIA", symbol: "STRK" }),
    candidate({ address: "0xabc", name: "", symbol: "rnETH", decimals: 25 }),
  ];
  const config = withTokenId({
    address: STRK,
    decimals: 18,
    name: "Starknet Token",
    networkId: "SN_MAIN",
    symbol: "STRK",
  });
  const configs = [
    config,
    { ...config, address: "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d" },
    { ...config, symbol: "strk" },
    { ...config, name: " " },
    { ...config, name: "x".repeat(65) },
    { ...config, decimals: 37 },
    { ...config, decimals: 1.5 },
    { ...config, extra: true },
    { ...config, id: "SN_MAIN:STRK:0x1" },
    { ...config, networkId: "SN_DEVNET", id: `SN_DEVNET:STRK:${STRK}` },
  ];
  const custom = withTokenId({
    address: "0x0123",
    decimals: 6,
    name: "Custom",
    networkId: "SN_MAIN",
    symbol: "CUST",
  });
  const spoof = withTokenId({
    address: "0x0456",
    decimals: 6,
    name: "Fake",
    networkId: "SN_MAIN",
    symbol: "USDC",
  });
  const tracked = [...DEFAULT_TOKENS.map(withTokenId), custom, spoof];
  const preferences = { hiddenTokens: [custom.id], tokens: tracked };
  const balance = (token: (typeof tracked)[number], formatted: string) => ({
    ...token,
    balance: "1",
    formatted,
  });
  const loaded = {
    balances: [
      balance(tracked[0] as (typeof tracked)[number], "1"),
      balance(custom, "5"),
      balance(spoof, "100"),
      balance(tracked[1] as (typeof tracked)[number], "2"),
      balance(
        withTokenId({
          address: "0x0789",
          decimals: 6,
          name: "Loose",
          networkId: "SN_MAIN",
          symbol: "LOOSE",
        }),
        "3",
      ),
    ],
  };
  const privacy = { error: null, loading: false, value: null };
  return {
    addAddress: [
      "0x4718F5A0FC34CC1AF16A1CDEE98FFB20C31F5CD61D6AB07201858F4287C938D",
      "  0x0abc  ",
      "0XABC",
      "4718",
      "0x0",
      "0x",
      "hello",
      `0x${"f".repeat(64)}`,
    ].map((input) => ({
      input,
      out: canonicalAddress(normalizeFeltInput(input)),
    })),
    configs: configs.map((value) => ({ out: isTokenConfig(value), value })),
    defaults: DEFAULT_TOKENS.filter((t) => t.networkId !== "SN_DEVNET").map(withTokenId),
    glyphs: [
      [STRK, "STRK"],
      [ETH, "ETH"],
      ["0x7", "ABCDE"],
      ["0x8", "ab"],
      ["-5", "NEG"],
      ["nope", "X"],
      ["0x0", "TOKEN"],
      [` ${USDC_ALIAS.toUpperCase().replace("0X", "0x")}`, "USDC"],
    ].map(([address, symbol]) => ({
      address,
      out: readGlyph(tokenGlyph(String(address), String(symbol))),
      symbol,
    })),
    home: {
      balances: loaded.balances,
      hidden: preferences.hiddenTokens,
      notShown:
        loaded.balances.length - visibleHomeBalances(loaded as never, preferences as never).length,
      tracked,
      visible: unifiedHomeBalances(loaded as never, privacy, preferences as never).map((b) => b.id),
    },
    ids: [
      ["SN_MAIN", "STRK", "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"],
      ["SN_SEPOLIA", "ETH", ETH.toUpperCase().replace("0X", "0x")],
      ["SN_MAIN", "BAD", "not-a-felt"],
    ].map(([networkId, symbol, address]) => ({
      address,
      networkId,
      out: withTokenId({
        address: String(address),
        decimals: 18,
        name: "x",
        networkId: networkId as "SN_MAIN",
        symbol: String(symbol),
      }).id,
      symbol,
    })),
    registry: {
      SN_MAIN: knownTokensForNetwork("SN_MAIN"),
      SN_SEPOLIA: knownTokensForNetwork("SN_SEPOLIA"),
    },
    spam: spam.map((c) => ({ candidate: c, out: tokenSpamReasons(c as never) })),
  };
};

type MetaCase = {
  readonly address: string;
  readonly decimals: Scripted;
  readonly name: Scripted;
  readonly symbol: Scripted;
};

/** The real `wallet.addToken` handler over scripted `name`/`symbol`/`decimals` replies. */
export const tokenMetaBlock = async () => {
  const address = "0x0000000000000000000000000000000000000000000000000000000000000abc";
  const ok = (values: readonly string[]): Scripted => ({ result: values });
  const cases: MetaCase[] = [
    { address, decimals: ok(["0x12"]), name: ok(["0x4d7920546f6b656e"]), symbol: ok(["0x4d544b"]) },
    {
      address,
      decimals: ok(["0x6"]),
      name: ok(["0x1", "0x48656c6c6f20576f726c6420546f6b656e206e616d652031", "0x32", "0x1"]),
      symbol: ok(["0x0", "0x757364632e65", "0x6"]),
    },
    {
      address,
      decimals: ok(["0x6"]),
      name: ok(["0x55534420436f696e"]),
      symbol: ok(["0x55534443"]),
    },
    {
      address,
      decimals: ok(["0x12"]),
      name: ok(["0x3c62616420746f6b656e3e"]),
      symbol: ok(["0x6d746b"]),
    },
    { address, decimals: ok(["0x12"]), name: ok(["0x0"]), symbol: ok(["0x414243"]) },
    { address, decimals: ok(["0x12"]), name: ok(["0x414243"]), symbol: ok(["0x414"]) },
    { address, decimals: ok(["0x12"]), name: ok(["0x414243"]), symbol: ok(["0x2d2d"]) },
    { address, decimals: ok(["0x12"]), name: ok(["0x414243"]), symbol: ok(["0xdf"]) },
    { address, decimals: ok(["0x25"]), name: ok(["0x414243"]), symbol: ok(["0x414243"]) },
    { address, decimals: ok(["0x19"]), name: ok(["0x414243"]), symbol: ok(["0x414243"]) },
    { address, decimals: ok(["18"]), name: ok(["0x414243"]), symbol: ok(["0x414243"]) },
    { address, decimals: ok([]), name: ok(["0x414243"]), symbol: ok(["0x414243"]) },
    { address, decimals: ok(["0x12"]), name: { code: 21 }, symbol: ok(["0x414243"]) },
    {
      address,
      decimals: ok(["0x12"]),
      name: ok(["0x2", "0x41", "0x42"]),
      symbol: ok(["0x2020414243"]),
    },
    { address, decimals: ok(["0x12"]), name: ok(["0x414243"]), symbol: "transport" },
  ];
  const outputs = [];
  for (const c of cases) {
    const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
    const reply = ({ entrypoint }: { entrypoint: string }) =>
      entrypoint === "name" ? c.name : entrypoint === "symbol" ? c.symbol : c.decimals;
    const runtimeRpc = {
      getTokenMetadata: (input: { address: string; rpcUrls: readonly string[] }) =>
        getTokenMetadata({ ...input, rpcUrls: [freshEndpoint()] }, fakeProvider(reply)),
    };
    const response = (await handleTokenOps(
      {
        preferencesStore,
        prices: unavailablePriceService,
        runtimeRpc,
        session: {},
        wallet: {},
      } as never,
      "wallet.addToken",
      { address: c.address, type: "wallet.addToken" },
    )) as { error?: string; preferences?: { hiddenTokens?: string[]; tokens: { id: string }[] } };
    const token = response.preferences?.tokens.at(-1);
    outputs.push({
      ...c,
      out:
        response.error !== undefined
          ? { error: response.error }
          : { hidden: (response.preferences?.hiddenTokens ?? []).includes(token?.id ?? ""), token },
    });
  }
  return outputs;
};

/** `getTokenBalances` over scripted `balanceOf` replies. */
export const balancesBlock = async () => {
  const tokens = [
    withTokenId({
      address: STRK,
      decimals: 18,
      name: "Starknet Token",
      networkId: "SN_MAIN",
      symbol: "STRK",
    }),
    withTokenId({
      address: "0x0abc",
      decimals: 6,
      name: "Six",
      networkId: "SN_MAIN",
      symbol: "SIX",
    }),
  ];
  const cases: (readonly Scripted[])[] = [
    [{ result: ["0xde0b6b3a7640000", "0x0"] }, { result: ["0x0", "0x1"] }],
    [{ result: ["0x0", "0x0"] }, { result: ["1234567", "0"] }],
    [{ result: ["0x1"] }, { result: ["0x0", "0x0"] }],
    [{ result: [`0x1${"0".repeat(32)}`, "0x0"] }, { result: ["0x0", "0x0"] }],
    [{ code: 20 }, { result: ["0x0", "0x0"] }],
    [{ result: ["0x5", "0x0"] }, "transport"],
    [{ result: "12" }, { result: ["-1", "0x0"] }],
  ];
  const outputs = [];
  for (const replies of cases) {
    try {
      const balances = await getTokenBalances(
        { accountAddress: "0x1", rpcUrls: [freshEndpoint()], tokens },
        fakeProvider(
          ({ contractAddress }) => replies[tokens.findIndex((t) => t.address === contractAddress)],
        ),
      );
      outputs.push({
        out: {
          balances: balances.map((b) => ({ balance: b.balance, formatted: b.formatted, id: b.id })),
        },
        replies,
      });
    } catch (error) {
      const transport = error instanceof TypeError || (error as Error).name === "RpcTransportError";
      outputs.push({ out: { error: transport ? "transport" : "failed" }, replies });
    }
  }
  return { cases: outputs, tokens };
};
