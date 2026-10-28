/**
 * Sponsored account deployment (#431, #706): the Starknet Foundation pays the
 * network fee for a new account that cannot pay its own deploy. Each attempt
 * opens a bounded hold in the durable store in `./pending-deployments`, which
 * every deploy route consults, and is never offered again once accepted or
 * lost.
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
  type DeploySponsorship,
  isSponsorableAccountType,
  type PaymasterHttp,
  quoteSponsoredDeploy,
  SPONSORED_DEPLOY_UNSUPPORTED,
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
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
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

/** A sponsored attempt was already accepted or lost; it is never repeated. */
export const SPONSORED_DEPLOY_ALREADY_SENT =
  "This account's sponsored deployment was already sent and may still land. Add STRK to deploy it yourself.";

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
 * or "may-land" and is never offered again. Otherwise "none" unless
 * sponsorship is on for the network, the class is sponsorable, the account is
 * confirmed undeployed, and its STRK balance is confirmed short of the fee;
 * then the relay is asked: "available", "refused" only for its explicit no,
 * and "none" when it cannot be reached. Never throws and never sends.
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
    if (attempt === "held" || attempt === "may-land") return attempt;
    // An unreadable store may be hiding an attempt it lost: never offer then.
    if (attempt === "deployed" || !pending.readable()) return "none";
    const config = await freshOfferRelay(deps, input, rpcUrls);
    if (!config) return "none";
    await quoteSponsoredDeploy({
      config,
      deployment: sponsoredDeploymentData(accountDeployment(input.account)),
      ...(deps.sponsoredDeploy?.http ? { http: deps.sponsoredDeploy.http } : {}),
    });
    return "available";
  } catch (error) {
    return error instanceof SponsoredDeployRefusedError ? "refused" : "none";
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
// so a double press cannot send twice. An earlier attempt is resolved instead
// and never repeated.
const reserve = async (
  deps: SponsoredDeploymentDeps,
  pending: PendingDeployments,
  account: AccountRef,
  rpcUrls: readonly string[],
): Promise<{ readonly error: string } | null> => {
  const now = nowOf(deps);
  await pending.load();
  const reserved = pending.reserve(account, now);
  if (reserved === "reserved") return null;
  if (reserved === "full") return UNAVAILABLE;
  const state = await sponsoredAttemptState(
    { ...deps, pendingDeployments: pending },
    account,
    rpcUrls,
    now,
  );
  if (state === "deployed") return { error: "account already deployed" };
  if (state === "held") return { error: DEPLOYMENT_MAY_BE_ON_ITS_WAY };
  return state === "none" && pending.reserve(account, now) === "reserved"
    ? null
    : { error: SPONSORED_DEPLOY_ALREADY_SENT };
};

// Whether no Activity row of any account already carries `hash`. An
// unreadable log cannot show that, so it answers false.
const isFreshHash = async (activity: ActivityLog, hash: string): Promise<boolean> => {
  const rows = await activity.list().catch(() => null);
  return rows !== null && !rows.some((row) => sameFelt(row.hash, hash));
};

// Sends the reserved deploy. Anything that sent nothing forgets the attempt; a
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
    await route.pending.forget(account).catch(() => undefined);
    return { error: error instanceof Error ? error.message : "sponsored deployment failed" };
  }
  // The hash is the relay's claim. One this wallet already holds a row for
  // would replace that row and shed its fee, so it is not recorded or tied to
  // the attempt: the hold stays, and the chain decides when it ends.
  if (!(await isFreshHash(deps.activity, transactionHash))) {
    return submissionUnknownResponse(INDETERMINATE_RPC_WRITE_MESSAGE);
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
 * class is unsupported or the route or store is off; during an earlier
 * attempt's hold ({@link DEPLOYMENT_MAY_BE_ON_ITS_WAY}); after an earlier
 * attempt was accepted or lost ({@link SPONSORED_DEPLOY_ALREADY_SENT}); when the
 * chain shows it deployed; and when the chain cannot say
 * ({@link DEPLOYMENT_STATUS_UNKNOWN}). The attempt is persisted before the
 * relay hears anything and forgotten only when it sent nothing. A lost reply
 * is answered as submission-unknown, and so is a relay hash Activity already
 * holds. Otherwise the relay's hash is recorded in Activity as a sponsored
 * deploy, so no fee is ever attributed to the user. The hash is the relay's
 * claim: whether the account is deployed is read from the chain, never from
 * that hash's receipt.
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
  await route.pending.forget(account).catch(() => undefined);
  if (status === null) return UNAVAILABLE;
  return status === "deployed"
    ? { error: "account already deployed" }
    : { error: DEPLOYMENT_STATUS_UNKNOWN };
};
