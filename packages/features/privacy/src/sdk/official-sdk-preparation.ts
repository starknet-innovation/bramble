/**
 * Proof preparation and bounded service retries for the official privacy SDK.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { Strk20CallAndProof } from "@mc-wallet/wallet-protocol/strk20";
import type { RpcProvider } from "starknet";
import type { Strk20NetworkConfig } from "../config";
import type { Strk20MaturityScope } from "../policy/maturity";
import {
  STRK20_SERVICE_UNAVAILABLE,
  type Strk20AccountContext,
  type Strk20PrepareInput,
} from "../service";
import { strk20BuilderFor } from "./official-sdk-builder";
import { mapStrk20StageError, type Strk20FailureStage } from "./official-sdk-errors";
import type { Strk20MaturityRuntime } from "./official-sdk-maturity";
import { areHistoricalDepositsReady, isHistoricalAccountReady } from "./official-sdk-readiness";
import { assertNoSdkWarnings, readCallAndProof } from "./official-sdk-results";
import { retryStrk20ServiceRead, type ServiceRetryPause } from "./official-sdk-retry";
import type { PrivacySdkRuntime, SdkBuilder, SdkTransfers } from "./official-sdk-runtime";
import { transfersFor } from "./official-sdk-transfers";
import { requireStrk20Config } from "./official-sdk-values";

const noFinalProofGate = (): Promise<void> => Promise.resolve();

export { defaultServiceRetryPause } from "./official-sdk-retry";

/**
 * Builds the persisted maturity key for one account and privacy pool.
 */
export const maturityScope = (
  input: Strk20AccountContext,
  poolAddress: string,
): Strk20MaturityScope => ({
  accountId: input.account.id,
  networkId: input.account.networkId,
  poolAddress,
});

const discoverWith = (
  sdk: PrivacySdkRuntime,
  input: Strk20PrepareInput,
  builderForTransfers?: (transfers: SdkTransfers) => SdkBuilder,
): { readonly builder: SdkBuilder; readonly transfers: SdkTransfers } => {
  const transfers = transfersFor(sdk, input);
  return {
    builder:
      builderForTransfers?.(transfers) ??
      strk20BuilderFor(sdk, transfers, input.actions, input.account.address),
    transfers,
  };
};

/**
 * Historical state that must be indexed before proving can safely start.
 */
export type HistoricalState = "deposits" | "registration";

const historicalReadiness = (
  kind: HistoricalState | undefined,
  provider: RpcProvider,
  input: Strk20PrepareInput,
): ((block: number) => Promise<boolean>) | undefined => {
  if (kind === "registration") {
    return (block) => isHistoricalAccountReady(provider, input.account.address, block);
  }
  if (kind === "deposits") {
    return (block) =>
      areHistoricalDepositsReady(provider, input.account.address, input.actions, block);
  }
  return undefined;
};

const prepareOnce = async (input: {
  readonly beforeProof: () => Promise<void>;
  readonly builder: SdkBuilder;
  readonly config: Strk20NetworkConfig;
  readonly historicalState: HistoricalState | undefined;
  readonly maturity: Strk20MaturityRuntime;
  readonly preparation: Strk20PrepareInput;
  readonly provider: RpcProvider;
  readonly transfers: SdkTransfers;
}): Promise<Strk20CallAndProof> => {
  const readinessKind =
    input.historicalState ??
    (input.preparation.actions.some((action) => action.type === "deposit")
      ? "deposits"
      : undefined);
  const block = await input.maturity.provingBlock(
    input.provider,
    maturityScope(input.preparation, input.config.poolAddress),
    historicalReadiness(readinessKind, input.provider, input.preparation),
  );
  let result: unknown;
  if (input.preparation.simulate) {
    result = await input.builder.simulate({
      provider: input.provider,
      provingBlockId: block,
      validateSignature: false,
    });
  } else {
    // This is the last asynchronous wallet-policy boundary before the SDK
    // starts creating a proof. It runs after discovery and maturity waits, so
    // mutable chain state cannot become stale during those preflights.
    await input.beforeProof();
    const invocation = await input.builder.createProofInvocation({ provingBlockId: block });
    assertNoSdkWarnings(invocation);
    result = await input.transfers.executeWithInvocation(invocation, block);
  }
  assertNoSdkWarnings(result);
  return readCallAndProof(result, input.config, input.preparation.simulate);
};

/**
 * Prepares one SDK proof with bounded retries before any broadcast occurs.
 */
export const prepareWith = async (
  sdk: PrivacySdkRuntime,
  input: Strk20PrepareInput,
  maturity: Strk20MaturityRuntime,
  providerFor: (nodeUrl: string) => RpcProvider,
  pauseForServiceRetry: ServiceRetryPause,
  beforeProof: () => Promise<void> = noFinalProofGate,
  builderForTransfers?: (transfers: SdkTransfers) => SdkBuilder,
  historicalState?: HistoricalState,
): Promise<Strk20CallAndProof> => {
  const config = requireStrk20Config(input);
  if (
    input.actions.some((action) => action.type === "subaccount_invoke") &&
    !config.subaccountAnonymizerAddress
  ) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const nodeUrl = input.rpcUrls[0];
  if (!nodeUrl) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  let stage: Strk20FailureStage =
    historicalState === "registration" ? "registration-preparation" : "discovery";
  try {
    return await retryStrk20ServiceRead(async () => {
      stage = historicalState === "registration" ? "registration-preparation" : "discovery";
      const { builder, transfers } = discoverWith(sdk, input, builderForTransfers);
      const provider = providerFor(nodeUrl);
      stage = "proving";
      return await prepareOnce({
        beforeProof,
        builder,
        config,
        historicalState,
        maturity,
        preparation: input,
        provider,
        transfers,
      });
    }, pauseForServiceRetry);
  } catch (error) {
    return mapStrk20StageError(stage, error);
  }
};
