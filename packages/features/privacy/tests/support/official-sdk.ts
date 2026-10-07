/**
 * Shared official Privacy SDK adapter fixtures. Tests inject this deterministic
 * runtime so no prover, discovery service, RPC, vault, or hardware is touched.
 */

import type { PrivacySdkRuntime } from "@bramble/privacy/official-sdk-service";
import type { Strk20AccountContext } from "@bramble/privacy/service";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";

export const STRK20_POOL_ADDRESS = "0x123";
export const STRK20_REVIEWED_FEE = { overallFee: "1000", unit: "FRI" } as const;
export const STRK20_SDK_TOKEN = "0x456";
export const STRK20_SDK_ACCOUNT = {
  accountContractType: "openzeppelin" as const,
  address: "0xabc",
  classHash: "0xdef",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_SEPOLIA:0xabc" as const,
  networkId: "SN_SEPOLIA" as const,
  publicKeyX: "0x1",
  publicKeyY: "0x2",
};

export const STRK20_SDK_CONTEXT: Strk20AccountContext = {
  account: STRK20_SDK_ACCOUNT,
  config: {
    discoveryUrl: "https://discovery.example",
    poolAddress: STRK20_POOL_ADDRESS,
    proverUrl: "https://prover.example",
    subaccountAnonymizerAddress: "0x789",
  },
  isAuthorized: () => true,
  rpcUrls: ["https://rpc.example"],
  signHash: async () => ({ publicKey: "0x1", r: "0x2", s: "0x3" }),
  viewingKey: async () => "0x55",
};

// Balance reads return a uint256; the pool-fee read returns a single u128 felt
// (zero by default so fee-independent tests see no extra approve call), and
// `get_public_key` a single felt that is zero only for unregistered addresses.
const poolCallResult = (
  entrypoint: string | undefined,
  poolFee: string,
  publicKey: string,
): readonly string[] => {
  if (entrypoint === "get_fee_amount") {
    return [poolFee];
  }
  if (entrypoint === "get_public_key") {
    return [publicKey];
  }
  return ["0x0", "0x10"];
};

/**
 * Builds the RPC double used by the official-SDK suites. A non-zero `poolFee`
 * exercises approval behavior; `publicKey` is what the pool reports for any
 * queried address, with `"0x0"` modelling an unregistered recipient.
 */
export const strk20ProviderFor =
  (
    options: {
      readonly classHash?: string;
      readonly poolFee?: string;
      readonly publicKey?: string;
    } = {},
  ) =>
  (): RpcProvider =>
    ({
      callContract: async (call: { entrypoint?: string }) =>
        poolCallResult(call?.entrypoint, options.poolFee ?? "0x0", options.publicKey ?? "0x77"),
      getBlockLatestAccepted: async () => ({ block_hash: "0x9", block_number: 100 }),
      getClassHashAt: async () => options.classHash ?? "0xdef",
      getBlockNumber: async () => 20,
      waitForTransaction: async () => ({
        block_number: 10,
        isSuccess: () => true,
      }),
    }) as unknown as RpcProvider;

export const providerFor = strk20ProviderFor();

type SdkInput = {
  readonly viewingKeyProvider: { readonly getViewingKey: () => Promise<string> };
};

export const sdkRuntime = (
  create: (input: SdkInput) => ReturnType<PrivacySdkRuntime["createPrivateTransfers"]>,
): PrivacySdkRuntime => ({
  Open: Symbol("OPEN"),
  SetupRequirement: { Ready: 3, Register: 0 },
  createPrivateTransfers: (input) => create(input as SdkInput),
});

export type OfficialBuilder = ReturnType<
  ReturnType<PrivacySdkRuntime["createPrivateTransfers"]>["build"]
>;

/**
 * Self-referential SDK builder double. Proof results come from the transfers
 * double's `executeWithInvocation`, the only path the adapter proves through.
 */
export const officialBuilder = (proofInvocation: unknown = { warnings: [] }): OfficialBuilder => {
  const self = {
    createProofInvocation: async () => proofInvocation,
    invoke: () => self,
    register: () => self,
    subaccounts: () => ({
      commitment: async () => 0x123n,
      invoke: () => self,
      partialCommitment: async () => 0x456n,
    }),
    surplusTo: () => self,
    with: () => ({
      deposit: () => ({ done: () => self }),
      done: () => self,
      transfer: () => ({ done: () => self }),
      withdraw: () => ({ done: () => self }),
    }),
  };
  return self as unknown as OfficialBuilder;
};

export const executeResult = (warnings: readonly unknown[] = []) => ({
  callAndProof: {
    call: {
      calldata: ["0x1"],
      contractAddress: STRK20_POOL_ADDRESS,
      entrypoint: "apply_actions",
    },
    proof: { data: "proof", output: ["0x1"], proofFacts: ["0x2"] },
  },
  warnings,
});

/** The pool's on-chain per-batch charge used by the relay-route cases: 6 STRK in fri. */
export const STRK20_POOL_FEE_6_STRK = "0x53444835ec580000";

/** The SDK context with a private relay configured, STRK as the default fee token. */
export const STRK20_RELAY_CONTEXT = {
  ...STRK20_SDK_CONTEXT,
  config: {
    discoveryUrl: "https://discovery.example",
    paymaster: { feeToken: STRK_TOKEN_ADDRESS, url: "https://relay.example" },
    poolAddress: STRK20_POOL_ADDRESS,
    proverUrl: "https://prover.example",
  },
};
