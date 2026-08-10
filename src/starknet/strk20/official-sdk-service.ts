/**
 * Adapter from the pinned official Starknet privacy SDK browser bundle to MC
 * Wallet's narrow STRK20 middleware contract.
 */

import type { RpcProvider, TypedData } from "starknet";
import { num, typedData } from "starknet";
import { WalletError } from "../../shared/errors";
import { isJson } from "../../shared/json";
import { STARKNET_NETWORKS, sameFelt } from "../networks";
import { createRpcProvider } from "../provider";
import { submitInvokeTransaction } from "../rpc-submit";
import type { Strk20NetworkConfig } from "./config";
import type { Strk20MaturityScope, Strk20MaturityStore } from "./maturity";
import { strk20BuilderFor, strk20RegistrationBuilderFor } from "./official-sdk-builder";
import {
  isRetryableStrk20ServiceError,
  mapStrk20ProtocolError,
  mapStrk20StageError,
  type Strk20FailureStage,
} from "./official-sdk-errors";
import { createStrk20MaturityRuntime, type Strk20MaturityRuntime } from "./official-sdk-maturity";
import { areHistoricalDepositsReady, isHistoricalAccountReady } from "./official-sdk-readiness";
import { assertNoSdkWarnings, readCallAndProof } from "./official-sdk-results";
import type { PrivacySdkRuntime, SdkBuilder, SdkTransfers } from "./official-sdk-runtime";
import { transfersFor } from "./official-sdk-transfers";
import {
  approveCalls,
  balancesFrom,
  RELAY_PAYS_POOL_FEE,
  readStrk20PoolFee,
  requireStrk20Config,
} from "./official-sdk-values";
import { buildStrk20PaymasterPlan, submitStrk20PaymasterPlan } from "./paymaster";
import type { Strk20CallAndProof } from "./schemas";
import {
  STRK20_PRIVACY_LEAK,
  STRK20_SERVICE_UNAVAILABLE,
  STRK20_SUBMISSION_UNAVAILABLE,
  type Strk20AccountContext,
  type Strk20PrepareInput,
  type Strk20Service,
} from "./service";

/**
 * Re-exported vendored SDK boundary for production wiring and test doubles.
 */
export type { PrivacySdkRuntime } from "./official-sdk-runtime";

type OfficialServiceOptions = {
  readonly http?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly maturityStore?: Strk20MaturityStore;
  readonly nowSeconds?: () => number;
  readonly pauseForMaturity?: () => Promise<void>;
  readonly pauseForServiceRetry?: (attempt: number) => Promise<void>;
  readonly providerFor?: (nodeUrl: string) => RpcProvider;
  readonly sdk: PrivacySdkRuntime;
  readonly submitInvoke?: typeof submitInvokeTransaction;
  readonly waitForAccepted?: (provider: RpcProvider, transactionHash: string) => Promise<number>;
};

const MAX_SERVICE_ATTEMPTS = 3;

const defaultServiceRetryPause = (attempt: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, attempt * 1_000);
  });

const retryableServiceAttempt = (attempt: number, error: unknown): boolean =>
  attempt < MAX_SERVICE_ATTEMPTS && isRetryableStrk20ServiceError(error);

const maturityScope = (input: Strk20AccountContext, poolAddress: string) => ({
  accountId: input.account.id,
  networkId: input.account.networkId,
  poolAddress,
});

// Discovery-provider construction and builder assembly ran outside any mapping,
// so an SDK throw here reached the message boundary unmapped and lost its cause.
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

type HistoricalState = "deposits" | "registration";

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
    const invocation = await input.builder.createProofInvocation({ provingBlockId: block });
    assertNoSdkWarnings(invocation);
    result = await input.transfers.executeWithInvocation(invocation, block);
  }
  assertNoSdkWarnings(result);
  return readCallAndProof(result, input.config, input.preparation.simulate);
};

const prepareWith = async (
  sdk: PrivacySdkRuntime,
  input: Strk20PrepareInput,
  maturity: Strk20MaturityRuntime,
  providerFor: (nodeUrl: string) => RpcProvider,
  pauseForServiceRetry: (attempt: number) => Promise<void>,
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
  for (let attempt = 1; attempt <= MAX_SERVICE_ATTEMPTS; attempt += 1) {
    let stage: Strk20FailureStage =
      historicalState === "registration" ? "registration-preparation" : "discovery";
    try {
      const { builder, transfers } = discoverWith(sdk, input, builderForTransfers);
      const provider = providerFor(nodeUrl);
      stage = "proving";
      return await prepareOnce({
        builder,
        config,
        historicalState,
        maturity,
        preparation: input,
        provider,
        transfers,
      });
    } catch (error) {
      if (!retryableServiceAttempt(attempt, error)) {
        return mapStrk20StageError(stage, error);
      }
      await pauseForServiceRetry(attempt);
    }
  }
  throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
};

/**
 * Creates the production STRK20 service backed by the pinned official SDK.
 */
export const createOfficialStrk20Service = ({
  http,
  maturityStore,
  nowSeconds,
  pauseForMaturity,
  pauseForServiceRetry = defaultServiceRetryPause,
  providerFor = createRpcProvider,
  sdk,
  submitInvoke = submitInvokeTransaction,
  waitForAccepted,
}: OfficialServiceOptions): Strk20Service => {
  const maturity = createStrk20MaturityRuntime({
    ...(maturityStore ? { store: maturityStore } : {}),
    ...(pauseForMaturity ? { pause: pauseForMaturity } : {}),
    ...(waitForAccepted ? { waitForAccepted } : {}),
  });
  const submission = <P, T extends { readonly transactionHash: string }>(
    input: Strk20AccountContext,
    prepare: (provider: RpcProvider, scope: Strk20MaturityScope) => Promise<P>,
    broadcast: (prepared: P) => Promise<T>,
  ): Promise<T> => {
    const config = requireStrk20Config(input);
    const nodeUrl = input.rpcUrls[0];
    if (!nodeUrl) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    const provider = providerFor(nodeUrl);
    const scope = maturityScope(input, config.poolAddress);
    return maturity.submitAccepted(provider, scope, () => prepare(provider, scope), broadcast);
  };
  return {
    async prepare(input) {
      return prepareWith(sdk, input, maturity, providerFor, pauseForServiceRetry);
    },
    async privateBalances(input) {
      try {
        const result = await transfersFor(sdk, input).discoverNotes();
        return balancesFrom(result.notes, input.tokens);
      } catch (error) {
        return mapStrk20ProtocolError(error);
      }
    },
    async registrationStatus(input) {
      try {
        const transfers = transfersFor(sdk, input);
        if (!transfers.discoverRequirement || !sdk.SetupRequirement) {
          throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
        }
        const requirement = await transfers.discoverRequirement(input.account.address, input.token);
        return requirement === sdk.SetupRequirement.Register ? "unregistered" : "registered";
      } catch (error) {
        return mapStrk20ProtocolError(error);
      }
    },
    async register(input) {
      const config = requireStrk20Config(input);
      return submission(
        input,
        async () =>
          prepareWith(
            sdk,
            { ...input, actions: [], simulate: false },
            maturity,
            providerFor,
            pauseForServiceRetry,
            strk20RegistrationBuilderFor,
            "registration",
          ),
        // The broadcast ran unmapped, so a pool rejection of apply_actions
        // reached the message boundary as a raw starknet.js error and its revert
        // reason was replaced by a generic failure. Map it with the submission
        // stage so the on-chain reason survives, sanitized, to the user.
        async (callAndProof) => {
          try {
            const poolFee = await readStrk20PoolFee(providerFor, input.rpcUrls, config.poolAddress);
            const result = await submitInvoke({
              account: input.account,
              calls: [
                ...approveCalls([], config.poolAddress, poolFee),
                {
                  calldata: [...callAndProof.call.calldata],
                  contractAddress: config.poolAddress,
                  entrypoint: "apply_actions",
                },
              ],
              proof: callAndProof.proof,
              rpcUrls: input.rpcUrls,
              signHash: async (messageHash) => {
                const signature = await input.signHash(messageHash);
                return { publicKey: signature.publicKey, r: signature.r, s: signature.s };
              },
            });
            return { transactionHash: result.transactionHash };
          } catch (error) {
            return mapStrk20StageError("submission", error);
          }
        },
      );
    },
    async quoteActions(input) {
      const config = requireStrk20Config(input);
      if (!config.paymaster) {
        throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
      }
      if (!nowSeconds) {
        throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
      }
      return buildStrk20PaymasterPlan({
        accountAddress: input.account.address,
        approveCalls: approveCalls(input.actions, config.poolAddress, RELAY_PAYS_POOL_FEE),
        chainId: STARKNET_NETWORKS[input.account.networkId].chainId,
        config: config.paymaster,
        ...(http ? { http } : {}),
        nowSeconds: nowSeconds(),
        poolAddress: config.poolAddress,
      });
    },
    async subaccountCommitment(input) {
      const config = requireStrk20Config(input);
      if (!config.subaccountAnonymizerAddress) {
        throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
      }
      try {
        const transfers = transfersFor(sdk, input);
        await transfers.discoverNotes();
        const subaccount = transfers.build().subaccounts(input.dappName);
        const commitment =
          input.nonce === undefined
            ? await subaccount.partialCommitment()
            : await subaccount.commitment(input.nonce);
        return num.toHex(commitment);
      } catch (error) {
        return mapStrk20ProtocolError(error);
      }
    },
    async submitActions(input) {
      const config = requireStrk20Config(input);
      if (input.plan.mode === "account") {
        if (
          input.actions.length === 0 ||
          input.actions.some((action) => action.type !== "deposit")
        ) {
          throw new WalletError(STRK20_PRIVACY_LEAK);
        }
        return submission(
          input,
          async () =>
            prepareWith(
              sdk,
              { ...input, simulate: false },
              maturity,
              providerFor,
              pauseForServiceRetry,
            ),
          async (callAndProof) => {
            const poolFee = await readStrk20PoolFee(providerFor, input.rpcUrls, config.poolAddress);
            const result = await submitInvoke({
              account: input.account,
              calls: [
                ...approveCalls(input.actions, config.poolAddress, poolFee),
                {
                  calldata: [...callAndProof.call.calldata],
                  contractAddress: callAndProof.call.contract_address,
                  entrypoint: callAndProof.call.entry_point,
                },
              ],
              proof: callAndProof.proof,
              rpcUrls: input.rpcUrls,
              signHash: async (messageHash) => {
                const signature = await input.signHash(messageHash);
                return { publicKey: signature.publicKey, r: signature.r, s: signature.s };
              },
            });
            return { transactionHash: result.transactionHash };
          },
        );
      }
      const paymaster = config.paymaster;
      const privatePlan = input.plan;
      if (!paymaster || !nowSeconds) {
        throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
      }
      return submission(
        input,
        async () =>
          prepareWith(
            sdk,
            {
              ...input,
              actions: [...input.actions, privatePlan.feeAction],
              simulate: false,
            },
            maturity,
            providerFor,
            pauseForServiceRetry,
          ),
        async (callAndProof) =>
          submitStrk20PaymasterPlan({
            accountAddress: input.account.address,
            call: {
              calldata: [...callAndProof.call.calldata],
              contractAddress: callAndProof.call.contract_address,
              entrypoint: callAndProof.call.entry_point,
            },
            config: paymaster,
            ...(http ? { http } : {}),
            nowSeconds: nowSeconds(),
            plan: privatePlan,
            proof: callAndProof.proof,
            signTypedData: async (value) => {
              if (!isJson(value)) {
                throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
              }
              const messageHash = typedData.getMessageHash(
                value as unknown as TypedData,
                input.account.address,
              );
              const signature = await input.signHash(messageHash);
              return [signature.r, signature.s];
            },
          }),
      );
    },
    async submitPrepared(input) {
      const config = requireStrk20Config(input);
      if (
        input.proof.data.length === 0 ||
        input.proof.output.length === 0 ||
        input.proof.proof_facts.length === 0 ||
        !sameFelt(input.call.contractAddress, config.poolAddress) ||
        input.call.entrypoint !== "apply_actions"
      ) {
        throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
      }
      return submission(
        input,
        async (provider, scope) => {
          await maturity.provingBlock(provider, scope);
          return input;
        },
        async (prepared) => {
          const result = await submitInvoke({
            account: prepared.account,
            calls: [prepared.call],
            proof: prepared.proof,
            rpcUrls: prepared.rpcUrls,
            signHash: async (messageHash) => {
              const signature = await prepared.signHash(messageHash);
              return { publicKey: signature.publicKey, r: signature.r, s: signature.s };
            },
          });
          return { transactionHash: result.transactionHash };
        },
      );
    },
  };
};
