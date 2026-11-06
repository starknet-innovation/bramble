/**
 * The background half of the sponsored first shield (#789): whether to ask the
 * network's sponsor, and the frozen route a shield takes when it answers yes.
 *
 * The relay table is `SPONSORED_SHIELD_NETWORKS` in
 * `@bramble/privacy/sponsored-shield`; the gateway behind it is the on/off
 * switch, and while it answers 404 every shield is self-paid as before. Only a
 * self-credit shield asks, and only at preparation: a refusal, an outage, or
 * any answer outside the contract silently becomes the self-paid route the
 * user would have had anyway, before anything is reviewed. After review there is no fallback; the
 * route the user approved is the one submitted.
 */

import { WalletError } from "@bramble/core/errors";
import { approveCalls, RELAY_PAYS_POOL_FEE } from "@bramble/privacy/official-sdk-values";
import {
  quoteSponsoredShield,
  type SponsoredShieldConfig,
  SponsoredShieldRefusedError,
  SponsoredShieldUnavailableError,
  type Strk20SponsoredShieldPlan,
  sponsoredShieldConfig,
} from "@bramble/privacy/sponsored-shield";
import { systemClock } from "@bramble/transactions/activity";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import {
  PRIVACY_PUBLIC_BALANCE_UNCONFIRMED,
  privacyShortfall,
} from "@bramble/wallet-protocol/privacy-blocker";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { Call } from "starknet";
import {
  type ActivePrivacyContext,
  assertPrivacyAccountDeployed,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";

/** The sponsored-shield test seam, defined beside the privacy deps that carry it. */
export type { SponsoredShieldDeps } from "./strk20-op-context";

const systemSeconds = (): number => Math.floor(systemClock() / 1_000);

/**
 * A sponsor's yes, frozen for review: the plan, the relay that gave it, and the
 * deposit approvals its typed data commits to. Committed by the preparation
 * digest, so none of it can change between review and submission.
 */
export type SponsoredShieldOffer = {
  readonly approveCalls: readonly Call[];
  readonly plan: Strk20SponsoredShieldPlan;
  readonly relay: SponsoredShieldConfig;
};

/**
 * Asks the network's sponsor to pay for a self-credit shield. Resolves null,
 * without saying why, whenever the shield should go self-paid: no relay for
 * this network, a deposit to someone else, no pool configured, or a sponsor
 * that refused, was unreachable, or answered outside the contract. Rejects
 * only for an undeployed account, which no route can shield from.
 */
export const offerSponsoredShield = async (
  deps: Pick<Strk20WalletOpsDeps, "runtimeRpc" | "sponsoredShield">,
  context: ActivePrivacyContext,
  actions: readonly Strk20Action[],
  recipient: string,
): Promise<SponsoredShieldOffer | null> => {
  const account = context.accountContext.account;
  const relay = sponsoredShieldConfig(account.networkId, deps.sponsoredShield?.networks);
  const config = context.accountContext.config;
  const nowSeconds = deps.sponsoredShield?.nowSeconds ?? systemSeconds;
  if (
    !relay ||
    !config ||
    !sameFelt(recipient, account.address) ||
    actions.length === 0 ||
    actions.some((action) => action.type !== "deposit")
  ) {
    return null;
  }
  // The approvals ride in outside-execution typed data, which only a deployed
  // account can honour; the self-paid route refuses an undeployed one too.
  await assertPrivacyAccountDeployed(deps, context);
  const deposits = approveCalls(actions, config.poolAddress, RELAY_PAYS_POOL_FEE);
  try {
    const plan = await quoteSponsoredShield({
      accountAddress: account.address,
      approveCalls: deposits,
      chainId: STARKNET_NETWORKS[account.networkId].chainId,
      config: relay,
      ...(deps.sponsoredShield?.http ? { http: deps.sponsoredShield.http } : {}),
      nowSeconds: nowSeconds(),
      poolAddress: config.poolAddress,
    });
    return { approveCalls: deposits, plan, relay };
  } catch (error) {
    if (
      error instanceof SponsoredShieldRefusedError ||
      error instanceof SponsoredShieldUnavailableError
    ) {
      return null;
    }
    throw error;
  }
};

/**
 * Refuses a sponsored shield the public balance cannot cover. Only the
 * deposited amount leaves the user: the sponsor pays the pool fee and gas, so
 * unlike the self-paid check no STRK is required for fees.
 */
export const assertSponsoredDepositAffordable = async (
  deps: Pick<Strk20WalletOpsDeps, "runtimeRpc">,
  context: ActivePrivacyContext,
  amountRaw: string,
): Promise<void> => {
  const [balance] = await deps.runtimeRpc.getTokenBalances({
    accountAddress: context.accountContext.account.address,
    rpcUrls: context.accountContext.rpcUrls,
    tokens: [context.token],
  });
  if (
    !balance ||
    !sameFelt(balance.address, context.token.address) ||
    !/^\d+$/.test(balance.balance)
  ) {
    throw new WalletError(PRIVACY_PUBLIC_BALANCE_UNCONFIRMED);
  }
  if (BigInt(balance.balance) < BigInt(amountRaw)) {
    throw new WalletError(privacyShortfall(context.token.symbol, "public"));
  }
};

/**
 * The deposit batch the sponsored route relays: the sponsor's approvals (no
 * pool-fee approval), then the prepared `apply_actions` call unchanged. Throws
 * when the prepared batch does not end in that call.
 */
export const sponsoredDepositCalls = (
  offer: SponsoredShieldOffer,
  prepared: readonly Call[],
): readonly Call[] => {
  const applyActions = prepared.at(-1);
  if (applyActions?.entrypoint !== "apply_actions") {
    throw new WalletError("Shielding route unavailable");
  }
  return [...offer.approveCalls, applyActions];
};
