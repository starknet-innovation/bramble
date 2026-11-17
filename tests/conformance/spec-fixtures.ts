/**
 * Shared fixtures, spec patterns, numeric error codes, and the `SpecMethod`
 * contract type for the wallet_rpc conformance suite. Split from
 * wallet-rpc-spec.ts (which holds the per-method table) to keep each file within
 * the repository size cap. Everything here is distilled from wallet_rpc.json.
 */

import type { Json } from "@bramble/core/json";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type {
  ProviderMethod,
  ProviderRequest,
  RuntimeMessage,
} from "@bramble/wallet-protocol/bridge";
import type { ProviderResultMethod } from "@bramble/wallet-protocol/results";
import { SUPPORTED_WALLET_API } from "@bramble/wallet-protocol/versions";

/** Spec PADDED_TXN_HASH: `0x` + 64 hex with a top nibble in 0-8 (felt < 2^252). */
export const PADDED_TXN_HASH = /^0x(0[0-8][a-f0-9]{62})$/;
/** Spec PADDED_FELT: `0x` + exactly 64 hex digits (fixed-width felt). */
export const PADDED_FELT = /^0x[a-f0-9]{64}$/;
/** Spec CHAIN_ID: a `0x`-prefixed hex felt. */
export const CHAIN_ID = /^0x[a-fA-F0-9]+$/;
/** Spec ADDRESS / FELT: a `0x`-prefixed hex value. */
export const ADDRESS = /^0x[0-9a-fA-F]+$/;
/** A SIGNATURE component felt as emitted on the wire (lowercased). */
export const SIGNATURE_FELT = /^0x[0-9a-f]+$/;

/** Numeric wallet_rpc error codes (wallet_rpc.json errors section). */
export const ERROR_CODES = {
  NOT_ERC20: 111,
  UNLISTED_NETWORK: 112,
  USER_REFUSED_OP: 113,
  INVALID_REQUEST_PAYLOAD: 114,
  ACCOUNT_ALREADY_DEPLOYED: 115,
  DEPLOYMENT_DATA_NOT_AVAILABLE: 116,
  CHAIN_ID_NOT_SUPPORTED: 117,
  NOT_REGISTERED: 118,
  INSUFFICIENT_PRIVATE_BALANCE: 119,
  PRIVACY_LEAK: 120,
  API_VERSION_NOT_SUPPORTED: 162,
  UNKNOWN_ERROR: 163,
} as const;

/** The origin every conformance request is attributed to. */
export const ORIGIN = "https://example.com";
/** A fixed UUID request id reused across the mapping assertions. */
export const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
/** SN_SEPOLIA CHAIN_ID (the harness active network). */
export const SEPOLIA_CHAIN_ID = "0x534e5f5345504f4c4941";
/** SN_MAIN CHAIN_ID (a supported target for wallet_switchStarknetChain). */
export const MAIN_CHAIN_ID = "0x534e5f4d41494e";
/** A well-formed STRK20 token / ERC20 asset ADDRESS. */
export const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
/** A well-formed STRK20 recipient ADDRESS (withdraw target / transfer payee). */
export const RECIPIENT = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
/** A valid felt ADDRESS deliberately NOT in the wallet's default token list, so
 *  wallet_watchAsset must hold behind approval rather than dedup on a listed one. */
export const WATCH_ASSET_TOKEN = "0x64656d6f746f6b656e";
/** A spec API_VERSION the discovery methods accept as an optional param.
 *  Sourced from the single-source versions module so wire and tests can't drift. */
export const API_VERSION = SUPPORTED_WALLET_API[0];

/** The connected account the background resolves for gated methods. */
export const ACCOUNT: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0xabcabcdef",
  classHash: "0xabcdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_SEPOLIA:0xabcabcdef",
  networkId: "SN_SEPOLIA",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};

/**
 * A minimal, valid SNIP-12 typed-data payload for wallet_signTypedData. This is
 * the dapp-facing signing contract, so it is revision 1 with every domain key
 * declared. Revision 0 is signable too (MCW-V09-101 is closed by the name
 * grammar, not by a revision ban); this fixture pins the modern shape, and
 * `tests/starknet/typed-data-revisions.test.ts` pins the other revision.
 */
export const TYPED_DATA: Json = {
  domain: { chainId: "SN_SEPOLIA", name: "Bramble Test", revision: "1", version: "1" },
  message: { content: "hello" },
  primaryType: "Message",
  types: {
    Message: [{ name: "content", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "shortstring" },
      { name: "chainId", type: "shortstring" },
      { name: "version", type: "shortstring" },
    ],
  },
};

/** A spec STRK20_CALL_AND_PROOF as the proving backend returns it. */
export const CALL_AND_PROOF = {
  call: { calldata: ["0x1"], contract_address: TOKEN, entry_point: "apply_actions" },
  proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
};

/** True when `value` is a non-empty array whose every member passes `member`. */
export const isArrayOf = (value: unknown, member: (item: unknown) => boolean): boolean =>
  Array.isArray(value) && value.length > 0 && value.every(member);

/** True when `value` is a string. */
export const isString = (value: unknown): value is string => typeof value === "string";

/**
 * One spec method's full conformance contract.
 */
export type SpecMethod = {
  /** The dapp-facing wire method name. */
  readonly method: ProviderMethod;
  /** Key selecting the result-shaping branch in `toProviderPayload`. */
  readonly resultMethod: ProviderResultMethod;
  /** The runtime message type a spec request must map to. */
  readonly runtimeType: RuntimeMessage["type"];
  /** Documented snake_case top-level param keys (excluding api_version). */
  readonly paramKeys: readonly string[];
  /** Whether the spec allows an optional `api_version` param. */
  readonly optionalApiVersion: boolean;
  /** Whether the method mutates state and must hold behind user approval. */
  readonly stateChanging: boolean;
  /** Numeric error codes wallet_rpc.json lists for the method. */
  readonly errorCodes: readonly number[];
  /** A spec-shaped page request (`readProviderRequestArguments` must accept). */
  readonly request: ProviderRequest;
  /** The runtime message `toRuntimeMessage` must produce for `request`. */
  readonly expectedRuntime: RuntimeMessage;
  /** A well-formed background result to feed `toProviderPayload`. */
  readonly backgroundResult: unknown;
  /** Deep validator: the payload result matches the spec shape/pattern. */
  readonly validateResult: (result: unknown) => boolean;
};
