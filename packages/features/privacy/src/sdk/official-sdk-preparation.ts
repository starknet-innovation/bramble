/**
 * Proof preparation and bounded service retries for the official privacy SDK.
 */

import { WalletError } from "@bramble/core/errors";
import type { Strk20CallAndProof } from "@bramble/wallet-protocol/strk20";
import type { RpcProvider } from "starknet";
import type { Strk20NetworkConfig } from "../config";
import type { Strk20MaturityScope } from "../policy/maturity";
import { reportStrk20Phase } from "../policy/phases";
import {
  STRK20_SERVICE_UNAVAILABLE,
  type Strk20AccountContext,
  type Strk20PrepareInput,
} from "../service";
import {
  STRK20_WAIT_BUDGETS,
  type Strk20Waits,
  withinStrk20WaitBudget,
} from "./official-sdk-budget";
import { strk20BuilderFor } from "./official-sdk-builder";
import { mapStrk20StageError, type Strk20FailureStage } from "./official-sdk-errors";
import type { Strk20MaturityRuntime } from "./official-sdk-maturity";
import { areHistoricalDepositsReady, isHistoricalAccountReady } from "./official-sdk-readiness";
import { assertNoSdkWarnings, readCallAndProof } from "./official-sdk-results";
import {
  MAX_SERVICE_ATTEMPTS,
  retryStrk20ServiceRead,
  type ServiceRetryPause,
} from "./official-sdk-retry";
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

/**
 * One bounded retry round of a proof, reported to the context's phase sink.
 */
type ProofRound = { readonly attempt: number; readonly attempts: number };

const prepareOnce = async (input: {
  readonly beforeProof: () => Promise<void>;
  readonly builder: SdkBuilder;
  readonly config: Strk20NetworkConfig;
  readonly historicalState: HistoricalState | undefined;
  readonly maturity: Strk20MaturityRuntime;
  readonly preparation: Strk20PrepareInput;
  readonly provider: RpcProvider;
  readonly round: ProofRound;
  readonly transfers: SdkTransfers;
  readonly waits: Strk20Waits;
}): Promise<Strk20CallAndProof> => {
  const { onPhase } = input.preparation;
  const { budgets, schedule } = input.waits;
  const readinessKind =
    input.historicalState ??
    (input.preparation.actions.some((action) => action.type === "deposit")
      ? "deposits"
      : undefined);
  // The maturity runtime carries its own wall-clock budget; see
  // ./official-sdk-maturity.
  reportStrk20Phase(onPhase, "waiting for pool maturity", input.round);
  const block = await input.maturity.provingBlock(
    input.provider,
    maturityScope(input.preparation, input.config.poolAddress),
    historicalReadiness(readinessKind, input.provider, input.preparation),
  );
  // A simulation runs down the same prover path as a real proof. The pinned
  // SDK's own `simulate` sends the `compile_actions` invocation, which carries
  // the account's viewing key, to `input.provider` as a view call, and that
  // provider is the user's RPC node (an override when one is set). Routing it
  // through `executeWithInvocation` keeps the key with the configured prover,
  // which already receives it for every real proof; `readCallAndProof` then
  // blanks the proof, so a simulation still cannot be submitted.
  //
  // `beforeProof` is the last wallet-policy boundary before a submittable proof
  // is created. A simulation creates none, so it keeps skipping that gate.
  if (!input.preparation.simulate) {
    // This runs after discovery and maturity waits, so mutable chain state
    // cannot become stale during those preflights. The reads it makes report
    // their own phases.
    await input.beforeProof();
  }
  // Building the invocation refreshes discovery (indexer pagination with no
  // transport deadline) and fetches the pool nonce, so it is the wait most
  // likely to park without a budget.
  reportStrk20Phase(onPhase, "building the proof request", input.round);
  const invocation = await withinStrk20WaitBudget(
    "building the proof request",
    budgets.proofRequest,
    () => input.builder.createProofInvocation({ provingBlockId: block }),
    schedule,
  );
  assertNoSdkWarnings(invocation);
  reportStrk20Phase(onPhase, "proving", input.round);
  const result = await withinStrk20WaitBudget(
    "proving",
    budgets.proving,
    () => input.transfers.executeWithInvocation(invocation, block),
    schedule,
  );
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
  waits: Strk20Waits = { budgets: STRK20_WAIT_BUDGETS },
): Promise<Strk20CallAndProof> => {
  const config = requireStrk20Config(input);
  if (
    input.actions.some((action) => action.type === "shadow_account_invoke") &&
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
  let attempt = 0;
  try {
    return await retryStrk20ServiceRead(async () => {
      attempt += 1;
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
        round: { attempt, attempts: MAX_SERVICE_ATTEMPTS },
        transfers,
        waits,
      });
    }, pauseForServiceRetry);
  } catch (error) {
    return mapStrk20StageError(stage, error);
  }
};
