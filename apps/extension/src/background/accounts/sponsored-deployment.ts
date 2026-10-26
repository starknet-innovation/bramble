/**
 * Sponsored account deployment (#431, #706): the Starknet Foundation pays the
 * network fee for a new account that cannot pay its own deploy. A deploy that
 * may be in flight holds the account in the durable pending-deployment store
 * (`./pending-deployments`), which every deploy route consults.
 *
 * Off on every network until a relay is configured (`SPONSORED_DEPLOY_NETWORKS`
 * in `@bramble/privacy/sponsored-deploy`). The offer is made only when the
 * account's class can be deployed this way, the account is not deployed, and
 * its STRK balance is known to fall short of the deploy fee; an unknown balance
 * or fee makes no offer and leaves today's flow as it is. Nothing is signed on
 * this route: the deployment data commits to the stored address (see the
 * client), and the user pays nothing, so no fee is ever shown or recorded as
 * theirs.
 */

import {
  isSponsorableAccountType,
  type PaymasterHttp,
  quoteSponsoredDeploy,
  SPONSORED_DEPLOY_UNSUPPORTED,
  type SponsoredDeployConfig,
  type SponsoredDeploymentData,
  type SponsoredDeployNetworks,
  sponsoredDeployConfig,
  sponsoredDeploymentData,
  submitSponsoredDeploy,
} from "@bramble/privacy/sponsored-deploy";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { accountDeployment } from "@bramble/starknet/deployment";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import type { StarkHashSigner } from "@bramble/starknet/rpc";
import { type ActivityLog, systemClock } from "@bramble/transactions/activity";
import { resolveFeeAffordability } from "@bramble/transactions/fee-funds";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { afterBroadcast, recordSubmittedActivity } from "../transactions/activity-recording";
import { readStrkBalance } from "../transactions/fee-guard";
import { DEPLOY_ACTIVITY_SUMMARY } from "./deployment-ops";
import {
  DEPLOYMENT_MAY_BE_ON_ITS_WAY,
  type PendingDeployments,
  resolvePendingDeployment,
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

/** What the deploy screen may offer: sponsored, declined by the sponsor, or nothing. */
export type DeploySponsorship = "available" | "none" | "refused";

/** The chain could not say whether the account is deployed; nothing was sent. */
export const DEPLOYMENT_STATUS_UNKNOWN =
  "Couldn't confirm whether this account is deployed. Check your connection and try again.";

const UNAVAILABLE = { error: "sponsored deployment unavailable" } as const;

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
  isSponsorableAccountType(account.accountContractType)
    ? sponsoredDeployConfig(account.networkId, deps.sponsoredDeploy?.networks)
    : null;

const hasPendingDeploy = async (
  deps: SponsoredDeploymentDeps,
  account: AccountRef,
): Promise<boolean> => {
  const pending = deps.pendingDeployments;
  if (!pending) return true;
  await pending.load();
  return pending.pending(account) !== undefined;
};

// The relay answered no; told apart from a failed read, which offers nothing.
class SponsorDeclined extends Error {}

/**
 * Decides what the deploy screen may offer. "none" unless sponsorship is on
 * for the network, the class is sponsorable, no deploy of the account is
 * pending, the account is confirmed undeployed, and its STRK balance is
 * confirmed short of the deploy fee; then the relay is asked, and its answer
 * is "available" or "refused". Never throws and never sends a transaction.
 */
export const deploySponsorship = async (
  deps: SponsoredDeploymentDeps,
  input: { readonly account: AccountRef; readonly signHash: StarkHashSigner },
): Promise<DeploySponsorship> => {
  const config = relayFor(deps, input.account);
  if (!config) return "none";
  try {
    if (await hasPendingDeploy(deps, input.account)) return "none";
    const rpcUrls = await rpcUrlsFor(deps, input.account);
    if ((await deploymentStatus(deps, input.account, rpcUrls)) !== "undeployed") return "none";
    const estimate = deps.runtimeRpc.estimateAccountDeploymentFee;
    if (!estimate) return "none";
    const fee = await estimate({ account: input.account, rpcUrls, signHash: input.signHash });
    const balance = await readStrkBalance(deps, input.account, await deps.preferencesStore.read());
    if (resolveFeeAffordability({ balance, fee }) !== "insufficient") return "none";
    const deployment = sponsoredDeploymentData(accountDeployment(input.account));
    await quoteSponsoredDeploy({
      config,
      deployment,
      ...(deps.sponsoredDeploy?.http ? { http: deps.sponsoredDeploy.http } : {}),
    }).catch(() => {
      throw new SponsorDeclined();
    });
    return "available";
  } catch (error) {
    return error instanceof SponsorDeclined ? "refused" : "none";
  }
};

type SponsoredRoute = {
  readonly config: SponsoredDeployConfig;
  readonly deployment: SponsoredDeploymentData;
  readonly pending: PendingDeployments;
};

// The refusals that need neither the chain nor a reservation: the class, the
// route, the guard, and deployment data that cannot reproduce the address.
const sponsoredRoute = (
  deps: SponsoredDeploymentDeps,
  account: AccountRef,
): SponsoredRoute | { readonly error: string } => {
  if (!isSponsorableAccountType(account.accountContractType)) {
    return { error: SPONSORED_DEPLOY_UNSUPPORTED };
  }
  const config = relayFor(deps, account);
  const pending = deps.pendingDeployments;
  if (!config || !pending) return UNAVAILABLE;
  try {
    return { config, deployment: sponsoredDeploymentData(accountDeployment(account)), pending };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "deployment unavailable" };
  }
};

// Reserves the account: a synchronous check-and-set once the store is loaded,
// so two submissions in this worker cannot both pass. A standing entry is first
// resolved against the chain and Activity; only a released one is retried.
const reserve = async (
  deps: SponsoredDeploymentDeps,
  pending: PendingDeployments,
  account: AccountRef,
  rpcUrls: readonly string[],
): Promise<{ readonly error: string } | null> => {
  const now = (deps.now ?? systemClock)();
  await pending.load();
  if (pending.reserve(account, now)) return null;
  const state = await resolvePendingDeployment(
    { ...deps, pendingDeployments: pending },
    account,
    rpcUrls,
  );
  if (state === "deployed") return { error: "account already deployed" };
  return state === "clear" && pending.reserve(account, now)
    ? null
    : { error: DEPLOYMENT_MAY_BE_ON_ITS_WAY };
};

// Sends the reserved deploy. Anything that sent nothing releases the entry; a
// lost reply keeps it, and an accepted deploy keeps it with its hash.
const send = async (
  deps: SponsoredDeploymentDeps,
  route: SponsoredRoute,
  input: { readonly account: AccountRef; readonly isAuthorized: () => boolean },
): Promise<RuntimeResponse> => {
  const { account } = input;
  const http = deps.sponsoredDeploy?.http ? { http: deps.sponsoredDeploy.http } : {};
  let transactionHash: string;
  try {
    const quote = await quoteSponsoredDeploy({
      config: route.config,
      deployment: route.deployment,
      ...http,
    });
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
    await route.pending.release(account).catch(() => undefined);
    return { error: error instanceof Error ? error.message : "sponsored deployment failed" };
  }
  await route.pending.recordHash(account, transactionHash).catch(() => undefined);
  await afterBroadcast(() =>
    recordSubmittedActivity(deps.activity, {
      accountId: account.id,
      feePayer: "sponsor",
      hash: transactionHash,
      kind: "deploy",
      networkId: account.networkId,
      summary: DEPLOY_ACTIVITY_SUMMARY,
    }),
  );
  return { ok: true, transactionHash };
};

/**
 * Deploys the account through the sponsor. Refuses with no request when the
 * class is unsupported or the route or guard is off; while another deploy of
 * the account may land ({@link DEPLOYMENT_MAY_BE_ON_ITS_WAY}); when the chain
 * shows it deployed; and when the chain cannot say
 * ({@link DEPLOYMENT_STATUS_UNKNOWN}). The reservation is persisted before the
 * relay hears anything, and released only when the attempt sent nothing. A
 * lost reply is answered as submission-unknown. An accepted deploy is
 * recorded in Activity as sponsored, so no fee is ever attributed to the user.
 */
export const submitSponsoredAccountDeployment = async (
  deps: SponsoredDeploymentDeps,
  input: { readonly account: AccountRef; readonly isAuthorized: () => boolean },
): Promise<RuntimeResponse> => {
  const { account } = input;
  const route = sponsoredRoute(deps, account);
  if ("error" in route) return route;
  const rpcUrls = await rpcUrlsFor(deps, account);
  const refused = await reserve(deps, route.pending, account, rpcUrls);
  if (refused) return refused;
  const status = await route.pending
    .persist()
    .then(() => deploymentStatus(deps, account, rpcUrls))
    .catch(() => null);
  if (status === "undeployed") return send(deps, route, input);
  await route.pending.release(account).catch(() => undefined);
  if (status === null) return UNAVAILABLE;
  return status === "deployed"
    ? { error: "account already deployed" }
    : { error: DEPLOYMENT_STATUS_UNKNOWN };
};
