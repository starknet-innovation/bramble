/** Canonical public types for frozen Argent multisig V3 transactions. */

import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";
import type { EDataAvailabilityMode } from "starknet";
import type { ArgentMultisigConfig } from "../accounts/account-contracts";

/**
 * Public account identity required to prepare an Argent multisig transaction.
 */
export type ArgentMultisigAccountInput = {
  readonly accountContractType: "argent-multisig";
  readonly address: string;
  readonly classHash: string;
  readonly networkId: AccountRef["networkId"];
};

/**
 * Storage and request budgets for one frozen multisig transaction.
 */
export const ARGENT_MULTISIG_INVOKE_LIMITS = {
  calls: 16,
  calldataFelts: 256,
  executeCalldataFelts: 561,
  totalCalldataFelts: 512,
  transactionDataFelts: 64,
} as const;

/**
 * One canonical Cairo-1 account call in a frozen transaction.
 */
export type PreparedArgentMultisigCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

/**
 * Public call shape shared with the feature input boundary.
 */
export type ArgentMultisigCall = PreparedArgentMultisigCall;

/**
 * One canonical V3 resource limit.
 */
export type PreparedResourceBound = {
  readonly maxAmount: string;
  readonly maxPricePerUnit: string;
};

/**
 * Canonical JSON-safe resource bounds committed by a frozen transaction.
 */
export type PreparedResourceBounds = {
  readonly l1DataGas: PreparedResourceBound;
  readonly l1Gas: PreparedResourceBound;
  readonly l2Gas: PreparedResourceBound;
};

/**
 * Exact V3 fields whose hash Argent signers approve. Every numeric value uses
 * minimal lowercase `0x` spelling and `transactionHash` is recomputed by the
 * runtime guard before a stored record is trusted.
 */
export type PreparedArgentMultisigInvokeV3 = {
  readonly accountDeploymentData: readonly string[];
  readonly calldata: readonly string[];
  readonly calls: readonly PreparedArgentMultisigCall[];
  readonly chainId: string;
  readonly feeDataAvailabilityMode: EDataAvailabilityMode;
  readonly nonce: string;
  readonly nonceDataAvailabilityMode: EDataAvailabilityMode;
  readonly paymasterData: readonly string[];
  readonly resourceBounds: PreparedResourceBounds;
  readonly senderAddress: string;
  readonly tip: string;
  readonly transactionHash: string;
  readonly version: "0x3";
};

/**
 * Optional V3 data fields fixed at preparation time.
 */
export type PrepareArgentMultisigInvokeV3Options = {
  readonly feeDataAvailabilityMode?: EDataAvailabilityMode;
  readonly nonceDataAvailabilityMode?: EDataAvailabilityMode;
  readonly tip?: string;
};

/**
 * Inputs for read-only preparation against configured RPC failover.
 */
export type PrepareArgentMultisigInvokeV3Input = {
  readonly account: ArgentMultisigAccountInput;
  readonly calls: readonly ArgentMultisigCall[];
  readonly config: ArgentMultisigConfig;
  readonly options?: PrepareArgentMultisigInvokeV3Options;
  readonly rpcUrls: readonly string[];
};

/**
 * Inputs for non-retriable broadcast of one fully signed frozen transaction.
 */
export type SubmitPreparedArgentMultisigInvokeV3Input = {
  readonly config: ArgentMultisigConfig;
  readonly prepared: PreparedArgentMultisigInvokeV3;
  readonly rpcUrls: readonly string[];
  readonly signatures: readonly StarkSignature[];
};
