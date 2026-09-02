/**
 * Source-of-truth conformance table for the Starknet Wallet JSON-RPC surface,
 * distilled from starkware-libs/starknet-specs wallet-api/wallet_rpc.json. Every
 * one of the 16 spec methods is encoded here exactly once: the wire method name,
 * its snake_case param shape (with optional api_version), the runtime message it
 * must map to, a well-formed background result, a machine-checkable validator of
 * the spec result shape/pattern, the numeric error codes it can return, and
 * whether it is a state-changing method that must hold behind user approval. The
 * conformance test files drive the REAL provider bridge and background handlers
 * against this table so no method is left to the imagination. Fixtures, patterns,
 * and the `SpecMethod` type live in spec-fixtures.ts.
 */

import type { ProviderMethod } from "@bramble/wallet-protocol/bridge";
import { SUPPORTED_SPECS } from "@bramble/wallet-protocol/versions";
import {
  ACCOUNT,
  ADDRESS,
  API_VERSION,
  CALL_AND_PROOF,
  CHAIN_ID,
  ERROR_CODES,
  isArrayOf,
  isString,
  MAIN_CHAIN_ID,
  ORIGIN,
  PADDED_FELT,
  PADDED_TXN_HASH,
  RECIPIENT,
  REQUEST_ID,
  SEPOLIA_CHAIN_ID,
  SIGNATURE_FELT,
  type SpecMethod,
  TOKEN,
  TYPED_DATA,
  WATCH_ASSET_TOKEN,
} from "./spec-fixtures";

export {
  ERROR_CODES,
  ORIGIN,
  REQUEST_ID,
  type SpecMethod,
} from "./spec-fixtures";

/**
 * The 16 wallet_rpc.json methods, each with its exact conformance contract.
 */
export const SPEC_METHODS: readonly SpecMethod[] = [
  {
    method: "wallet_supportedSpecs",
    resultMethod: "wallet_supportedSpecs",
    runtimeType: "wallet.supportedSpecs",
    paramKeys: [],
    optionalApiVersion: true,
    stateChanging: false,
    errorCodes: [ERROR_CODES.API_VERSION_NOT_SUPPORTED, ERROR_CODES.UNKNOWN_ERROR],
    request: {
      id: REQUEST_ID,
      method: "wallet_supportedSpecs",
      params: { api_version: API_VERSION },
    },
    expectedRuntime: { apiVersion: API_VERSION, origin: ORIGIN, type: "wallet.supportedSpecs" },
    backgroundResult: { ok: true, versions: [...SUPPORTED_SPECS] },
    validateResult: (r) => isArrayOf(r, isString),
  },
  {
    method: "wallet_supportedWalletApi",
    resultMethod: "wallet_supportedWalletApi",
    runtimeType: "wallet.supportedWalletApi",
    paramKeys: [],
    optionalApiVersion: true,
    stateChanging: false,
    errorCodes: [ERROR_CODES.API_VERSION_NOT_SUPPORTED, ERROR_CODES.UNKNOWN_ERROR],
    request: {
      id: REQUEST_ID,
      method: "wallet_supportedWalletApi",
      params: { api_version: API_VERSION },
    },
    expectedRuntime: {
      apiVersion: API_VERSION,
      origin: ORIGIN,
      type: "wallet.supportedWalletApi",
    },
    backgroundResult: { ok: true, versions: [API_VERSION] },
    validateResult: (r) => isArrayOf(r, isString),
  },
  {
    method: "wallet_getPermissions",
    resultMethod: "wallet_getPermissions",
    runtimeType: "wallet.getPermissions",
    paramKeys: [],
    optionalApiVersion: true,
    stateChanging: false,
    errorCodes: [ERROR_CODES.API_VERSION_NOT_SUPPORTED, ERROR_CODES.UNKNOWN_ERROR],
    request: { id: REQUEST_ID, method: "wallet_getPermissions" },
    expectedRuntime: { origin: ORIGIN, type: "wallet.getPermissions" },
    backgroundResult: { ok: true, permissions: ["accounts"] },
    validateResult: (r) => isArrayOf(r, isString),
  },
  {
    method: "wallet_requestAccounts",
    resultMethod: "wallet_requestAccounts",
    runtimeType: "wallet.requestAccounts",
    paramKeys: [],
    optionalApiVersion: true,
    stateChanging: true,
    errorCodes: [
      ERROR_CODES.USER_REFUSED_OP,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: { id: REQUEST_ID, method: "wallet_requestAccounts" },
    expectedRuntime: { origin: ORIGIN, type: "wallet.requestAccounts" },
    backgroundResult: { accounts: [ACCOUNT], ok: true },
    validateResult: (r) => isArrayOf(r, (a) => isString(a) && ADDRESS.test(a)),
  },
  {
    method: "wallet_requestChainId",
    resultMethod: "wallet_requestChainId",
    runtimeType: "wallet.getChainId",
    paramKeys: [],
    optionalApiVersion: true,
    stateChanging: false,
    errorCodes: [ERROR_CODES.API_VERSION_NOT_SUPPORTED, ERROR_CODES.UNKNOWN_ERROR],
    request: { id: REQUEST_ID, method: "wallet_requestChainId" },
    expectedRuntime: { origin: ORIGIN, type: "wallet.getChainId" },
    backgroundResult: { chainId: SEPOLIA_CHAIN_ID, ok: true },
    validateResult: (r) => isString(r) && CHAIN_ID.test(r),
  },
  {
    method: "wallet_deploymentData",
    resultMethod: "wallet_deploymentData",
    runtimeType: "wallet.deploymentData",
    paramKeys: [],
    optionalApiVersion: true,
    stateChanging: false,
    errorCodes: [
      ERROR_CODES.ACCOUNT_ALREADY_DEPLOYED,
      ERROR_CODES.DEPLOYMENT_DATA_NOT_AVAILABLE,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: {
      id: REQUEST_ID,
      method: "wallet_deploymentData",
      params: { api_version: API_VERSION },
    },
    expectedRuntime: { apiVersion: API_VERSION, origin: ORIGIN, type: "wallet.deploymentData" },
    backgroundResult: {
      deployment: {
        address: ACCOUNT.address,
        calldata: ["0x1"],
        classHash: ACCOUNT.classHash,
        salt: "0x0",
        version: 1,
      },
      ok: true,
    },
    validateResult: (r) =>
      typeof r === "object" &&
      r !== null &&
      PADDED_FELT.test((r as { address: string }).address) &&
      PADDED_FELT.test((r as { class_hash: string }).class_hash) &&
      PADDED_FELT.test((r as { salt: string }).salt) &&
      ((r as { version: number }).version === 0 || (r as { version: number }).version === 1) &&
      isArrayOf((r as { calldata: unknown }).calldata, (c) => isString(c) && PADDED_FELT.test(c)),
  },
  {
    method: "wallet_switchStarknetChain",
    resultMethod: "wallet_switchStarknetChain",
    runtimeType: "wallet.switchChain",
    paramKeys: ["chainId"],
    optionalApiVersion: true,
    stateChanging: true,
    errorCodes: [
      ERROR_CODES.UNLISTED_NETWORK,
      ERROR_CODES.USER_REFUSED_OP,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.CHAIN_ID_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: {
      id: REQUEST_ID,
      method: "wallet_switchStarknetChain",
      params: { chainId: MAIN_CHAIN_ID },
    },
    expectedRuntime: { chainId: MAIN_CHAIN_ID, origin: ORIGIN, type: "wallet.switchChain" },
    backgroundResult: { chainId: MAIN_CHAIN_ID, ok: true },
    validateResult: (r) => r === true,
  },
  {
    method: "wallet_watchAsset",
    resultMethod: "wallet_watchAsset",
    runtimeType: "wallet.watchAsset",
    paramKeys: ["type", "options"],
    optionalApiVersion: true,
    stateChanging: true,
    errorCodes: [
      ERROR_CODES.NOT_ERC20,
      ERROR_CODES.INVALID_REQUEST_PAYLOAD,
      ERROR_CODES.USER_REFUSED_OP,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: {
      id: REQUEST_ID,
      method: "wallet_watchAsset",
      params: { options: { address: WATCH_ASSET_TOKEN }, type: "ERC20" },
    },
    expectedRuntime: {
      asset: { address: WATCH_ASSET_TOKEN },
      origin: ORIGIN,
      type: "wallet.watchAsset",
    },
    backgroundResult: { ok: true, watched: true },
    validateResult: (r) => r === true,
  },
  {
    method: "wallet_addStarknetChain",
    resultMethod: "wallet_addStarknetChain",
    runtimeType: "wallet.addStarknetChain",
    paramKeys: ["id", "chain_id", "chain_name"],
    optionalApiVersion: true,
    stateChanging: true,
    errorCodes: [
      ERROR_CODES.INVALID_REQUEST_PAYLOAD,
      ERROR_CODES.USER_REFUSED_OP,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: {
      id: REQUEST_ID,
      method: "wallet_addStarknetChain",
      params: {
        chain_id: "0x4d43434841494e",
        chain_name: "Bramble Chain",
        id: "bramble-chain",
        rpc_urls: ["https://rpc.example.com"],
      },
    },
    expectedRuntime: {
      chain: {
        chainId: "0x4d43434841494e",
        chainName: "Bramble Chain",
        id: "bramble-chain",
        rpcUrls: ["https://rpc.example.com"],
      },
      origin: ORIGIN,
      type: "wallet.addStarknetChain",
    },
    backgroundResult: { added: true, ok: true },
    validateResult: (r) => r === true,
  },
  {
    method: "wallet_addInvokeTransaction",
    resultMethod: "wallet_addInvokeTransaction",
    runtimeType: "wallet.addInvokeTransaction",
    paramKeys: ["invoke_transaction"],
    optionalApiVersion: true,
    stateChanging: true,
    errorCodes: [
      ERROR_CODES.INVALID_REQUEST_PAYLOAD,
      ERROR_CODES.USER_REFUSED_OP,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: {
      id: REQUEST_ID,
      method: "wallet_addInvokeTransaction",
      params: {
        invoke_transaction: [
          { calldata: ["0x1"], contract_address: TOKEN, entry_point: "transfer" },
        ],
      },
    },
    expectedRuntime: {
      calls: [{ calldata: ["0x1"], contractAddress: TOKEN, entrypoint: "transfer" }],
      origin: ORIGIN,
      type: "wallet.addInvokeTransaction",
    },
    backgroundResult: { ok: true, transactionHash: "0x123" },
    validateResult: (r) =>
      typeof r === "object" &&
      r !== null &&
      PADDED_TXN_HASH.test((r as { transaction_hash: string }).transaction_hash),
  },
  {
    method: "wallet_addDeclareTransaction",
    resultMethod: "wallet_addDeclareTransaction",
    runtimeType: "wallet.addDeclareTransaction",
    paramKeys: ["declare_transaction"],
    optionalApiVersion: true,
    stateChanging: true,
    errorCodes: [
      ERROR_CODES.INVALID_REQUEST_PAYLOAD,
      ERROR_CODES.USER_REFUSED_OP,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: {
      id: REQUEST_ID,
      method: "wallet_addDeclareTransaction",
      params: {
        declare_transaction: {
          compiled_class_hash: "0xabc",
          contract_class: { sierra_program: ["0x1"] },
        },
      },
    },
    expectedRuntime: {
      declare: { compiledClassHash: "0xabc", contractClass: { sierra_program: ["0x1"] } },
      origin: ORIGIN,
      type: "wallet.addDeclareTransaction",
    },
    backgroundResult: { classHash: "0xdef", ok: true, transactionHash: "0x123" },
    validateResult: (r) =>
      typeof r === "object" &&
      r !== null &&
      PADDED_TXN_HASH.test((r as { transaction_hash: string }).transaction_hash) &&
      PADDED_FELT.test((r as { class_hash: string }).class_hash),
  },
  {
    method: "wallet_strk20InvokeTransaction",
    resultMethod: "wallet_strk20InvokeTransaction",
    runtimeType: "wallet.strk20InvokeTransaction",
    paramKeys: ["actions"],
    optionalApiVersion: true,
    stateChanging: true,
    errorCodes: [
      ERROR_CODES.NOT_REGISTERED,
      ERROR_CODES.INSUFFICIENT_PRIVATE_BALANCE,
      ERROR_CODES.PRIVACY_LEAK,
      ERROR_CODES.INVALID_REQUEST_PAYLOAD,
      ERROR_CODES.USER_REFUSED_OP,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: {
      id: REQUEST_ID,
      method: "wallet_strk20InvokeTransaction",
      params: {
        actions: [{ amount: "0x0a", recipient: RECIPIENT, token: TOKEN, type: "withdraw" }],
      },
    },
    expectedRuntime: {
      actions: [{ amount: "0x0a", recipient: RECIPIENT, token: TOKEN, type: "withdraw" }],
      origin: ORIGIN,
      type: "wallet.strk20InvokeTransaction",
    },
    backgroundResult: { ok: true, transactionHash: "0x123" },
    validateResult: (r) =>
      typeof r === "object" &&
      r !== null &&
      PADDED_TXN_HASH.test((r as { transaction_hash: string }).transaction_hash),
  },
  {
    method: "wallet_strk20PrepareInvoke",
    resultMethod: "wallet_strk20PrepareInvoke",
    runtimeType: "wallet.strk20PrepareInvoke",
    paramKeys: ["actions", "simulate"],
    optionalApiVersion: true,
    stateChanging: false,
    errorCodes: [
      ERROR_CODES.NOT_REGISTERED,
      ERROR_CODES.INSUFFICIENT_PRIVATE_BALANCE,
      ERROR_CODES.PRIVACY_LEAK,
      ERROR_CODES.INVALID_REQUEST_PAYLOAD,
      ERROR_CODES.USER_REFUSED_OP,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: {
      id: REQUEST_ID,
      method: "wallet_strk20PrepareInvoke",
      params: {
        actions: [{ amount: "0x0a", recipient: RECIPIENT, token: TOKEN, type: "withdraw" }],
        simulate: true,
      },
    },
    expectedRuntime: {
      actions: [{ amount: "0x0a", recipient: RECIPIENT, token: TOKEN, type: "withdraw" }],
      origin: ORIGIN,
      simulate: true,
      type: "wallet.strk20PrepareInvoke",
    },
    backgroundResult: { callAndProof: CALL_AND_PROOF, ok: true },
    validateResult: (r) =>
      typeof r === "object" &&
      r !== null &&
      typeof (r as { call: unknown }).call === "object" &&
      typeof (r as { proof: unknown }).proof === "object",
  },
  {
    method: "wallet_strk20Balances",
    resultMethod: "wallet_strk20Balances",
    runtimeType: "wallet.strk20Balances",
    paramKeys: ["tokens"],
    optionalApiVersion: true,
    stateChanging: false,
    errorCodes: [
      ERROR_CODES.NOT_REGISTERED,
      ERROR_CODES.INVALID_REQUEST_PAYLOAD,
      ERROR_CODES.USER_REFUSED_OP,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: { id: REQUEST_ID, method: "wallet_strk20Balances", params: { tokens: [TOKEN] } },
    expectedRuntime: { origin: ORIGIN, tokens: [TOKEN], type: "wallet.strk20Balances" },
    backgroundResult: { balances: [{ balance: "0x64", token: TOKEN }], ok: true },
    validateResult: (r) =>
      isArrayOf(
        r,
        (e) =>
          typeof e === "object" &&
          e !== null &&
          ADDRESS.test((e as { token: string }).token) &&
          ADDRESS.test((e as { balance: string }).balance),
      ),
  },
  {
    method: "wallet_strk20SubaccountCommitment",
    resultMethod: "wallet_strk20SubaccountCommitment",
    runtimeType: "wallet.strk20SubaccountCommitment",
    paramKeys: ["dapp_name", "nonce"],
    optionalApiVersion: true,
    stateChanging: false,
    errorCodes: [
      ERROR_CODES.NOT_REGISTERED,
      ERROR_CODES.INVALID_REQUEST_PAYLOAD,
      ERROR_CODES.USER_REFUSED_OP,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: {
      id: REQUEST_ID,
      method: "wallet_strk20SubaccountCommitment",
      params: { dapp_name: "Bramble Terminal", nonce: "0x1" },
    },
    expectedRuntime: {
      dappName: "Bramble Terminal",
      nonce: "0x1",
      origin: ORIGIN,
      type: "wallet.strk20SubaccountCommitment",
    },
    backgroundResult: { commitment: "0x123", ok: true },
    validateResult: (r) => isString(r) && ADDRESS.test(r),
  },
  {
    method: "wallet_signTypedData",
    resultMethod: "wallet_signTypedData",
    runtimeType: "wallet.signTypedData",
    paramKeys: ["typed_data"],
    optionalApiVersion: true,
    stateChanging: true,
    errorCodes: [
      ERROR_CODES.INVALID_REQUEST_PAYLOAD,
      ERROR_CODES.USER_REFUSED_OP,
      ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ERROR_CODES.UNKNOWN_ERROR,
    ],
    request: { id: REQUEST_ID, method: "wallet_signTypedData", params: { typed_data: TYPED_DATA } },
    expectedRuntime: { origin: ORIGIN, typedData: TYPED_DATA, type: "wallet.signTypedData" },
    backgroundResult: { ok: true, signature: ["0x1", "0x2"] },
    validateResult: (r) =>
      Array.isArray(r) && r.length === 2 && r.every((f) => isString(f) && SIGNATURE_FELT.test(f)),
  },
];

/** The exact set of spec method names, for the dispatch coverage guard. */
export const SPEC_METHOD_NAMES: ReadonlySet<ProviderMethod> = new Set(
  SPEC_METHODS.map((entry) => entry.method),
);

/** Looks up a spec method entry by wire name. */
export const specMethod = (method: ProviderMethod): SpecMethod => {
  const entry = SPEC_METHODS.find((candidate) => candidate.method === method);
  if (!entry) {
    throw new Error(`no spec entry for ${method}`);
  }
  return entry;
};
