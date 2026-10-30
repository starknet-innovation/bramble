/**
 * Shared active-account resolution for extension-owned STRK20 operations.
 * Split from ./strk20-wallet-ops so the shielding and private-send handlers
 * consume one context builder without an import cycle. Fails closed on a
 * missing network configuration, Ledger accounts, and untracked tokens.
 */

import { WalletError, walletErrorMessage } from "@bramble/core/errors";
import type { PriceService } from "@bramble/portfolio/prices";
import type { Strk20PhaseSink } from "@bramble/privacy/phases";
import { canonicalStrk20PoolFee, type Strk20AccountContext } from "@bramble/privacy/service";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { STARKNET_NETWORKS, STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { withTokenId } from "@bramble/wallet-model/preferences";
import {
  PRIVACY_DEPLOY_REQUIRED,
  PRIVACY_PUBLIC_BALANCE_UNCONFIRMED,
  PrivacyBlockerError,
  type PrivacyBlockerKind,
  privacyShortfall,
} from "@bramble/wallet-protocol/privacy-blocker";
import type { Strk20Proof } from "@bramble/wallet-protocol/strk20";
import type { Call } from "starknet";
import type { WalletOpsDeps } from "../accounts/wallet-ops";
import { type ActiveAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import {
  type TrustedRecipientSources,
  withTrustedRecipients,
} from "../transactions/trusted-recipients";
import { strk20AccountContext } from "./strk20-account-context";
import type { Strk20JobRegistry } from "./strk20-preparation-jobs";
import { strk20RegistrationBlock } from "./strk20-registration-owner";
import type { Strk20WalletPreparationStore } from "./strk20-wallet-preparations";

/**
 * Extension-owned privacy dependencies: the one-time preparation store that
 * keeps executable payloads out of the side panel, and the job registry that
 * lets a proof outlive the runtime request that asked for it.
 */
export type Strk20WalletOpsDeps = WalletOpsDeps & {
  /**
   * Fiat price feed used to bound a converted pool fee. Optional so partial test
   * stubs stay valid; a missing feed prices nothing, which leaves the Send gate
   * on the fee token exactly as the relay quote would fall back.
   */
  readonly prices?: PriceService;
  readonly strk20Jobs: Strk20JobRegistry;
  readonly strk20Preparations: Strk20WalletPreparationStore;
};

/**
 * Resolved active account, its privacy configuration, and the selected token.
 */
export type ActivePrivacyContext = {
  readonly accountContext: Strk20AccountContext;
  /** Carries the address-poisoning trust inputs (audit #163) for the pool routes. */
  readonly preferences: WalletPreferences & TrustedRecipientSources;
  readonly token: TokenConfig;
};

/**
 * The same context with a phase sink attached, for the service calls a tracked
 * job makes. The sink is the only addition: the account, its signer, and the
 * viewing-key thunk stay bound to the unlock that resolved the context, so a
 * lock during the job still revokes them.
 */
export const reportingPrivacyContext = (
  context: ActivePrivacyContext,
  onPhase: Strk20PhaseSink,
): ActivePrivacyContext => ({
  ...context,
  accountContext: { ...context.accountContext, onPhase },
});

/**
 * Returns only wallet-authored errors to the UI. SDK, RPC, and service errors
 * collapse to a stable fallback so internal diagnostics never reach toast copy.
 */
export const errorText = (error: unknown, fallback: string): string =>
  walletErrorMessage(error, fallback);

const firstNetworkToken = (preferences: WalletPreferences, networkId: string): TokenConfig | null =>
  preferences.tokens.find((token) => token.networkId === networkId) ?? null;

/**
 * Reads the active account's public balance of the context's token, in raw units.
 *
 * An unreadable balance is reported as zero, which fails closed: a deposit is
 * refused rather than proposed against a balance that could not be confirmed.
 */
export const publicBalance = async (
  deps: Strk20WalletOpsDeps,
  context: ActivePrivacyContext,
): Promise<bigint> => {
  const [balance] = await deps.runtimeRpc.getTokenBalances({
    accountAddress: context.accountContext.account.address,
    rpcUrls: context.accountContext.rpcUrls,
    tokens: [context.token],
  });
  return balance ? BigInt(balance.balance) : 0n;
};

const strkTokenFor = (context: ActivePrivacyContext): TokenConfig =>
  context.preferences.tokens.find(
    (token) =>
      token.networkId === context.accountContext.account.networkId &&
      sameFelt(token.address, STRK_TOKEN_ADDRESS),
  ) ??
  // Through the shared id builder, never a local interpolation of the same
  // three fields: a fallback whose id drifted from a stored token's would be
  // compared against it and silently miss.
  withTokenId({
    address: STRK_TOKEN_ADDRESS,
    decimals: 18,
    name: "Starknet Token",
    networkId: context.accountContext.account.networkId,
    symbol: "STRK",
  });

/**
 * Re-checks every public token the pool can pull immediately before a review
 * is created and again before submission. Missing or malformed RPC balances
 * fail closed; a STRK deposit accounts for its amount and pool fee together.
 */
export const assertPublicPoolSpendAffordable = async (
  deps: Pick<Strk20WalletOpsDeps, "runtimeRpc">,
  context: ActivePrivacyContext,
  poolFeeFri: string,
  depositAmountRaw?: string,
): Promise<void> => {
  const fee = BigInt(canonicalStrk20PoolFee(poolFeeFri));
  const strk = strkTokenFor(context);
  const depositIsStrk = sameFelt(context.token.address, STRK_TOKEN_ADDRESS);
  const tokens = depositAmountRaw === undefined || depositIsStrk ? [strk] : [context.token, strk];
  const balances = await deps.runtimeRpc.getTokenBalances({
    accountAddress: context.accountContext.account.address,
    rpcUrls: context.accountContext.rpcUrls,
    tokens,
  });
  const balanceOf = (address: string): bigint => {
    const entry = balances.find((balance) => sameFelt(balance.address, address));
    if (!entry || !/^\d+$/.test(entry.balance)) {
      throw new WalletError(PRIVACY_PUBLIC_BALANCE_UNCONFIRMED);
    }
    return BigInt(entry.balance);
  };
  const amount = depositAmountRaw === undefined ? 0n : BigInt(depositAmountRaw);
  if (depositIsStrk) {
    if (balanceOf(STRK_TOKEN_ADDRESS) < amount + fee) {
      throw new PrivacyBlockerError("fund", "Not enough STRK for the amount and pool fee");
    }
    return;
  }
  if (depositAmountRaw !== undefined && balanceOf(context.token.address) < amount) {
    throw new WalletError(privacyShortfall(context.token.symbol, "public"));
  }
  if (balanceOf(STRK_TOKEN_ADDRESS) < fee) {
    throw new PrivacyBlockerError("fund", "Not enough STRK for the pool fee");
  }
};

/**
 * Estimates the exact frozen public privacy batch and refuses undeployed
 * accounts, whose separate deployment fee has not been reviewed on this card.
 */
export const estimatePublicStrk20Fee = async (
  deps: Pick<Strk20WalletOpsDeps, "runtimeRpc">,
  context: ActivePrivacyContext,
  calls: readonly Call[],
  proof: Strk20Proof,
): Promise<FeeEstimate> => {
  await assertPrivacyAccountDeployed(deps, context);
  return deps.runtimeRpc.estimateInvokeFee({
    account: context.accountContext.account,
    calls,
    proof,
    rpcUrls: context.accountContext.rpcUrls,
    signHash: context.accountContext.signHash,
  });
};

/** Checks chain deployment before any registration discovery, fee read, or proof. RPC failures fail closed. */
export const assertPrivacyAccountDeployed = async (
  deps: Pick<Strk20WalletOpsDeps, "runtimeRpc">,
  context: ActivePrivacyContext,
): Promise<void> => {
  if (
    !(await deps.runtimeRpc.getDeploymentStatus({
      accountAddress: context.accountContext.account.address,
      rpcUrls: context.accountContext.rpcUrls,
    }))
  ) {
    throw new PrivacyBlockerError("deploy", PRIVACY_DEPLOY_REQUIRED);
  }
};

/**
 * Builds the protected account context for one privacy operation, selecting
 * `tokenId` or the network's first tracked token. Returns a displayable error
 * instead of throwing so handlers stay single-shape.
 *
 * The account context is an argument rather than something resolved here
 * because resolving it is what decides whether the unlock window is renewed.
 * The disclosure read the privacy screen polls passes
 * `observedAccountContext`; the preparation and execution routes the user just
 * triggered pass `activeAccountContext`. Keeping that choice at the
 * call site is what stops one shared builder from silently renewing the
 * inactivity window for ambient traffic (MCW-V09-105).
 */
export const resolvePrivacyContext = async (
  deps: Strk20WalletOpsDeps,
  input: { readonly active: ActiveAccountContext; readonly tokenId?: string },
): Promise<
  ActivePrivacyContext | { readonly error: string; readonly privacyBlocker?: PrivacyBlockerKind }
> => {
  const { active, tokenId } = input;
  if (active.error !== undefined) {
    return { error: active.error };
  }
  const preferences = await withTrustedRecipients(
    deps,
    await deps.preferencesStore.read(),
    active.accounts,
  );
  const config = preferences.strk20Networks?.[active.networkId] ?? null;
  if (!config) {
    return {
      error: "Private balances are not configured for this network",
      privacyBlocker: "network",
    };
  }
  if (active.account.derivation.kind === "ledger") {
    // TODO: Ledger provisioning retains a viewing key (`ledger-strk20-typed-data-v1`
    // in account-secrets.ts). Once that ships, compare the pool key with the
    // public key of that retained key instead of refusing every Ledger account
    // here. This blocker stays first so a pool read never reclassifies one.
    return {
      error: "Private balances are not available for Ledger accounts",
      privacyBlocker: "ledger",
    };
  }
  const registration = await strk20RegistrationBlock({
    account: active.account,
    passphrase: active.vaultPassphrase,
    preferences,
    readRegistered: deps.runtimeRpc.getStrk20PublicKey,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[active.networkId], preferences),
    wallet: deps.wallet,
  });
  if (registration) return registration;
  const token = tokenId
    ? preferences.tokens.find(
        (stored) => stored.id === tokenId && stored.networkId === active.networkId,
      )
    : firstNetworkToken(preferences, active.networkId);
  if (!token) {
    return { error: "Track a token before activating private balances" };
  }
  return {
    accountContext: strk20AccountContext(
      {
        ...(deps.ledgerSignQueue ? { ledgerSignQueue: deps.ledgerSignQueue } : {}),
        // The extension-owned privacy flows bind their vault signer to the same
        // unlock every public path uses, so an explicit lock revokes a private
        // transfer in flight instead of letting it complete.
        session: deps.session,
        wallet: deps.wallet,
      },
      {
        account: active.account,
        passphrase: active.vaultPassphrase,
        preferences,
        rpcUrls: networkRpcUrls(STARKNET_NETWORKS[active.networkId], preferences),
      },
    ),
    preferences,
    token,
  };
};
