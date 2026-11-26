/**
 * The `request` block: a page's `(method, params)` read as the extension reads it, through both
 * of its stages. The page script's `readProviderRequestArguments` (`provider/inpage.ts`) refuses
 * an unknown method or params over the method's JSON budget with INVALID_REQUEST_PAYLOAD and
 * `data: "invalid provider request"`; the content script's `toRuntimeMessage`
 * (`content/index.ts`) refuses a well-budgeted request its method's grammar rejects with the same
 * code and no `data`; anything else becomes the runtime message the background receives, written
 * here without its `origin` and `type`.
 *
 * `hostile` cases name their params by a builder (`build`) rather than inline, so a megabyte of
 * params costs one line; `bytes` is the length of the JSON text the builder yields.
 */
import type { Json } from "@bramble/core/json";
import {
  readProviderRequest,
  readProviderRequestArguments,
  toRuntimeMessage,
} from "@bramble/wallet-protocol/bridge";
import { invalidRequestPayload } from "@bramble/wallet-protocol/rpc-errors";
import { ACCOUNT, MAINNET_CHAIN_ID, SEPOLIA_CHAIN_ID, SITE } from "./shared";

/** A hostile params value, by shape and size. */
type Build =
  | { readonly kind: "nest"; readonly depth: number }
  | { readonly kind: "array"; readonly length: number }
  | { readonly kind: "string"; readonly length: number }
  | { readonly kind: "keys"; readonly count: number }
  | { readonly kind: "strings"; readonly count: number; readonly length: number }
  | { readonly kind: "grid"; readonly rows: number; readonly columns: number };

/** The value `build` names; the Rust replay builds the same JSON text. */
const built = (build: Build): Json => {
  switch (build.kind) {
    case "nest":
      return JSON.parse(`${"[".repeat(build.depth)}${"]".repeat(build.depth)}`) as Json;
    case "array":
      return Array.from({ length: build.length }, () => 0);
    case "string":
      return "a".repeat(build.length);
    case "keys":
      return Object.fromEntries(Array.from({ length: build.count }, (_, i) => [`k${i}`, 0]));
    case "strings":
      return Array.from({ length: build.count }, () => "a".repeat(build.length));
    case "grid":
      return Array.from({ length: build.rows }, () =>
        Array.from({ length: build.columns }, () => 0),
      );
  }
};

/** Where `build` goes in the params: as them, or under one key beside fixed siblings. */
type Hostile = {
  readonly name: string;
  readonly method: string;
  readonly build: Build;
  readonly at?: readonly string[];
};

type Plain = { readonly name: string; readonly method: string; readonly params?: Json };

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const call = { calldata: ["0x1", "2"], contract_address: STRK, entry_point: "transfer" };
const camelCall = { calldata: [], contractAddress: STRK, entrypoint: "approve" };
const chain = {
  chain_id: "0x534e5f5345504f4c49415f32",
  chain_name: "  My Testnet ",
  id: " my-testnet",
  rpc_urls: ["https://rpc.example/v0_10"],
};
const typedData = {
  domain: { chainId: "SN_SEPOLIA", name: "Bramble Test", revision: "1", version: "1" },
  message: { content: "hello" },
  primaryType: "Mail",
  types: {
    Mail: [{ name: "content", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "shortstring" },
      { name: "version", type: "shortstring" },
      { name: "chainId", type: "shortstring" },
      { name: "revision", type: "shortstring" },
    ],
  },
};
const declare = {
  class_hash: "0x1",
  compiled_class_hash: "0x2",
  contract_class: { abi: "[]", sierra_program: ["0x1"] },
};

const PLAIN: readonly Plain[] = [
  { method: "wallet_unknownMethod", name: "an unknown method" },
  { method: "eth_requestAccounts", name: "an Ethereum method" },
  { method: "wallet_requestAccounts", name: "requestAccounts with no params" },
  { method: "wallet_requestAccounts", name: "requestAccounts with null params", params: null },
  {
    method: "wallet_requestAccounts",
    name: "requestAccounts silent",
    params: { api_version: "0.10.5", silent_mode: true },
  },
  {
    method: "wallet_requestAccounts",
    name: "requestAccounts silent false",
    params: { silent_mode: false },
  },
  {
    method: "wallet_requestAccounts",
    name: "requestAccounts with a string silent_mode",
    params: { silent_mode: "true" },
  },
  {
    method: "wallet_requestAccounts",
    name: "requestAccounts with an unknown key",
    params: { extra: 1 },
  },
  {
    method: "wallet_requestAccounts",
    name: "requestAccounts with a pre-release api_version",
    params: { api_version: "0.10.5-rc.1" },
  },
  { method: "wallet_requestAccounts", name: "requestAccounts with an array", params: [] },
  { method: "mc_requestAccounts", name: "mc_requestAccounts with no params" },
  { method: "mc_requestAccounts", name: "mc_requestAccounts with params", params: {} },
  { method: "mc_accounts", name: "mc_accounts with no params" },
  { method: "mc_accounts", name: "mc_accounts with params", params: { silent_mode: true } },
  { method: "mc_strk20Register", name: "mc_strk20Register with no params" },
  { method: "wallet_getPermissions", name: "getPermissions with no params" },
  {
    method: "wallet_getPermissions",
    name: "getPermissions with an api_version",
    params: { api_version: "0.10" },
  },
  {
    method: "wallet_getPermissions",
    name: "getPermissions with a numeric api_version",
    params: { api_version: 10 },
  },
  { method: "wallet_requestChainId", name: "requestChainId with no params" },
  {
    method: "wallet_requestChainId",
    name: "requestChainId with an unknown key",
    params: { chain: 1 },
  },
  {
    method: "wallet_supportedSpecs",
    name: "supportedSpecs echoing an api_version",
    params: { api_version: "0.9.0" },
  },
  { method: "wallet_supportedWalletApi", name: "supportedWalletApi with no params" },
  { method: "wallet_deploymentData", name: "deploymentData with empty params", params: {} },
  {
    method: "wallet_switchStarknetChain",
    name: "switch to mainnet",
    params: { chainId: MAINNET_CHAIN_ID },
  },
  {
    method: "wallet_switchStarknetChain",
    name: "switch to sepolia, silent",
    params: { api_version: "0.10.5", chainId: SEPOLIA_CHAIN_ID, silent_mode: true },
  },
  {
    method: "wallet_switchStarknetChain",
    name: "switch with an uppercase chain id",
    params: { chainId: "0x534E5F4D41494E" },
  },
  {
    method: "wallet_switchStarknetChain",
    name: "switch with a short-string chain id",
    params: { chainId: "SN_MAIN" },
  },
  { method: "wallet_switchStarknetChain", name: "switch with no params" },
  {
    method: "wallet_switchStarknetChain",
    name: "switch with snake_case chain_id",
    params: { chain_id: MAINNET_CHAIN_ID },
  },
  {
    method: "wallet_signTypedData",
    name: "typed data under typed_data",
    params: { api_version: "0.10.5", typed_data: typedData },
  },
  {
    method: "wallet_signTypedData",
    name: "typed data under typedData",
    params: { typedData },
  },
  { method: "wallet_signTypedData", name: "typed data bare", params: typedData },
  {
    method: "wallet_signTypedData",
    name: "typed data bare beside an api_version",
    params: { ...typedData, api_version: "0.10.5" },
  },
  {
    method: "wallet_signTypedData",
    name: "typed data with a bad api_version",
    params: { api_version: "latest", typed_data: typedData },
  },
  {
    method: "wallet_signTypedData",
    name: "typed data null under typed_data",
    params: { typed_data: null },
  },
  { method: "wallet_signTypedData", name: "typed data as a number", params: 7 },
  { method: "wallet_signTypedData", name: "typed data with no params" },
  {
    method: "wallet_addInvokeTransaction",
    name: "invoke under invoke_transaction",
    params: { invoke_transaction: [call] },
  },
  {
    method: "wallet_addInvokeTransaction",
    name: "invoke under legacy calls, camelCase",
    params: { calls: [camelCall] },
  },
  {
    method: "wallet_addInvokeTransaction",
    name: "invoke with both lists",
    params: { calls: [call], invoke_transaction: [call] },
  },
  {
    method: "wallet_addInvokeTransaction",
    name: "invoke with no calls",
    params: { invoke_transaction: [] },
  },
  {
    method: "wallet_addInvokeTransaction",
    name: "invoke to the zero address",
    params: { invoke_transaction: [{ ...call, contract_address: "0x0" }] },
  },
  {
    method: "wallet_addInvokeTransaction",
    name: "invoke with a bad entrypoint",
    params: { invoke_transaction: [{ ...call, entry_point: "trans fer" }] },
  },
  {
    method: "wallet_addInvokeTransaction",
    name: "invoke with a decimal calldata felt",
    params: { invoke_transaction: [{ ...call, calldata: ["123456789"] }] },
  },
  {
    method: "wallet_addInvokeTransaction",
    name: "invoke with a felt past the field",
    params: { invoke_transaction: [{ ...call, calldata: [`0x${"f".repeat(64)}`] }] },
  },
  {
    method: "wallet_addInvokeTransaction",
    name: "invoke with a null proof",
    params: { invoke_transaction: [call], proof: null },
  },
  {
    method: "wallet_addInvokeTransaction",
    name: "invoke with a malformed proof",
    params: { invoke_transaction: [call], proof: { data: 1 } },
  },
  {
    method: "wallet_addInvokeTransaction",
    name: "invoke with a well-formed proof",
    params: { invoke_transaction: [call], proof: { data: "", output: [], proof_facts: [] } },
  },
  {
    method: "wallet_addDeclareTransaction",
    name: "declare with a class hash",
    params: { declare_transaction: declare },
  },
  {
    method: "wallet_addDeclareTransaction",
    name: "declare with an empty contract class",
    params: { declare_transaction: { ...declare, contract_class: {} } },
  },
  {
    method: "wallet_addDeclareTransaction",
    name: "declare with a null class hash",
    params: { declare_transaction: { ...declare, class_hash: null } },
  },
  { method: "wallet_addStarknetChain", name: "add a chain", params: chain },
  {
    method: "wallet_addStarknetChain",
    name: "add a chain with every list",
    params: {
      ...chain,
      block_explorer_url: ["https://explorer.example"],
      icon_urls: ["https://icons.example/c.png"],
      native_currency: { address: STRK, metadata: {}, type: "ERC20" },
    },
  },
  {
    method: "wallet_addStarknetChain",
    name: "add a chain named Starknet Mainnet",
    params: { ...chain, chain_name: " starknet   MAINNET " },
  },
  {
    method: "wallet_addStarknetChain",
    name: "add a chain with five rpc urls",
    params: { ...chain, rpc_urls: [1, 2, 3, 4, 5].map((n) => `https://rpc${n}.example`) },
  },
  {
    method: "wallet_addStarknetChain",
    name: "add a chain with an http rpc url",
    params: { ...chain, rpc_urls: ["http://rpc.example"] },
  },
  {
    method: "wallet_addStarknetChain",
    name: "add a chain with a zero chain id",
    params: { ...chain, chain_id: "0x0" },
  },
  {
    method: "wallet_addStarknetChain",
    name: "add a chain with an uppercase chain id",
    params: { ...chain, chain_id: "0x534E5F5345504F4C49415F32" },
  },
  {
    method: "wallet_addStarknetChain",
    name: "add a chain with a string native currency",
    params: { ...chain, native_currency: "STRK" },
  },
  {
    method: "wallet_watchAsset",
    name: "watch an ERC-20",
    params: {
      options: { address: STRK, decimals: 18, image: "https://x.example/i.png", symbol: "STRK" },
      type: "ERC20",
    },
  },
  {
    method: "wallet_watchAsset",
    name: "watch an ERC-20 with 37 decimals",
    params: { options: { address: STRK, decimals: 37 }, type: "ERC20" },
  },
  {
    method: "wallet_watchAsset",
    name: "watch an ERC-20 with a numeric image",
    params: { options: { address: STRK, image: 1 }, type: "ERC20" },
  },
  {
    method: "wallet_watchAsset",
    name: "watch an ERC-20 at the zero address",
    params: { options: { address: "0x0" }, type: "ERC20" },
  },
  {
    method: "wallet_watchAsset",
    name: "watch an ERC-721 by hex token id",
    params: { options: { address: ACCOUNT, name: "Item", tokenId: "0x2a" }, type: "ERC721" },
  },
  {
    method: "wallet_watchAsset",
    name: "watch an ERC-1155 by decimal token id",
    params: { options: { address: ACCOUNT, tokenId: "42" }, type: "ERC1155" },
  },
  {
    method: "wallet_watchAsset",
    name: "watch an ERC-721 with a token id past u256",
    params: { options: { address: ACCOUNT, tokenId: `0x1${"0".repeat(64)}` }, type: "ERC721" },
  },
  {
    method: "wallet_watchAsset",
    name: "watch an unknown asset type",
    params: { options: { address: STRK }, type: "ERC4626" },
  },
  { method: "wallet_strk20Balances", name: "a STRK20 method", params: { tokens: [] } },
];

// Each budget's limit on both sides of its edge, where the method's grammar accepts the shape
// (`wallet_signTypedData` takes any non-null params), and refusals elsewhere.
const HOSTILE: readonly Hostile[] = [
  ...[23, 24, 25].map((depth) => ({
    build: { depth, kind: "nest" } as const,
    method: "wallet_signTypedData",
    name: `typed data nested ${depth} deep`,
  })),
  ...[1024, 1025].map((length) => ({
    build: { kind: "array", length } as const,
    method: "wallet_signTypedData",
    name: `typed data array of ${length}`,
  })),
  ...[65_536, 65_537].map((length) => ({
    build: { kind: "string", length } as const,
    method: "wallet_signTypedData",
    name: `typed data string of ${length}`,
  })),
  ...[512, 513].map((count) => ({
    build: { count, kind: "keys" } as const,
    method: "wallet_signTypedData",
    name: `typed data object of ${count} keys`,
  })),
  ...[4, 5].map((count) => ({
    build: { count, kind: "strings", length: 60_000 } as const,
    method: "wallet_signTypedData",
    name: `typed data of ${count} strings of 60000`,
  })),
  ...[9, 10].map((rows) => ({
    build: { columns: 1000, kind: "grid", rows } as const,
    method: "wallet_signTypedData",
    name: `typed data grid of ${rows} by 1000`,
  })),
  {
    build: { depth: 40, kind: "nest" },
    method: "wallet_requestAccounts",
    name: "requestAccounts nested 40 deep",
  },
  {
    build: { count: 2_049, kind: "keys" },
    method: "wallet_getPermissions",
    name: "getPermissions with 2049 keys",
  },
  {
    build: { count: 3, kind: "strings", length: 400_000 },
    method: "wallet_requestChainId",
    name: "requestChainId over a mebibyte",
  },
  {
    at: ["declare_transaction", "contract_class", "program"],
    build: { depth: 40, kind: "nest" },
    method: "wallet_addDeclareTransaction",
    name: "a contract class nested 40 deep",
  },
  {
    at: ["declare_transaction", "contract_class", "program"],
    build: { depth: 70, kind: "nest" },
    method: "wallet_addDeclareTransaction",
    name: "a contract class nested 70 deep",
  },
  {
    at: ["proof"],
    build: { depth: 20, kind: "nest" },
    method: "wallet_addInvokeTransaction",
    name: "an invoke proof nested 20 deep",
  },
  {
    at: ["proof"],
    build: { count: 40, kind: "keys" },
    method: "wallet_addInvokeTransaction",
    name: "an invoke proof of 40 keys",
  },
];

/** `value` placed at `path` inside the fixed params a hostile case's method needs. */
const placed = (method: string, at: readonly string[] | undefined, value: Json): Json => {
  if (!at) return value;
  const base: Record<string, Json> =
    method === "wallet_addDeclareTransaction"
      ? { declare_transaction: { ...declare, contract_class: { abi: "[]" } } }
      : { invoke_transaction: [call] };
  const root = structuredClone(base);
  let cursor = root as Record<string, Json>;
  for (const key of at.slice(0, -1)) cursor = cursor[key] as Record<string, Json>;
  cursor[at[at.length - 1] ?? ""] = value;
  return root;
};

const REQUEST_ID = "00000000-0000-4000-8000-000000000000";

/** The page's outcome for one request, through both of the extension's stages. */
const outcome = (method: string, params: Json | undefined) => {
  const raw = params === undefined ? { method } : { method, params };
  const args = readProviderRequestArguments(raw);
  if (!args) return { error: invalidRequestPayload("invalid provider request"), stage: "page" };
  const request = readProviderRequest({ ...args, id: REQUEST_ID, target: "bramble:content" });
  const message = request ? toRuntimeMessage(request, SITE) : null;
  if (!message) return { error: invalidRequestPayload(), stage: "bridge" };
  const { origin: _origin, type, ...rest } = message as { origin: string; type: string };
  return { message: rest, runtimeType: type, stage: "admitted" };
};

/** Every request case: its params (or builder) and the page's outcome. */
export const computeRequests = (): readonly object[] => [
  ...PLAIN.map(({ method, name, params }) => ({
    method,
    name,
    ...(params === undefined ? {} : { params }),
    ...outcome(method, params),
  })),
  ...HOSTILE.map(({ at, build, method, name }) => {
    const value = built(build);
    const params = placed(method, at, value);
    // An admitted hostile value is the builder's own; only where it went is kept.
    const { message: _built, ...read } = outcome(method, params) as { message?: unknown };
    return {
      ...(at ? { at, base: placed(method, at, null) } : {}),
      build,
      bytes: JSON.stringify(params).length,
      method,
      name,
      ...read,
    };
  }),
];
