/**
 * Sponsored account deployment (#431, #706): the Starknet Foundation pays the
 * network fee for a new account that cannot pay its own deploy.
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
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { afterBroadcast, recordSubmittedActivity } from "../transactions/activity-recording";
import { readStrkBalance } from "../transactions/fee-guard";
import { DEPLOY_ACTIVITY_SUMMARY } from "./deployment-ops";

/** Collaborators for the sponsored route; `sponsoredDeploy` is a test seam. */
export type SponsoredDeploymentDeps = {
  readonly activity: ActivityLog;
  /** Wall clock for the hold below; defaults to the system clock boundary. */
  readonly now?: () => number;
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

/**
 * Refusal while an earlier sponsored deploy of the same account may still be
 * landing. Its ending is the shared outcome-unknown sentence, so the panel
 * shows it amber and never as a failure that invites a retry.
 */
export const SPONSORED_DEPLOY_HELD =
  "A sponsored deployment of this account may already be on its way. Check activity before trying again.";

// How long a sponsored deploy holds its account after the relay accepted it or
// its reply was lost. A deploy lands in seconds; once the chain shows the
// account deployed, "account already deployed" answers first anyway.
const SPONSORED_DEPLOY_HOLD_MS = 10 * 60_000;

// Accounts with a sponsored deploy that may be in flight, by network and
// canonical address, with when it was sent. Lives as long as the background
// worker, like the session; it is a guard against a double press, not a record.
const held = new Map<string, number>();

const holdKey = (account: AccountRef): string =>
  `${account.networkId}:${canonicalFelt(account.address) ?? account.address}`;

const isHeld = (key: string, now: number): boolean => {
  const at = held.get(key);
  if (at === undefined) return false;
  if (now - at < SPONSORED_DEPLOY_HOLD_MS) return true;
  held.delete(key);
  return false;
};

/** Clears every hold; for tests that share the worker-lifetime guard. */
export const forgetSponsoredDeployHolds = (): void => {
  held.clear();
};

const rpcUrlsFor = async (
  deps: SponsoredDeploymentDeps,
  account: AccountRef,
): Promise<readonly string[]> =>
  networkRpcUrls(STARKNET_NETWORKS[account.networkId], await deps.preferencesStore.read());

// A failed status read is not a verdict; the relay deploy would revert at a
// taken address, which costs the sponsor, so only a confirmed "no" proceeds.
const isUndeployed = (
  deps: SponsoredDeploymentDeps,
  account: AccountRef,
  rpcUrls: readonly string[],
): Promise<boolean> =>
  deps.runtimeRpc
    .getDeploymentStatus({ accountAddress: account.address, rpcUrls })
    .then((deployed) => deployed === false)
    .catch(() => false);

const relayFor = (deps: SponsoredDeploymentDeps, account: AccountRef) =>
  isSponsorableAccountType(account.accountContractType)
    ? sponsoredDeployConfig(account.networkId, deps.sponsoredDeploy?.networks)
    : null;

// The relay answered no; told apart from a failed read, which offers nothing.
class SponsorDeclined extends Error {}

/**
 * Decides what the deploy screen may offer. "none" unless sponsorship is on
 * for the network, the class is sponsorable, the account is confirmed
 * undeployed, and its STRK balance is confirmed short of the deploy fee; then
 * the relay is asked, and its answer is "available" or "refused". Never throws
 * and never sends a transaction.
 */
export const deploySponsorship = async (
  deps: SponsoredDeploymentDeps,
  input: { readonly account: AccountRef; readonly signHash: StarkHashSigner },
): Promise<DeploySponsorship> => {
  const config = relayFor(deps, input.account);
  if (!config) return "none";
  try {
    const rpcUrls = await rpcUrlsFor(deps, input.account);
    if (!(await isUndeployed(deps, input.account, rpcUrls))) return "none";
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
  readonly key: string;
  readonly now: number;
};

// Every refusal made before the relay hears anything, cheapest first: the class,
// the route, the chain's deployment answer, an earlier deploy still landing, and
// deployment data that cannot reproduce the stored address.
const sponsoredRoute = async (
  deps: SponsoredDeploymentDeps,
  account: AccountRef,
): Promise<SponsoredRoute | { readonly error: string }> => {
  if (!isSponsorableAccountType(account.accountContractType)) {
    return { error: SPONSORED_DEPLOY_UNSUPPORTED };
  }
  const config = relayFor(deps, account);
  if (!config) return { error: "sponsored deployment unavailable" };
  if (!(await isUndeployed(deps, account, await rpcUrlsFor(deps, account)))) {
    return { error: "account already deployed" };
  }
  const now = (deps.now ?? systemClock)();
  const key = holdKey(account);
  if (isHeld(key, now)) return { error: SPONSORED_DEPLOY_HELD };
  try {
    return { config, deployment: sponsoredDeploymentData(accountDeployment(account)), key, now };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "deployment unavailable" };
  }
};

/**
 * Deploys the account through the sponsor. Refuses with no request when the
 * route is off or the class is unsupported, "account already deployed" when
 * the chain says so (or cannot say otherwise), and {@link SPONSORED_DEPLOY_HELD}
 * while an earlier sponsored deploy of this account may still land. A relay
 * refusal is a plain error with nothing sent. A lost reply is answered as
 * submission-unknown and keeps the hold, so it is never retried blind. An
 * accepted deploy is recorded in Activity as sponsored, so no fee is ever
 * attributed to the user.
 */
export const submitSponsoredAccountDeployment = async (
  deps: SponsoredDeploymentDeps,
  input: { readonly account: AccountRef; readonly isAuthorized: () => boolean },
): Promise<RuntimeResponse> => {
  const { account } = input;
  const route = await sponsoredRoute(deps, account);
  if ("error" in route) return route;
  const { config, deployment, key, now } = route;
  const http = deps.sponsoredDeploy?.http ? { http: deps.sponsoredDeploy.http } : {};
  held.set(key, now);
  let transactionHash: string;
  try {
    const quote = await quoteSponsoredDeploy({ config, deployment, ...http });
    ({ transactionHash } = await submitSponsoredDeploy({
      config,
      isAuthorized: input.isAuthorized,
      quote,
      ...http,
    }));
  } catch (error) {
    if (error instanceof IndeterminateRpcWriteError) {
      return submissionUnknownResponse(error.message);
    }
    held.delete(key);
    return { error: error instanceof Error ? error.message : "sponsored deployment failed" };
  }
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
