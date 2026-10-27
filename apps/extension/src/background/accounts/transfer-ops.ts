/**
 * Public ERC-20 send review and broadcast. Gasless fees are offered only when
 * the wallet flag and forwarder pin allow them, and only when the user picks
 * a token. STRK remains the submit path otherwise.
 */

import { WalletError } from "@bramble/core/errors";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { buildErc20TransferCall, type FeeEstimate, parseTokenAmount } from "@bramble/starknet/rpc";
import { activityToken, clampActivitySummary } from "@bramble/transactions/activity";
import { resolveFeeAffordability } from "@bramble/transactions/fee-funds";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import { accountHashSigner } from "../ledger/account-hash-signer";
import { readReviewTransferInput, readTransferInput } from "../routing/message-inputs";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { afterBroadcast, recordSubmittedActivity } from "../transactions/activity-recording";
import { readStrkBalance } from "../transactions/fee-guard";
import { FEE_REVIEW_REQUIRED } from "../transactions/fee-review";
import { executeReviewedGasless, reviewGaslessOffers } from "../transactions/gasless-review";
import { reviewWalletFundedFees } from "../transactions/transfer-fee-review";
import { withTrustedRecipients } from "../transactions/trusted-recipients";
import { recordAutoDeployment } from "./deployment-ops";
import type { WalletOpsDeps } from "./wallet-ops-deps";

type WalletOpsHandler = (deps: WalletOpsDeps, message: unknown) => Promise<RuntimeResponse>;

const transferContext = async (
  deps: WalletOpsDeps,
  input: { readonly accountId: string; readonly tokenId: string },
) => {
  const vaultPassphrase = deps.session.getPassphrase();
  const authorized = captureSessionAuthorization(deps.session);
  if (!vaultPassphrase) {
    return { error: "wallet locked" } as const;
  }
  const preferences = await deps.preferencesStore.read();
  if (!authorized.isCurrent()) return { error: "wallet locked" } as const;
  const vault = await deps.wallet.readVault(vaultPassphrase);
  if (!authorized.isCurrent()) return { error: "wallet locked" } as const;
  const account = vault.accounts.find((stored) => stored.id === input.accountId);
  const token = preferences.tokens.find((stored) => stored.id === input.tokenId);
  if (!account || account.networkId !== preferences.activeNetworkId) {
    return { error: "no account for selected network" } as const;
  }
  if (!token || token.networkId !== account.networkId) {
    return { error: "token unavailable" } as const;
  }
  const trusted = await withTrustedRecipients(deps, preferences, vault.accounts);
  return { account, authorized, preferences: trusted, token, vaultPassphrase } as const;
};

const submitChosenTransfer = async (input: {
  readonly account: AccountRef;
  readonly amount: string;
  readonly deps: WalletOpsDeps;
  readonly gaslessFee?: NonNullable<ReturnType<typeof readTransferInput>>["gaslessFee"];
  readonly preferences: WalletPreferences;
  readonly recipient: string;
  readonly rememberHash: (hash: string) => void;
  readonly reviewedDeploymentFee?: FeeEstimate;
  readonly reviewedFee?: FeeEstimate;
  readonly speed: "fast" | "standard";
  readonly token: TokenConfig;
  readonly unlocked: () => boolean;
  readonly vaultPassphrase: string;
}) => {
  const prices = input.deps.prices;
  const gaslessFee = input.gaslessFee;
  if (gaslessFee && prices) {
    return executeReviewedGasless({
      account: input.account,
      calls: [
        buildErc20TransferCall(
          input.token.address,
          input.recipient,
          parseTokenAmount(input.amount, input.token.decimals),
        ),
      ],
      gaslessFee,
      isAuthorized: input.unlocked,
      preferences: input.preferences,
      prices,
      runtimeRpc: input.deps.runtimeRpc,
      signHash: accountHashSigner(input.deps, input.account, input.vaultPassphrase),
      strkFee: input.reviewedFee ?? null,
    });
  }
  const reviewedFee = input.reviewedFee;
  if (!reviewedFee) {
    throw new WalletError(
      "The network fee was not reviewed. Nothing was submitted — review the transaction again.",
    );
  }
  return input.deps.runtimeRpc.submitErc20Transfer({
    account: input.account,
    amount: input.amount,
    isAuthorized: input.unlocked,
    onSigned: async (signed) => {
      input.rememberHash(signed.transactionHash);
    },
    recipient: input.recipient,
    ...(input.reviewedDeploymentFee ? { reviewedDeploymentFee: input.reviewedDeploymentFee } : {}),
    reviewedFee,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[input.account.networkId], input.preferences),
    signHash: accountHashSigner(input.deps, input.account, input.vaultPassphrase),
    speed: input.speed,
    token: input.token,
  });
};

/**
 * Pre-sign review for a public send, including a gasless offer when STRK is short.
 */
export const handleReviewTransfer: WalletOpsHandler = async (deps, message) => {
  const input = readReviewTransferInput(message);
  if (!input) {
    return { error: "invalid transfer review request" };
  }
  const context = await transferContext(deps, input);
  if ("error" in context) {
    return { error: context.error };
  }
  const { account, preferences, token, vaultPassphrase } = context;
  const amountRaw = parseTokenAmount(input.amount, token.decimals);
  const call = buildErc20TransferCall(token.address, input.recipient, amountRaw);
  const report = verifyCalls([call], verificationContext(account, preferences));
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[account.networkId], preferences);
  const fees = await reviewWalletFundedFees(deps.runtimeRpc, {
    account,
    calls: [call],
    rpcUrls,
    signHash: accountHashSigner(deps, account, vaultPassphrase),
    speed: input.speed,
  });
  const feeAffordability = resolveFeeAffordability({
    balance: fees.totalFee === null ? null : await readStrkBalance(deps, account, preferences),
    fee: fees.totalFee,
    sendAmount: sameFelt(token.address, STRK_TOKEN_ADDRESS) ? amountRaw : null,
  });
  const prices = deps.prices;
  const gaslessFees = prices
    ? await reviewGaslessOffers({
        account,
        calls: [call],
        deployed: !fees.requiresDeployment,
        preferences,
        prices,
        runtimeRpc: deps.runtimeRpc,
        strkAffordability: feeAffordability,
        strkFee: fees.totalFee,
      }).catch(() => [])
    : [];
  return {
    ok: true,
    review: {
      deploymentFee: fees.deploymentFee,
      deploymentFeeEstimateFailed: fees.deploymentFeeEstimateFailed,
      fee: fees.fee,
      feeAffordability,
      feeEstimateFailed: fees.feeEstimateFailed,
      flags: report.flags,
      ...(gaslessFees.length > 0 ? { gaslessFees } : {}),
      requiresDeployment: fees.requiresDeployment,
      signsTwice: fees.requiresDeployment && account.derivation.kind === "ledger",
      summaries: report.calls.map((decoded) => decoded.summary),
    },
  };
};

const transferFeeBlock = (
  input: { readonly gaslessFee?: unknown; readonly reviewedFee?: unknown },
  prices: WalletOpsDeps["prices"],
): RuntimeResponse | null => {
  if (!input.reviewedFee && !input.gaslessFee) {
    return FEE_REVIEW_REQUIRED;
  }
  if (input.gaslessFee && prices === undefined) {
    return { error: "Paying the network fee in another token is unavailable." };
  }
  return null;
};

const feeSummary = (base: string, label: string | undefined): string =>
  label === undefined ? base : clampActivitySummary(`${base} (network fee in ${label})`);

const broadcastTransfer = async (
  deps: WalletOpsDeps,
  input: NonNullable<ReturnType<typeof readTransferInput>>,
  ready: {
    readonly account: AccountRef;
    readonly preferences: WalletPreferences;
    readonly summary: string;
    readonly token: TokenConfig;
    readonly unlocked: () => boolean;
    readonly vaultPassphrase: string;
  },
): Promise<RuntimeResponse> => {
  const blocked = transferFeeBlock(input, deps.prices);
  if (blocked) {
    return blocked;
  }
  const summary = feeSummary(ready.summary, input.gaslessFee?.label);
  const activityFor = (hash: string) => ({
    accountId: ready.account.id,
    amount: input.amount,
    counterparty: input.recipient,
    direction: "out" as const,
    hash,
    kind: "transfer" as const,
    networkId: ready.account.networkId,
    summary,
    ...activityToken(ready.token),
    ...(input.gaslessFee
      ? {
          userFee: {
            amount: input.gaslessFee.amount,
            token: input.gaslessFee.label,
            tokenAddress: input.gaslessFee.tokenAddress,
          },
        }
      : {}),
  });
  let signedHash: string | undefined;
  let transactionHash: string;
  let deploymentHash: string | undefined;
  try {
    const result = await submitChosenTransfer({
      account: ready.account,
      amount: input.amount,
      deps,
      ...(input.gaslessFee ? { gaslessFee: input.gaslessFee } : {}),
      preferences: ready.preferences,
      recipient: input.recipient,
      rememberHash: (hash) => {
        signedHash = hash;
      },
      ...(input.reviewedDeploymentFee
        ? { reviewedDeploymentFee: input.reviewedDeploymentFee }
        : {}),
      ...(input.reviewedFee ? { reviewedFee: input.reviewedFee } : {}),
      speed: input.speed,
      token: ready.token,
      unlocked: ready.unlocked,
      vaultPassphrase: ready.vaultPassphrase,
    });
    transactionHash = result.transactionHash;
    deploymentHash =
      "deploymentTransactionHash" in result ? result.deploymentTransactionHash : undefined;
  } catch (error) {
    await afterBroadcast(() => recordAutoDeployment(deps.activity, ready.account, error));
    if (!(error instanceof IndeterminateRpcWriteError)) {
      throw error;
    }
    const pending = signedHash;
    if (pending !== undefined) {
      await afterBroadcast(() => recordSubmittedActivity(deps.activity, activityFor(pending)));
    }
    return submissionUnknownResponse(error.message, signedHash);
  }
  await afterBroadcast(() => recordAutoDeployment(deps.activity, ready.account, deploymentHash));
  await afterBroadcast(() => recordSubmittedActivity(deps.activity, activityFor(transactionHash)));
  return { ok: true, transactionHash };
};

/**
 * Broadcasts a reviewed public send, in STRK or in a token the user chose.
 */
export const handleTransfer: WalletOpsHandler = async (deps, message) => {
  const input = readTransferInput(message);
  if (!input) {
    return { error: "invalid transfer request" };
  }
  const context = await transferContext(deps, input);
  if ("error" in context) {
    return { error: context.error };
  }
  const { account, authorized, preferences, token, vaultPassphrase } = context;
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  const report = verifyCalls(
    [
      buildErc20TransferCall(
        token.address,
        input.recipient,
        parseTokenAmount(input.amount, token.decimals),
      ),
    ],
    verificationContext(account, preferences),
  );
  const refusal = refuseOnPoisonedRecipient(report);
  if (refusal) {
    return refusal;
  }
  return broadcastTransfer(deps, input, {
    account,
    preferences,
    summary: report.calls[0]?.summary ?? `Send ${token.symbol}`,
    token,
    unlocked: authorized.isCurrent,
    vaultPassphrase,
  });
};
