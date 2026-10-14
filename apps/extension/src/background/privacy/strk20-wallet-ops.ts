/**
 * Extension-owned STRK20 registration and private-balance state. These
 * messages are privileged by default and never enter the dapp bridge. Review
 * payloads are frozen in a one-time store before any proof or authorization is
 * produced; the shared submission path every wallet-owned preparation is
 * executed through lives in ./strk20-wallet-execution.
 *
 * The activation proof is built at review, like a shield's, so
 * `wallet.strk20PrepareRegistration` answers its gate refusals on the request
 * and runs the proof as a tracked job (./strk20-preparation-jobs) the panel
 * polls through `wallet.strk20PreparationStatus`.
 */

import { WalletError } from "@bramble/core/errors";
import { unavailablePriceService } from "@bramble/portfolio/prices";
import { strk20ConvertedFeeCeiling } from "@bramble/privacy/fee-policy";
import type { Strk20PhaseSink } from "@bramble/privacy/phases";
import {
  formatStrk20PoolFee,
  prepareStrk20Registration,
  readStrk20Balances,
  readStrk20RegistrationStatus,
} from "@bramble/privacy/service";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import { systemClock } from "@bramble/transactions/activity";
import {
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { PrivacyBlockerError } from "@bramble/wallet-protocol/privacy-blocker";
import { STRK20_LIMITS } from "@bramble/wallet-protocol/strk20";
import { createApprovalContext } from "../approvals/approval-context";
import {
  privateReadTokens,
  trackPrivatelyHeldTokens,
  untrackedCuratedTokens,
} from "../portfolio/held-tokens";
import { readTypeOnlyInput } from "../routing/message-inputs";
import { activeAccountContext, observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { strk20ServiceForRuntime } from "./strk20-account-context";
import { createStrk20FeeReference } from "./strk20-fee-reference";
import {
  type ActivePrivacyContext,
  assertPrivacyAccountDeployed,
  assertPublicPoolSpendAffordable,
  errorText,
  estimatePublicStrk20Fee,
  reportingPrivacyContext,
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";
import { handleStrk20SendOps } from "./strk20-send-ops";
import { executePreparation, STRK20_REGISTRATION_SUMMARY } from "./strk20-wallet-execution";
import { readStrk20WalletExecuteInput } from "./strk20-wallet-inputs";
import { strk20WalletPreparationPayload } from "./strk20-wallet-preparations";

/**
 * Re-exported deps type so existing wiring keeps one import site.
 */
export type { Strk20WalletOpsDeps } from "./strk20-op-context";
/**
 * Re-exported so the registration summary keeps its one import site beside
 * the derivation that matches on it.
 */
export { STRK20_REGISTRATION_SUMMARY } from "./strk20-wallet-execution";

/**
 * How long a broadcast registration is trusted over the privacy indexer. The
 * indexer reflects a registration seconds to minutes after Starknet accepts it;
 * past this window a still-invisible registration reads as absent again, so an
 * attempt that truly never landed leaves the user able to retry rather than
 * locked out of the flow forever.
 */
const REGISTRATION_PENDING_WINDOW_MS = 30 * 60_000;

// A registration the privacy indexer cannot see yet. Derived from the activity
// log rather than stored separately: the registration is already recorded there
// with its hash, and background reconciliation already advances that entry, so a
// rejected or reverted attempt drops out of this check on its own.
const hasPendingRegistration = async (
  deps: Strk20WalletOpsDeps,
  context: ActivePrivacyContext,
): Promise<boolean> => {
  const now = (deps.now ?? systemClock)();
  const entries = await deps.activity.list();
  return entries.some(
    (entry) =>
      entry.summary === STRK20_REGISTRATION_SUMMARY &&
      entry.accountId === context.accountContext.account.id &&
      entry.networkId === context.accountContext.account.networkId &&
      entry.status !== "rejected" &&
      entry.status !== "reverted" &&
      now - entry.submittedAt < REGISTRATION_PENDING_WINDOW_MS,
  );
};

/**
 * The bounded converted pool fee for each held token the wallet can price,
 * keyed by token address. This is what lets the Send affordability gate reserve
 * the fee in the token the relay will actually charge it in, rather than
 * assuming STRK. Every held token except STRK is priced: the pool fee is
 * denominated in STRK, so only STRK needs no conversion. That includes a
 * non-STRK configured fee token, whose ceiling the gate needs whenever the fee
 * falls back to it. A token the reference cannot price is simply absent, which
 * leaves the Send gate without a bound for it.
 */
const readConvertedFeeCeilings = async (
  deps: Strk20WalletOpsDeps,
  input: {
    readonly balances: readonly { readonly token: string }[];
    readonly networkId: StarknetNetworkId;
    readonly poolFeeFri: string;
  },
): Promise<ReadonlyMap<string, string>> => {
  const ceilings = new Map<string, string>();
  let poolFee: bigint;
  try {
    poolFee = BigInt(input.poolFeeFri);
  } catch {
    return ceilings;
  }
  const reference = createStrk20FeeReference(deps.prices ?? unavailablePriceService);
  for (const entry of input.balances) {
    if (sameFelt(entry.token, STRK_TOKEN_ADDRESS)) {
      continue;
    }
    let bound: bigint | null = null;
    try {
      bound = await reference({
        feeToken: entry.token,
        networkId: input.networkId,
        poolFeeFri: poolFee,
      });
    } catch {
      bound = null;
    }
    if (bound !== null && bound > 0n) {
      // Field elements cross this boundary as 0x-hex, which is what the panel's
      // strict state validator accepts and what the reviewed ceilings already
      // use. A decimal string here makes the whole disclosure unreadable.
      ceilings.set(entry.token, `0x${strk20ConvertedFeeCeiling(bound).toString(16)}`);
    }
  }
  return ceilings;
};

const stateResponse = async (deps: Strk20WalletOpsDeps): Promise<RuntimeResponse> => {
  // The privacy screen re-reads this disclosure on every hydration and, while a
  // registration is settling, on a three-second poll. It is pure observation of
  // state the user did not ask for again, so it must not extend the unlock
  // window — otherwise one open panel keeps the wallet unlocked forever.
  const context = await resolvePrivacyContext(deps, {
    active: await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore),
  });
  if ("error" in context) {
    return context;
  }
  try {
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    const status = await readStrk20RegistrationStatus(service, {
      ...context.accountContext,
      token: context.token.address,
    });
    // An accepted-but-unindexed registration reads as `pending` rather than
    // `unregistered`, so no surface offers to register a second time while the
    // first one is still settling.
    const registration =
      status === "registered"
        ? "registered"
        : (await hasPendingRegistration(deps, context))
          ? "pending"
          : "unregistered";
    // Curated tokens are read too and tracked when privately held (issue 663);
    // the entries returned still name tracked tokens alone.
    const networkId = context.accountContext.account.networkId;
    const tracked = context.preferences.tokens.filter((token) => token.networkId === networkId);
    const curated = untrackedCuratedTokens(context.preferences, networkId);
    const discovered =
      registration === "registered"
        ? await readStrk20Balances(strk20ServiceForRuntime(deps.runtimeRpc), {
            ...context.accountContext,
            tokens: privateReadTokens(tracked, curated, STRK20_LIMITS.balances),
          })
        : [];
    const trackedTokens = await trackPrivatelyHeldTokens(
      deps.preferencesStore,
      networkId,
      tracked,
      curated,
      discovered,
    );
    const balances = discovered.filter((entry) =>
      trackedTokens.some((token) => sameFelt(token.address, entry.token)),
    );
    // The fee is a hard input to every pool route. Returning a successful state
    // without it leaves Send in an endless "Checking" state, so an unavailable
    // reader or a failed read rejects this request and reaches the UI's retry.
    if (!service.poolFee) {
      throw new WalletError("Private pool fee is unavailable. Retry the balance check.");
    }
    const poolFeeFri = await service.poolFee(context.accountContext);
    // The fee token a relayed batch falls back to, and the bounded converted
    // fee for every other held token the wallet can price. The Send
    // affordability gate reserves against these so it matches the fee the relay
    // will quote, rather than assuming STRK. No relay means no relayed fee, so
    // the disclosure stays exactly as before.
    const paymaster = context.accountContext.config?.paymaster;
    const feeToken = paymaster?.feeToken ?? STRK_TOKEN_ADDRESS;
    const feeCeilings = paymaster
      ? await readConvertedFeeCeilings(deps, {
          balances,
          networkId: context.accountContext.account.networkId,
          poolFeeFri,
        })
      : new Map<string, string>();
    return {
      ok: true,
      strk20State: {
        accountId: context.accountContext.account.id,
        balances: balances.map((entry) => {
          const token = trackedTokens.find((candidate) => sameFelt(candidate.address, entry.token));
          const feeCeiling = feeCeilings.get(entry.token);
          return {
            balance: entry.balance,
            ...(feeCeiling !== undefined ? { feeCeiling } : {}),
            formatted: token ? formatTokenAmount(BigInt(entry.balance), token.decimals) : "0",
            symbol: token?.symbol ?? "Token",
            token: entry.token,
            tokenId: token?.id ?? "",
          };
        }),
        ...(paymaster ? { feeToken } : {}),
        networkId: context.accountContext.account.networkId,
        poolFeeFri,
        relayConfigured: context.accountContext.config?.paymaster !== undefined,
        registration,
      },
    };
  } catch (error) {
    return { error: errorText(error, "Private balances unavailable") };
  }
};

// The proof-building half of an activation, run detached inside a tracked
// job. The context was resolved on the request that started it, so a missing
// pool, a Ledger account, or an untracked token was refused there; what
// remains is the registration and pending checks, the fee read, the proof, and
// the fee estimate — the work that can outlive a runtime request.
const registrationPreparationWork = async (
  deps: Strk20WalletOpsDeps,
  resolved: ActivePrivacyContext,
  report: Strk20PhaseSink,
): Promise<RuntimeResponse> => {
  const context = reportingPrivacyContext(resolved, report);
  try {
    await assertPrivacyAccountDeployed(deps, context);
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    const status = await readStrk20RegistrationStatus(service, {
      ...context.accountContext,
      token: context.token.address,
    });
    if (status === "registered") {
      return { error: "Private balances are already active" };
    }
    // The status read above is blind for as long as the indexer lags, which is
    // exactly the window in which a user is most likely to try again. Refuse to
    // prepare a duplicate on the local record instead.
    if (await hasPendingRegistration(deps, context)) {
      return {
        error: "A registration is already on its way for this account",
        privacyBlocker: "pending",
      };
    }
    const config = context.accountContext.config;
    if (!config) {
      return {
        error: "Private balances are not configured for this network",
        privacyBlocker: "network",
      };
    }
    if (!service.poolFee) {
      return { error: "Private pool fee is unavailable. Retry the registration." };
    }
    report({ phase: "reading the pool fee" });
    const poolFeeFri = await service.poolFee(context.accountContext);
    report({ phase: "checking the public balance" });
    await assertPublicPoolSpendAffordable(deps, context, poolFeeFri);
    const prepared = await prepareStrk20Registration(service, {
      ...context.accountContext,
      poolFeeFri,
    });
    report({ phase: "estimating the network fee" });
    const networkFee = await estimatePublicStrk20Fee(deps, context, prepared.calls, prepared.proof);
    const unsigned = {
      ...prepared,
      kind: "register" as const,
      networkFee,
      poolAddress: config.poolAddress,
      poolFeeFri,
      summaries: [
        "Register this account with the privacy pool",
        "Registration is public and links this wallet address to its viewing key",
        `Approve and pay the reviewed ${formatStrk20PoolFee(poolFeeFri)} pool fee from this account`,
      ],
      token: context.token,
    };
    const approvalContext = await createApprovalContext(
      context.accountContext.account,
      strk20WalletPreparationPayload(unsigned),
    );
    return {
      ok: true,
      strk20Preparation: deps.strk20Preparations.put({
        ...unsigned,
        context: approvalContext,
        id: approvalContext.payloadDigest,
      }),
    };
  } catch (error) {
    return {
      error: errorText(error, "Privacy registration preparation failed"),
      privacyBlocker: error instanceof PrivacyBlockerError ? error.kind : "service",
    };
  }
};

const registrationPreparation = async (deps: Strk20WalletOpsDeps): Promise<RuntimeResponse> => {
  // User-initiated: the user pressed "activate private balances".
  const context = await resolvePrivacyContext(deps, {
    active: await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore),
  });
  if ("error" in context) {
    return context;
  }
  return deps.strk20Jobs.start("register", (report) =>
    registrationPreparationWork(deps, context, report),
  );
};

/**
 * Handles privileged wallet privacy messages and returns null for other types.
 */
export const handleStrk20WalletOps = async (
  deps: Strk20WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.strk20State") {
    return readTypeOnlyInput(message, messageType)
      ? stateResponse(deps)
      : { error: "Invalid private balance request" };
  }
  if (messageType === "wallet.strk20PrepareRegistration") {
    return readTypeOnlyInput(message, messageType)
      ? registrationPreparation(deps)
      : { error: "Invalid privacy registration request" };
  }
  if (messageType === "wallet.strk20Execute") {
    const input = readStrk20WalletExecuteInput(message);
    return input
      ? executePreparation(deps, input.preparationId)
      : { error: "Invalid privacy execution request" };
  }
  return handleStrk20SendOps(deps, messageType, message);
};
