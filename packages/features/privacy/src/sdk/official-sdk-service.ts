/**
 * Adapter from the pinned official Starknet privacy SDK browser bundle to Bramble
 * Wallet's narrow STRK20 middleware contract.
 */

import { WalletError } from "@bramble/core/errors";
import { createRpcProvider } from "@bramble/starknet/provider";
import { REVIEWED_FEE_REQUIRED, submitInvokeTransaction } from "@bramble/starknet/rpc-submit";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { Call, RpcProvider } from "starknet";
import { num } from "starknet";
import { submitStrk20PaymasterPlan } from "../paymaster/paymaster";
import { quoteStrk20RelayPlan } from "../paymaster/relay-quote";
import {
  memoryStrk20MaturityStore,
  STRK20_PRIOR_WRITE_UNRESOLVED,
  type Strk20MaturityScope,
  type Strk20SubmissionRoute,
} from "../policy/maturity";
import { reportStrk20Phase } from "../policy/phases";
import { relayClaimSlots } from "../policy/relay-claim-slots";
import {
  type PreparedStrk20AccountSubmission,
  STRK20_PRIVACY_LEAK,
  STRK20_SERVICE_UNAVAILABLE,
  STRK20_SUBMISSION_UNAVAILABLE,
  type Strk20AccountContext,
  type Strk20Service,
} from "../service";
import {
  STRK20_WAIT_BUDGETS,
  type Strk20WaitBudgets,
  type Strk20Waits,
} from "./official-sdk-budget";
import { strk20BuilderFor, strk20RegistrationBuilderFor } from "./official-sdk-builder";
import { mapStrk20StageError } from "./official-sdk-errors";
import { createStrk20MaturityRuntime, type Strk20SubmissionJournal } from "./official-sdk-maturity";
import type { OfficialServiceOptions } from "./official-sdk-options";
import { defaultServiceRetryPause, maturityScope, prepareWith } from "./official-sdk-preparation";
import { strk20ReadMethods } from "./official-sdk-reads";
import { strk20ShadowAccountReads } from "./official-sdk-shadow-accounts";
import { accountTypedDataSigner, sponsoredShieldSubmitter } from "./official-sdk-sponsored";
import {
  approveCalls,
  RELAY_PAYS_POOL_FEE,
  readStrk20PoolFee,
  requireReviewedStrk20PoolFee,
  requireStrk20Config,
} from "./official-sdk-values";

/**
 * Re-exported vendored SDK boundary for production wiring and test doubles.
 */
export type { PrivacySdkRuntime } from "./official-sdk-runtime";

/**
 * Creates the production STRK20 service backed by the pinned official SDK.
 *
 * Every wait the SDK cannot bound itself runs under a budget, and every phase
 * of a long operation is reported to the context's `onPhase` sink, so a
 * tracked job can settle with a reason and show what it is doing meanwhile.
 */
export const createOfficialStrk20Service = ({
  feeReference,
  http,
  maturityStore,
  nowSeconds,
  pauseForMaturity,
  pauseForServiceRetry = defaultServiceRetryPause,
  providerFor = createRpcProvider,
  sdk,
  submitInvoke = submitInvokeTransaction,
  waitBudgets,
  waitForAccepted,
  waitScheduler,
}: OfficialServiceOptions): Strk20Service => {
  const budgets: Strk20WaitBudgets = { ...STRK20_WAIT_BUDGETS, ...waitBudgets };
  const waits: Strk20Waits = { budgets, ...(waitScheduler ? { schedule: waitScheduler } : {}) };
  const journal = maturityStore ?? memoryStrk20MaturityStore();
  const maturity = createStrk20MaturityRuntime({
    maturityBudgetMs: budgets.maturity,
    store: journal,
    ...(pauseForMaturity ? { pause: pauseForMaturity } : {}),
    ...(waitScheduler ? { schedule: waitScheduler } : {}),
    ...(waitForAccepted ? { waitForAccepted } : {}),
  });
  const prepare = (
    input: Parameters<typeof prepareWith>[1],
    beforeProof?: () => Promise<void>,
    builderForTransfers?: Parameters<typeof prepareWith>[6],
    historicalState?: Parameters<typeof prepareWith>[7],
  ) =>
    prepareWith(
      sdk,
      input,
      maturity,
      providerFor,
      pauseForServiceRetry,
      beforeProof,
      builderForTransfers,
      historicalState,
      waits,
    );
  const submission = <P, T extends { readonly transactionHash: string }>(
    input: Strk20AccountContext,
    route: Strk20SubmissionRoute,
    prepare: (provider: RpcProvider, scope: Strk20MaturityScope) => Promise<P>,
    broadcast: (prepared: P, journal: Strk20SubmissionJournal) => Promise<T>,
    relaySlots?: (prepared: P) => readonly string[] | null,
  ): Promise<T> => {
    const config = requireStrk20Config(input);
    const nodeUrl = input.rpcUrls[0];
    if (!nodeUrl) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    const provider = providerFor(nodeUrl);
    const scope = maturityScope(input, config.poolAddress);
    return maturity.submitAccepted(
      provider,
      scope,
      route,
      () => prepare(provider, scope),
      broadcast,
      relaySlots,
    );
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
    ...strk20ReadMethods({ pauseForServiceRetry, providerFor, sdk, waits }),
    ...strk20ShadowAccountReads({ pauseForServiceRetry, providerFor, sdk }),
    async prepare(input) {
      return prepare(input);
    },
    async releasePendingWrite(input) {
      const config = requireStrk20Config(input);
      return maturity.releasePendingWrite(maturityScope(input, config.poolAddress));
    },
    async submitAcceptedRelay(input) {
      const config = requireStrk20Config(input);
      const scope = maturityScope(input, config.poolAddress);
      return submission(
        input,
        "relay",
        async () => {
          // Inside the scope queue, so a second send cannot pass this read
          // before the first claim is durable.
          if ((await journal.read(scope))?.state === "submitting") {
            throw new WalletError(STRK20_PRIOR_WRITE_UNRESOLVED);
          }
          return undefined;
        },
        async () => input.broadcast(),
        () => input.relaySlots,
      );
    },
    async prepareRegistration(input) {
      const config = requireStrk20Config(input);
      reportStrk20Phase(input.onPhase, "reading the pool fee");
      const reviewedPoolFee = await requireReviewedStrk20PoolFee(
        providerFor,
        input.rpcUrls,
        config.poolAddress,
        input.poolFeeFri,
      );
      const callAndProof = await prepare(
        { ...input, actions: [], simulate: false },
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
      // A registration opens the self channel; a third-party credit would open
      // a second one in the same batch, which links the two (USER_LINKAGE).
      const activate = input.activate === true;
      if (activate && input.actions.some((action) => "recipient" in action && action.recipient)) {
        throw new WalletError(STRK20_PRIVACY_LEAK);
      }
      reportStrk20Phase(input.onPhase, "reading the pool fee");
      const reviewedPoolFee = await requireReviewedStrk20PoolFee(
        providerFor,
        input.rpcUrls,
        config.poolAddress,
        input.poolFeeFri,
      );
      const callAndProof = await prepare(
        { ...input, simulate: false },
        input.beforeProof,
        activate
          ? (transfers) =>
              strk20BuilderFor(sdk, transfers, input.actions, input.account.address, true)
          : undefined,
        activate ? "first-shield" : undefined,
      );
      return publicBatch(
        config.poolAddress,
        approveCalls(input.actions, config.poolAddress, reviewedPoolFee),
        callAndProof,
      );
    },
    async register(input) {
      const config = requireStrk20Config(input);
      reportStrk20Phase(input.onPhase, "reading the pool fee");
      const reviewedPoolFee = await requireReviewedStrk20PoolFee(
        providerFor,
        input.rpcUrls,
        config.poolAddress,
        input.poolFeeFri,
        pauseForServiceRetry,
      );
      return submission(
        input,
        "account",
        async () =>
          prepare(
            { ...input, actions: [], simulate: false },
            undefined,
            strk20RegistrationBuilderFor,
            "registration",
          ),
        // The broadcast ran unmapped, so a pool rejection of apply_actions
        // reached the message boundary as a raw starknet.js error and its revert
        // reason was replaced by a generic failure. Map it with the submission
        // stage so the on-chain reason survives, sanitized, to the user.
        async (callAndProof, journal) => {
          const allowanceGrants = approveCalls([], config.poolAddress, reviewedPoolFee);
          reportStrk20Phase(input.onPhase, "broadcasting");
          try {
            const result = await submitInvoke({
              account: input.account,
              onSigned: journal,
              calls: [
                ...allowanceGrants,
                {
                  calldata: [...callAndProof.call.calldata],
                  contractAddress: config.poolAddress,
                  entrypoint: "apply_actions",
                },
              ],
              isAuthorized: input.isAuthorized,
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
      return num.toHex(
        await readStrk20PoolFee(
          providerFor,
          input.rpcUrls,
          config.poolAddress,
          pauseForServiceRetry,
        ),
      );
    },
    async quoteActions(input) {
      reportStrk20Phase(input.onPhase, "quoting the private relay");
      return quoteStrk20RelayPlan({
        accountAddress: input.account.address,
        actions: input.actions,
        config: requireStrk20Config(input),
        ...(feeReference ? { feeReference } : {}),
        ...(http ? { http } : {}),
        networkId: input.account.networkId,
        ...(nowSeconds ? { nowSeconds } : {}),
        pauseForServiceRetry,
        providerFor,
        rpcUrls: input.rpcUrls,
      });
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
        reportStrk20Phase(input.onPhase, "reading the pool fee");
        const reviewedPoolFee = await requireReviewedStrk20PoolFee(
          providerFor,
          input.rpcUrls,
          config.poolAddress,
          accountPlan.poolFeeFri,
          pauseForServiceRetry,
        );
        return submission(
          input,
          "account",
          async () => prepare({ ...input, simulate: false }, input.beforeProof),
          // The account-mode broadcast ran unmapped, so a pool rejection of the
          // shielding deposit reached the message boundary as a raw starknet.js
          // error whose message embeds the serialized request params — the
          // invoke calldata and the proof blob. Map it with the submission
          // stage so only the sanitized on-chain reason survives to the user.
          async (callAndProof, journal) => {
            const allowanceGrants = approveCalls(
              input.actions,
              config.poolAddress,
              reviewedPoolFee,
            );
            reportStrk20Phase(input.onPhase, "broadcasting");
            try {
              const result = await submitInvoke({
                account: input.account,
                onSigned: journal,
                calls: [
                  ...allowanceGrants,
                  {
                    calldata: [...callAndProof.call.calldata],
                    contractAddress: callAndProof.call.contract_address,
                    entrypoint: callAndProof.call.entry_point,
                  },
                ],
                isAuthorized: input.isAuthorized,
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
        "relay",
        async () =>
          prepare(
            { ...input, actions: [...input.actions, privatePlan.feeAction], simulate: false },
            input.beforeProof,
          ),
        async (callAndProof) => {
          reportStrk20Phase(input.onPhase, "relaying privately");
          const relayed = await submitStrk20PaymasterPlan({
            accountAddress: input.account.address,
            call: {
              calldata: [...callAndProof.call.calldata],
              contractAddress: callAndProof.call.contract_address,
              entrypoint: callAndProof.call.entry_point,
            },
            config: paymaster,
            ...(http ? { http } : {}),
            isAuthorized: input.isAuthorized,
            nowSeconds: nowSeconds(),
            plan: privatePlan,
            proof: callAndProof.proof,
            signTypedData: accountTypedDataSigner(input, providerFor),
          });
          return {
            // The relay executes the batch, but the approvals inside it are
            // still granted BY this account — derived here from the one shared
            // `approveCalls` rule, on the same actions and fee terms the
            // reviewed plan was quoted with, so the log tracks the private
            // route's grants exactly as it tracks the public one's.
            allowanceGrants: approveCalls(input.actions, config.poolAddress, RELAY_PAYS_POOL_FEE),
            ...relayed,
          };
        },
        // The slots are read at the configured pool, so they are taken only
        // from a call to that pool's `apply_actions` (mc-wallet #668).
        (callAndProof) =>
          callAndProof.call.entry_point === "apply_actions" &&
          sameFelt(callAndProof.call.contract_address, config.poolAddress)
            ? relayClaimSlots(callAndProof.call.calldata)
            : null,
      );
    },
    submitSponsoredShield: sponsoredShieldSubmitter({
      ...(http ? { http } : {}),
      maturity,
      ...(nowSeconds ? { nowSeconds } : {}),
      providerFor,
      submission,
    }),
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
        "account",
        async (provider, scope) => {
          reportStrk20Phase(input.onPhase, "waiting for pool maturity");
          await maturity.provingBlock(provider, scope);
          return input;
        },
        async (prepared, journal) => {
          reportStrk20Phase(input.onPhase, "broadcasting");
          const result = await submitInvoke({
            account: prepared.account,
            calls,
            onSigned: journal,
            isAuthorized: prepared.isAuthorized,
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
