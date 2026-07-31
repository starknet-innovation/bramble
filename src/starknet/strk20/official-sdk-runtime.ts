/**
 * Narrow structural types for the pinned official privacy SDK runtime. The
 * adapter consumes only these reviewed methods rather than trusting the full
 * browser bundle surface.
 */

import type { BigNumberish, Call } from "starknet";
import type { SdkNoteMap } from "./official-sdk-values";

/**
 * Placeholder values supplied by the SDK when expanding private invokes.
 */
export type SdkCallBuilderArgs = {
  readonly openNotes: readonly { readonly noteId: BigNumberish }[];
  readonly poolAddress: BigNumberish;
};

/**
 * Token-scoped action builder methods used by the wallet adapter.
 */
export type SdkTokenBuilder = {
  readonly deposit: (...inputs: readonly { readonly amount: bigint }[]) => SdkTokenBuilder;
  readonly done: () => SdkBuilder;
  readonly transfer: (
    ...outputs: readonly { readonly amount: bigint | symbol; readonly recipient: string }[]
  ) => SdkTokenBuilder;
  readonly withdraw: (
    ...outputs: readonly { readonly amount: bigint; readonly recipient: string }[]
  ) => SdkTokenBuilder;
};

/**
 * Reviewed proof/action builder subset.
 */
export type SdkBuilder = {
  readonly createProofInvocation: (options: unknown) => Promise<unknown>;
  readonly invoke: (
    call: (args: SdkCallBuilderArgs) => {
      readonly calldata: BigNumberish[];
      readonly contractAddress: string;
    },
  ) => SdkBuilder;
  readonly register?: () => SdkBuilder;
  readonly simulate: (options: unknown) => Promise<unknown>;
  readonly subaccounts: (dappName: string) => {
    readonly commitment: (nonce: BigNumberish) => Promise<bigint>;
    readonly invoke: (
      nonce: BigNumberish,
      options: { readonly calls: readonly Call[]; readonly collectPolicy: unknown },
    ) => SdkBuilder;
    readonly partialCommitment: () => Promise<bigint>;
  };
  readonly with: (token: string) => SdkTokenBuilder;
};

/**
 * Account-scoped SDK methods used for discovery, setup, and proof execution.
 */
export type SdkTransfers = {
  readonly build: (options?: unknown) => SdkBuilder;
  readonly discoverRequirement?: (recipient: string, token: string) => Promise<number>;
  readonly discoverNotes: () => Promise<{ readonly notes: SdkNoteMap }>;
  readonly executeWithInvocation: (invocation: unknown, block: number) => Promise<unknown>;
};

/**
 * Untrusted SDK warning envelope checked before a result is accepted.
 */
export type SdkWarning = {
  readonly code: unknown;
  readonly message: unknown;
};

/**
 * Narrow runtime export set consumed from the vendored official SDK.
 */
export type PrivacySdkRuntime = {
  readonly IndexerDiscoveryProvider?: new (
    url: string,
    poolAddress: string,
    options?: {
      readonly ohttp?:
        | boolean
        | { readonly publicKeyConfig?: Uint8Array; readonly relayUrl?: string };
    },
  ) => unknown;
  readonly Open: symbol;
  readonly SetupRequirement?: { readonly Register: number };
  readonly createPrivateTransfers: (input: unknown) => SdkTransfers;
};
