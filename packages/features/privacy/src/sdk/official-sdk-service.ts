/**
 * Adapter from the pinned official Starknet privacy SDK browser bundle to MC
 * Wallet's narrow STRK20 middleware contract.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { isJson } from "@mc-wallet/core/json";
import { createRpcProvider } from "@mc-wallet/starknet/provider";
import { REVIEWED_FEE_REQUIRED, submitInvokeTransaction } from "@mc-wallet/starknet/rpc-submit";
import { STARKNET_NETWORKS, STRK_TOKEN_ADDRESS, sameFelt } from "@mc-wallet/wallet-model/networks";
import type { Call, RpcProvider, TypedData } from "starknet";
import { num, typedData } from "starknet";
import { buildStrk20PaymasterPlan, submitStrk20PaymasterPlan } from "../paymaster/paymaster";
import type { Strk20MaturityScope, Strk20MaturityStore } from "../policy/maturity";
import {
  type PreparedStrk20AccountSubmission,
  STRK20_PRIVACY_LEAK,
  STRK20_SERVICE_UNAVAILABLE,
  STRK20_SUBMISSION_UNAVAILABLE,
  type Strk20AccountContext,
  type Strk20Service,
} from "../service";
import { strk20RegistrationBuilderFor } from "./official-sdk-builder";
import { mapStrk20ProtocolError, mapStrk20StageError } from "./official-sdk-errors";
import { createStrk20MaturityRuntime } from "./official-sdk-maturity";
import { defaultServiceRetryPause, maturityScope, prepareWith } from "./official-sdk-preparation";
import type { PrivacySdkRuntime } from "./official-sdk-runtime";
import { transfersFor } from "./official-sdk-transfers";
import {
  approveCalls,
  balancesFrom,
  RELAY_PAYS_POOL_FEE,
  readStrk20PoolFee,
  readStrk20Registered,
  requireReviewedStrk20PoolFee,
  requireStrk20Config,
} from "./official-sdk-values";

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

/**
 * Reads the SDK's setup requirement as the account's *own* registration answer.
 *
 * The SDK reports four states — Register, SetupChannel, SetupToken, Ready.
 * `Register` means the caller has no viewing key registered with the pool;
 * every later state means registration is done and only per-channel setup
 * remains, which the transfer builder adds itself (`autoSetup`). Recipients are
 * deliberately not answered from here — see `readStrk20Registered`.
 */
const readSetupRequirement = (
  states: { readonly Register: number },
  requirement: number,
): "registered" | "unregistered" =>
  requirement === states.Register ? "unregistered" : "registered";

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
  const publicBatch = (
    poolAddress: string,
    allowanceGrants: readonly Call[],
    callAndProof: Awaited<ReturnType<Strk20Service["prepare"]>>,
  ): PreparedStrk20AccountSubmission => {
    const calls: Call[] = [
      ...allowanceGrants,
      {
        calldata: [...callAndProof.call.calldata],
        contractAddress: poolAddress,
        entrypoint: "apply_actions",
      },
    ];
    return { allowanceGrants, calls, proof: callAndProof.proof };
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
        // A recipient is read straight from the pool: the discovery preflight
        // cannot distinguish an unregistered recipient from a registered one
        // this sender has never opened a channel to.
        if (input.subject !== undefined) {
          const config = requireStrk20Config(input);
          const registered = await readStrk20Registered(
            providerFor,
            input.rpcUrls,
            config.poolAddress,
            input.subject,
          );
          return registered ? "registered" : "unregistered";
        }
        const transfers = transfersFor(sdk, input);
        if (!transfers.discoverRequirement || !sdk.SetupRequirement) {
          throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
        }
        const requirement = await transfers.discoverRequirement(input.account.address, input.token);
        return readSetupRequirement(sdk.SetupRequirement, requirement);
      } catch (error) {
        return mapStrk20ProtocolError(error);
      }
    },
    async prepareRegistration(input) {
      const config = requireStrk20Config(input);
      const reviewedPoolFee = await requireReviewedStrk20PoolFee(
        providerFor,
        input.rpcUrls,
        config.poolAddress,
        input.poolFeeFri,
      );
      const callAndProof = await prepareWith(
        sdk,
        { ...input, actions: [], simulate: false },
        maturity,
        providerFor,
        pauseForServiceRetry,
        undefined,
        strk20RegistrationBuilderFor,
        "registration",
      );
      return publicBatch(
        config.poolAddress,
        approveCalls([], config.poolAddress, reviewedPoolFee),
        callAndProof,
      );
    },
    async prepareAccountActions(input) {
      const config = requireStrk20Config(input);
      if (input.actions.length === 0 || input.actions.some((action) => action.type !== "deposit")) {
        throw new WalletError(STRK20_PRIVACY_LEAK);
      }
      const reviewedPoolFee = await requireReviewedStrk20PoolFee(
        providerFor,
        input.rpcUrls,
        config.poolAddress,
        input.poolFeeFri,
      );
      const callAndProof = await prepareWith(
        sdk,
        { ...input, simulate: false },
        maturity,
        providerFor,
        pauseForServiceRetry,
        input.beforeProof,
      );
      return publicBatch(
        config.poolAddress,
        approveCalls(input.actions, config.poolAddress, reviewedPoolFee),
        callAndProof,
      );
    },
    async register(input) {
      const config = requireStrk20Config(input);
      const reviewedPoolFee = await requireReviewedStrk20PoolFee(
        providerFor,
        input.rpcUrls,
        config.poolAddress,
        input.poolFeeFri,
      );
      return submission(
        input,
        async () =>
          prepareWith(
            sdk,
            { ...input, actions: [], simulate: false },
            maturity,
            providerFor,
            pauseForServiceRetry,
            undefined,
            strk20RegistrationBuilderFor,
            "registration",
          ),
        // The broadcast ran unmapped, so a pool rejection of apply_actions
        // reached the message boundary as a raw starknet.js error and its revert
        // reason was replaced by a generic failure. Map it with the submission
        // stage so the on-chain reason survives, sanitized, to the user.
        async (callAndProof) => {
          const allowanceGrants = approveCalls([], config.poolAddress, reviewedPoolFee);
          try {
            const result = await submitInvoke({
              account: input.account,
              calls: [
                ...allowanceGrants,
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
            return { allowanceGrants, transactionHash: result.transactionHash };
          } catch (error) {
            return mapStrk20StageError("submission", error);
          }
        },
      );
    },
    async poolFee(input) {
      const config = requireStrk20Config(input);
      return num.toHex(await readStrk20PoolFee(providerFor, input.rpcUrls, config.poolAddress));
    },
    async quoteActions(input) {
      const config = requireStrk20Config(input);
      if (!config.paymaster) {
        throw new WalletError(
          `${STRK20_SUBMISSION_UNAVAILABLE}: no private relay is configured for this network`,
        );
      }
      if (!nowSeconds) {
        throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
      }
      // The upstream supports converted fee tokens, but its response does not
      // expose enough independently-verifiable pricing data to cap that
      // conversion. Restrict the wallet route to STRK, then bind the quoted
      // withdrawal exactly to the pool's on-chain fee before proving.
      if (!sameFelt(config.paymaster.feeToken, STRK_TOKEN_ADDRESS)) {
        throw new WalletError(STRK20_SUBMISSION_UNAVAILABLE);
      }
      const expectedFeeAmount = await readStrk20PoolFee(
        providerFor,
        input.rpcUrls,
        config.poolAddress,
      );
      return buildStrk20PaymasterPlan({
        accountAddress: input.account.address,
        approveCalls: approveCalls(input.actions, config.poolAddress, RELAY_PAYS_POOL_FEE),
        chainId: STARKNET_NETWORKS[input.account.networkId].chainId,
        config: config.paymaster,
        expectedFeeAmount,
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
        const accountPlan = input.plan;
        const reviewedFee = accountPlan.reviewedFee;
        if (!reviewedFee) {
          throw new WalletError(REVIEWED_FEE_REQUIRED);
        }
        if (
          input.actions.length === 0 ||
          input.actions.some((action) => action.type !== "deposit")
        ) {
          throw new WalletError(STRK20_PRIVACY_LEAK);
        }
        const reviewedPoolFee = await requireReviewedStrk20PoolFee(
          providerFor,
          input.rpcUrls,
          config.poolAddress,
          accountPlan.poolFeeFri,
        );
        return submission(
          input,
          async () =>
            prepareWith(
              sdk,
              { ...input, simulate: false },
              maturity,
              providerFor,
              pauseForServiceRetry,
              input.beforeProof,
            ),
          // The account-mode broadcast ran unmapped, so a pool rejection of the
          // shielding deposit reached the message boundary as a raw starknet.js
          // error whose message embeds the serialized request params — the
          // invoke calldata and the proof blob. Map it with the submission
          // stage so only the sanitized on-chain reason survives to the user.
          async (callAndProof) => {
            const allowanceGrants = approveCalls(
              input.actions,
              config.poolAddress,
              reviewedPoolFee,
            );
            try {
              const result = await submitInvoke({
                account: input.account,
                calls: [
                  ...allowanceGrants,
                  {
                    calldata: [...callAndProof.call.calldata],
                    contractAddress: callAndProof.call.contract_address,
                    entrypoint: callAndProof.call.entry_point,
                  },
                ],
                proof: callAndProof.proof,
                reviewedFee,
                rpcUrls: input.rpcUrls,
                signHash: async (messageHash) => {
                  const signature = await input.signHash(messageHash);
                  return { publicKey: signature.publicKey, r: signature.r, s: signature.s };
                },
              });
              return { allowanceGrants, transactionHash: result.transactionHash };
            } catch (error) {
              return mapStrk20StageError("submission", error);
            }
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
            input.beforeProof,
          ),
        async (callAndProof) => ({
          // The relay executes the batch, but the approvals inside it are still
          // granted BY this account — derived here from the one shared
          // `approveCalls` rule, on the same actions and fee terms the reviewed
          // plan was quoted with, so the log tracks the private route's grants
          // exactly as it tracks the public one's.
          allowanceGrants: approveCalls(input.actions, config.poolAddress, RELAY_PAYS_POOL_FEE),
          ...(await submitStrk20PaymasterPlan({
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
          })),
        }),
      );
    },
    async submitPrepared(input) {
      const config = requireStrk20Config(input);
      const calls = input.calls ?? (input.call ? [input.call] : []);
      const applyActions = calls.filter(
        (call) =>
          sameFelt(call.contractAddress, config.poolAddress) && call.entrypoint === "apply_actions",
      );
      if (
        input.proof.data.length === 0 ||
        input.proof.output.length === 0 ||
        input.proof.proof_facts.length === 0 ||
        applyActions.length !== 1 ||
        calls.at(-1) !== applyActions[0] ||
        calls.slice(0, -1).some((call) => call.entrypoint !== "approve")
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
            calls,
            proof: prepared.proof,
            ...(input.reviewedFee ? { reviewedFee: input.reviewedFee } : {}),
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
