/**
 * Shared official Privacy SDK adapter fixtures. Tests inject this deterministic
 * runtime so no prover, discovery service, RPC, vault, or hardware is touched.
 */
import type { RpcProvider } from "starknet";
import type { PrivacySdkRuntime } from "../../src/starknet/strk20/official-sdk-service";
import type { Strk20AccountContext } from "../../src/starknet/strk20/service";

export const STRK20_POOL_ADDRESS = "0x123";
export const STRK20_SDK_TOKEN = "0x456";
export const STRK20_SDK_ACCOUNT = {
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
  rpcUrls: ["https://rpc.example"],
  signHash: async () => ({ publicKey: "0x1", r: "0x2", s: "0x3" }),
  viewingKey: async () => "0x55",
};

// Balance reads return a uint256; the pool-fee read returns a single u128 felt
// (zero by default so fee-independent tests see no extra approve call), and
// `get_public_key` a single felt that is zero only for unregistered addresses.
const poolCallResult = (entrypoint: string | undefined, publicKey: string): readonly string[] => {
  if (entrypoint === "get_fee_amount") {
    return ["0x0"];
  }
  if (entrypoint === "get_public_key") {
    return [publicKey];
  }
  return ["0x0", "0x10"];
};

/**
 * Builds the RPC double used by the official-SDK suites. `publicKey` is what the
 * pool reports for any queried address — pass `"0x0"` to model an address that
 * never registered its viewing key.
 */
export const strk20ProviderFor =
  (options: { readonly publicKey?: string } = {}) =>
  (): RpcProvider =>
    ({
      callContract: async (call: { entrypoint?: string }) =>
        poolCallResult(call?.entrypoint, options.publicKey ?? "0x77"),
      getClassHashAt: async () => "0xdef",
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

export const officialBuilder = (
  result: unknown,
  proofInvocation: unknown = { warnings: [] },
): OfficialBuilder => {
  const self = {
    createProofInvocation: async () => proofInvocation,
    invoke: () => self,
    register: () => self,
    simulate: async () => result,
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
