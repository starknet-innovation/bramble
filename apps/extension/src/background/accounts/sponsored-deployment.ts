/**
 * Sponsored account deployment (#431, #706): the Starknet Foundation pays the
 * network fee for a new account that cannot pay its own deploy. Each attempt
 * opens a bounded hold in the durable store in `./pending-deployments`, which
 * every deploy route consults, and is never offered again once accepted or
 * lost.
 *
 * The relay table is `SPONSORED_DEPLOY_NETWORKS` in
 * `@bramble/privacy/sponsored-deploy`; the gateway behind it is the on/off
 * switch. The offer is made only when the account's exact class and
 * constructor are ones the gateway sponsors, the account is not deployed, its
 * STRK balance is known to fall short of the deploy fee, and the gateway quotes
 * it. Anything else — an unknown balance or fee, a switched-off or unreachable
 * gateway, any quote it does not give — makes no offer, and the screen deploys
 * self-paid as if sponsorship did not exist. Nothing is signed on
 * this route: the deployment data commits to the stored address (see the
 * client), and the user pays nothing, so no fee is ever shown or recorded as
 * theirs.
 */

import {
  type DeploySponsorship,
  isSponsorableAccountClass,
  isSponsorableDeployment,
  type PaymasterHttp,
  quoteSponsoredDeploy,
  type SponsoredDeployConfig,
  type SponsoredDeploymentData,
  type SponsoredDeployNetworks,
  SponsoredDeployRefusedError,
  sponsoredDeployConfig,
  sponsoredDeploymentData,
  submitSponsoredDeploy,
} from "@bramble/privacy/sponsored-deploy";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { accountDeployment } from "@bramble/starknet/deployment";
import {
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
} from "@bramble/starknet/provider";
import type { StarkHashSigner } from "@bramble/starknet/rpc";
import { type ActivityLog, systemClock } from "@bramble/transactions/activity";
import { resolveFeeAffordability } from "@bramble/transactions/fee-funds";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { recordSubmittedActivityIfAbsent } from "../transactions/activity-recording";
import { readStrkBalance } from "../transactions/fee-guard";
import { DEPLOY_ACTIVITY_SUMMARY } from "./deployment-ops";
import {
  DEPLOYMENT_IN_PROGRESS,
  type PendingDeployments,
  refusalWindowEnd,
  sponsoredAttemptState,
} from "./pending-deployments";

/** Collaborators for the sponsored route; `sponsoredDeploy` is a test seam. */
export type SponsoredDeploymentDeps = {
  readonly activity: ActivityLog;
  /** Wall clock for pending entries; defaults to the system clock boundary. */
  readonly now?: () => number;
  /** The shared deploy guard; without it the sponsored route refuses. */
  readonly pendingDeployments?: PendingDeployments;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  /**
   * Relay table and transport. Production leaves it unset: the bundled table
   * (off everywhere) and `fetch`.
   */
  readonly sponsoredDeploy?: {
    readonly http?: PaymasterHttp;
    readonly networks?: SponsoredDeployNetworks;
  };
};

/** The chain could not say whether the account is deployed; nothing was sent. */
export const DEPLOYMENT_STATUS_UNKNOWN =
  "Couldn't confirm whether this account is deployed. Check your connection and try again.";

/**
 * The sponsor is not deploying this account and nothing was sent: the class
 * is not one it sponsors, the route or store is off, an earlier attempt rules
 * it out, or the gateway refused or could not quote. Not an error: the screen
 * silently becomes the self-paid one.
 */
export const SPONSORED_DEPLOY_DECLINED = { ok: true, sponsored: false } as const;

type Declined = typeof SPONSORED_DEPLOY_DECLINED;

const rpcUrlsFor = async (
  deps: SponsoredDeploymentDeps,
  account: AccountRef,
): Promise<readonly string[]> =>
  networkRpcUrls(STARKNET_NETWORKS[account.networkId], await deps.preferencesStore.read());

// A failed read is "unknown", never a verdict either way.
const deploymentStatus = (
  deps: SponsoredDeploymentDeps,
  account: AccountRef,
  rpcUrls: readonly string[],
): Promise<"deployed" | "undeployed" | "unknown"> =>
  deps.runtimeRpc
    .getDeploymentStatus({ accountAddress: account.address, rpcUrls })
    .then((deployed): "deployed" | "undeployed" => (deployed ? "deployed" : "undeployed"))
    .catch(() => "unknown" as const);

const relayFor = (deps: SponsoredDeploymentDeps, account: AccountRef) =>
  isSponsorableAccountClass(account.classHash)
    ? sponsoredDeployConfig(account.networkId, deps.sponsoredDeploy?.networks)
    : null;

// The deployment the gateway would sponsor, or null for a class or constructor
// it does not accept. Throws when the data cannot reproduce the stored address.
const sponsorableDeployment = (account: AccountRef): SponsoredDeploymentData | null => {
  const data = sponsoredDeploymentData(accountDeployment(account));
  return isSponsorableDeployment(data) ? data : null;
};

const nowOf = (deps: SponsoredDeploymentDeps): number => (deps.now ?? systemClock)();

// Whether a fresh offer may be made, and if so with which relay: no earlier
// attempt, a confirmed-undeployed account, and a STRK balance confirmed short.
const freshOfferRelay = async (
  deps: SponsoredDeploymentDeps,
  input: { readonly account: AccountRef; readonly signHash: StarkHashSigner },
  rpcUrls: readonly string[],
) => {
  const config = relayFor(deps, input.account);
  const estimate = deps.runtimeRpc.estimateAccountDeploymentFee;
  if (!config || !estimate) return null;
  if ((await deploymentStatus(deps, input.account, rpcUrls)) !== "undeployed") return null;
  const fee = await estimate({ account: input.account, rpcUrls, signHash: input.signHash });
  const balance = await readStrkBalance(deps, input.account, await deps.preferencesStore.read());
  return resolveFeeAffordability({ balance, fee }) === "insufficient" ? config : null;
};

/**
 * Decides what the deploy screen may offer. An earlier attempt answers "held"
 * while its hold stands and "none" after it; it is never offered again. An
 * account the sponsor refused answers "none" until its refusal window ends, without
 * asking the relay. Otherwise "none" unless
 * sponsorship is on for the network, the class and constructor are ones the
 * gateway sponsors, the account is confirmed undeployed, and its STRK balance
 * is confirmed short of the fee; then the relay is asked, and only its exact
 * quote answers "available". Every quote failure — the gateway switched off
 * (`404 sponsored_deploy_disabled`), a refusal, a rate limit, a 5xx, a
 * transport failure, an unusable answer — is "none": the user never asked for
 * sponsorship, so its absence is not news. Never throws and never sends.
 */
export const deploySponsorship = async (
  deps: SponsoredDeploymentDeps,
  input: { readonly account: AccountRef; readonly signHash: StarkHashSigner },
): Promise<DeploySponsorship> => {
  const pending = deps.pendingDeployments;
  if (!pending) return "none";
  try {
    const rpcUrls = await rpcUrlsFor(deps, input.account);
    const attempt = await sponsoredAttemptState(
      { ...deps, pendingDeployments: pending },
      input.account,
      rpcUrls,
      nowOf(deps),
    );
    if (attempt === "held") return "held";
    // An earlier attempt (lost, accepted, refused in its window) is not offered
    // again, and an unreadable store may be hiding one: never offer then.
    if (attempt !== "none" || !pending.readable()) return "none";
    const deployment = sponsorableDeployment(input.account);
    if (!deployment) return "none";
    const config = await freshOfferRelay(deps, input, rpcUrls);
    if (!config) return "none";
    await quoteSponsoredDeploy({
      config,
      deployment,
      ...(deps.sponsoredDeploy?.http ? { http: deps.sponsoredDeploy.http } : {}),
    });
    return "available";
  } catch {
    return "none";
  }
};

type SponsoredRoute = {
  readonly config: SponsoredDeployConfig;
  readonly deployment: SponsoredDeploymentData;
  readonly pending: PendingDeployments;
};

// The refusals that need neither the chain nor a reservation: the class, the
// route, the store, and deployment data that cannot reproduce the address.
const sponsoredRoute = (
  deps: SponsoredDeploymentDeps,
  account: AccountRef,
): SponsoredRoute | Declined | { readonly error: string } => {
  const config = relayFor(deps, account);
  const pending = deps.pendingDeployments;
  if (!config || !pending) return SPONSORED_DEPLOY_DECLINED;
  try {
    const deployment = sponsorableDeployment(account);
    return deployment ? { config, deployment, pending } : SPONSORED_DEPLOY_DECLINED;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "deployment unavailable" };
  }
};

// Reserves the account: a synchronous check-and-set once the store is loaded,
// so a double press cannot send twice. An earlier attempt is resolved instead
// and never repeated.
const reserve = async (
  deps: SponsoredDeploymentDeps,
  pending: PendingDeployments,
  account: AccountRef,
  rpcUrls: readonly string[],
): Promise<Declined | { readonly error: string } | null> => {
  const now = nowOf(deps);
  await pending.load();
  const reserved = pending.reserve(account, now);
  if (reserved === "reserved") return null;
  if (reserved === "full") return SPONSORED_DEPLOY_DECLINED;
  const state = await sponsoredAttemptState(
    { ...deps, pendingDeployments: pending },
    account,
    rpcUrls,
    now,
  );
  if (state === "deployed") return { error: "account already deployed" };
  if (state === "held") return { error: DEPLOYMENT_IN_PROGRESS };
  return state === "none" && pending.reserve(account, now) === "reserved"
    ? null
    : SPONSORED_DEPLOY_DECLINED;
};

// The sponsor said no and nothing was sent. A refusal with a known window
// (budget spent, an attempt this hour) stops offers to this account until it
// ends; any other refusal is not remembered. A record that cannot be written
// falls back to forgetting the attempt, which still leaves a self-paid deploy.
const declined = async (
  deps: SponsoredDeploymentDeps,
  pending: PendingDeployments,
  account: AccountRef,
  refusal: SponsoredDeployRefusedError,
): Promise<Declined> => {
  const now = nowOf(deps);
  const until = refusalWindowEnd(refusal.reason, now);
  await (until === null ? pending.forget(account) : pending.recordRefusal(account, now, until))
    .catch(() => pending.forget(account))
    .catch(() => undefined);
  return SPONSORED_DEPLOY_DECLINED;
};

// A determinate broadcast refusal sent nothing. The gateway refuses an account
// it finds deployed (`409 account_already_deployed`), so the chain is read
// again: deployed is shown as deployed, anything else turns self-paid.
const refusedBroadcast = async (
  deps: SponsoredDeploymentDeps,
  route: SponsoredRoute,
  account: AccountRef,
  rpcUrls: readonly string[],
  refusal: SponsoredDeployRefusedError,
): Promise<RuntimeResponse> => {
  if ((await deploymentStatus(deps, account, rpcUrls)) !== "deployed") {
    return declined(deps, route.pending, account, refusal);
  }
  await route.pending.forget(account).catch(() => undefined);
  return { error: "account already deployed" };
};

// Sends the reserved deploy. Anything that sent nothing forgets the attempt; a
// lost reply keeps it, and an accepted deploy keeps it with its hash.
const send = async (
  deps: SponsoredDeploymentDeps,
  route: SponsoredRoute,
  input: { readonly account: AccountRef; readonly isAuthorized: () => boolean },
  rpcUrls: readonly string[],
): Promise<RuntimeResponse> => {
  const { account } = input;
  const http = deps.sponsoredDeploy?.http ? { http: deps.sponsoredDeploy.http } : {};
  let quote: Awaited<ReturnType<typeof quoteSponsoredDeploy>>;
  try {
    quote = await quoteSponsoredDeploy({
      config: route.config,
      deployment: route.deployment,
      ...http,
    });
  } catch (error) {
    // A quote never broadcasts. Whatever stopped it — switched off, refused,
    // unreachable — the sponsor is not covering this press: self-paid, no
    // retry. Only the gateway's own no can be remembered (see `declined`).
    if (error instanceof SponsoredDeployRefusedError) {
      return declined(deps, route.pending, account, error);
    }
    await route.pending.forget(account).catch(() => undefined);
    return SPONSORED_DEPLOY_DECLINED;
  }
  let transactionHash: string;
  try {
    ({ transactionHash } = await submitSponsoredDeploy({
      config: route.config,
      isAuthorized: input.isAuthorized,
      quote,
      ...http,
    }));
  } catch (error) {
    if (error instanceof IndeterminateRpcWriteError) {
      return submissionUnknownResponse(error.message);
    }
    if (error instanceof SponsoredDeployRefusedError) {
      return refusedBroadcast(deps, route, account, rpcUrls, error);
    }
    await route.pending.forget(account).catch(() => undefined);
    return { error: error instanceof Error ? error.message : "sponsored deployment failed" };
  }
  // The hash is the relay's claim. One this wallet already holds a row for
  // would replace that row and shed its fee, so the row is written only if no
  // row of any account carries the hash, checked and written as one store
  // mutation. Otherwise — or when the log cannot say — it is not tied to the
  // attempt: the hold stays, and the chain decides when it ends.
  const recorded = await recordSubmittedActivityIfAbsent(deps.activity, {
    accountId: account.id,
    feePayer: "sponsor",
    hash: transactionHash,
    kind: "deploy",
    networkId: account.networkId,
    summary: DEPLOY_ACTIVITY_SUMMARY,
  }).catch(() => false);
  if (!recorded) return submissionUnknownResponse(INDETERMINATE_RPC_WRITE_MESSAGE);
  await route.pending.recordHash(account, transactionHash).catch(() => undefined);
  return { ok: true, transactionHash };
};

/**
 * Deploys the account through the sponsor. Answers
 * {@link SPONSORED_DEPLOY_DECLINED}, with nothing sent, when the class is not
 * sponsored, the route or store is off, an earlier attempt was accepted, lost
 * or refused within its window, the attempt cannot be stored, any quote fails,
 * or the gateway refuses the broadcast; a budget refusal also stops offers to
 * the account until 00:00 UTC, an already-attempted one for an hour. Refuses during an earlier attempt's hold
 * ({@link DEPLOYMENT_IN_PROGRESS}), when the chain shows it deployed (also
 * after a broadcast refusal), and when the chain cannot say
 * ({@link DEPLOYMENT_STATUS_UNKNOWN}). The attempt is persisted before the
 * relay hears anything. A lost reply is answered as submission-unknown, and so
 * is a relay hash Activity already holds. Otherwise the relay's hash is
 * recorded in Activity as a sponsored deploy, so no fee is ever attributed to
 * the user. The hash is the relay's
 * claim: whether the account is deployed is read from the chain, never from
 * that hash's receipt.
 */
export const submitSponsoredAccountDeployment = async (
  deps: SponsoredDeploymentDeps,
  input: { readonly account: AccountRef; readonly isAuthorized: () => boolean },
): Promise<RuntimeResponse> => {
  const { account } = input;
  const route = sponsoredRoute(deps, account);
  if (!("config" in route)) return route;
  const rpcUrls = await rpcUrlsFor(deps, account);
  const refused = await reserve(deps, route.pending, account, rpcUrls);
  if (refused) return refused;
  const status = await route.pending
    .persist()
    .then(() => deploymentStatus(deps, account, rpcUrls))
    .catch(() => null);
  if (status === "undeployed") return send(deps, route, input, rpcUrls);
  await route.pending.forget(account).catch(() => undefined);
  if (status === null) return SPONSORED_DEPLOY_DECLINED;
  return status === "deployed"
    ? { error: "account already deployed" }
    : { error: DEPLOYMENT_STATUS_UNKNOWN };
};
