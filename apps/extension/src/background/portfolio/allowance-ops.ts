/**
 * Allowance-manager operations dispatched from the background message handler:
 * listing the ERC20 allowances this wallet knows about and revoking one through
 * the verified invoke path. Recording them as they are submitted is
 * ./allowance-recording; this module only reads, enriches, and revokes.
 *
 * The list is deliberately ERC20-only. An NFT collection approval — `approve`
 * on a collection (a token id, not an amount) or `set_approval_for_all` — is
 * NOT an allowance and must never be listed here: revoking one from this screen
 * would submit `approve(spender, 0)` against a collection, which under ERC721
 * approves token id 0 rather than revoking anything.
 *
 * The two calls share a calldata shape, so "is this contract fungible?" is
 * answered from evidence, never assumed. A collection this account WATCHES is
 * dropped outright (it is also never recorded — see ./allowance-recording), and
 * a contract in neither the token registry nor the watch list is listed as
 * `unconfirmedToken` and refused a revoke unless the chain answers
 * `allowance(owner, spender)` for the pair — a view an ERC721 does not have.
 * The pre-sign reviewer decodes those calls as their own kinds (see
 * ../starknet/verify-decode).
 */

import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { buildErc20ApproveCall } from "@bramble/starknet/rpc";
import {
  type AllowanceNotice,
  type AllowanceReading,
  type AllowanceView,
  mergeAllowanceViews,
} from "@bramble/transactions/allowance-discovery";
import type {
  ExternalAllowanceScanResult,
  TrackedAllowancePair,
} from "@bramble/transactions/allowance-scan";
import {
  ALLOWANCE_LIMITS,
  type AllowanceRecord,
  allowanceTarget,
  type RevokeOutcome,
} from "@bramble/transactions/allowance-store";
import { type ApprovedAssets, approvedAssetKind } from "@bramble/transactions/allowances";
import { verifyCalls } from "@bramble/transactions/verify";
import { isWatchedNftContract } from "@bramble/transactions/verify-decode";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import { submissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import { recordAutoDeployment } from "../accounts/deployment-ops";
import { signerForContext, verificationContext, type WalletOpsDeps } from "../accounts/wallet-ops";
import { currentArgentSignerRecords } from "../multisig/multisig-membership";
import { readTypeOnlyInput } from "../routing/message-inputs";
import {
  activeAccountContext,
  networkRpcUrls,
  observedAccountContext,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { afterBroadcast, recordSubmittedActivity } from "../transactions/activity-recording";
import { requiredFeeReview } from "../transactions/fee-review";
import { readRevokeAllowanceInput } from "./allowance-inputs";
import { allowanceOwner, recordApproveAllowances } from "./allowance-recording";

/**
 * Discovers ERC20 allowances granted outside this wallet for the active
 * account's tracked tokens. Best-effort: with no discovery source wired or no
 * tracked tokens it yields an empty, complete result, and a failing query
 * yields an empty, incomplete one, so the manager still lists the locally
 * tracked (in-wallet) approvals and says the scan did not finish.
 */
const discoverExternalAllowances = async (
  deps: WalletOpsDeps,
  context: { readonly account: AccountRef; readonly networkId: StarknetNetworkId },
  rpcUrls: readonly string[],
  tokens: readonly string[],
): Promise<ExternalAllowanceScanResult> => {
  const scan = deps.runtimeRpc.getExternalAllowances;
  if (!scan || tokens.length === 0) {
    return { allowances: [], complete: true };
  }
  return scan({ owner: context.account.address, rpcUrls, tokens }).catch(() => ({
    allowances: [],
    complete: false,
  }));
};

// Reads the live amount of the records the manager is about to show. This is
// the reading that actually reaches the hard cases: it needs no `Approval`
// event page (so a busy mainnet token whose approval is far outside the first
// pages is still readable), no entry in the token registry (so a dapp's own
// token counts), and no assumption that the owner is the active account (so a
// multisig scope is readable too). Lower-bound records are asked about first
// because they are the ones a reading can turn back into an exact figure.
const readTrackedAmounts = async (
  deps: WalletOpsDeps,
  records: readonly AllowanceRecord[],
  owners: ReadonlyMap<string, string>,
  rpcUrls: readonly string[],
): Promise<readonly AllowanceReading[]> => {
  const read = deps.runtimeRpc.getTrackedAllowances;
  if (!read) {
    return [];
  }
  const pairs: TrackedAllowancePair[] = [];
  for (const record of [...records].sort((left, right) =>
    left.lowerBound === right.lowerBound ? 0 : left.lowerBound ? -1 : 1,
  )) {
    const owner = owners.get(record.accountId);
    if (owner) {
      pairs.push({ id: record.id, owner, spender: record.spender, token: record.token });
    }
  }
  return read({ pairs, rpcUrls }).catch(() => []);
};

// The settled outcome of each pending revoke in `records`, read from the
// wallet's own activity reconciliation, which keeps checking a submitted hash
// after the panel closes (issue 647). Only the row this wallet recorded for the
// transaction it submitted (`origin: "wallet"`) in the revoking record's own
// scope counts: a chain-discovered or other-scope row with the same hash is
// not this wallet's observation. A revoke still pending or pre-confirmed, or
// whose activity line was never written, has no outcome and keeps settling on
// readings alone. Conflicting rows resolve in the store, failed over accepted.
const revokeOutcomes = async (
  deps: WalletOpsDeps,
  records: readonly AllowanceRecord[],
  networkId: StarknetNetworkId,
): Promise<readonly RevokeOutcome[]> => {
  const pending = new Set(
    records.flatMap((record) =>
      record.revokeHash ? [`${record.accountId}|${record.revokeHash}`] : [],
    ),
  );
  if (pending.size === 0) {
    return [];
  }
  const entries = await deps.activity.list().catch(() => []);
  return entries.flatMap((entry): readonly RevokeOutcome[] => {
    const hash = canonicalFelt(entry.hash);
    if (
      entry.origin !== "wallet" ||
      entry.networkId !== networkId ||
      hash === null ||
      !pending.has(`${entry.accountId}|${hash}`)
    ) {
      return [];
    }
    if (entry.status === "accepted") {
      return [{ hash, status: "accepted" }];
    }
    return entry.status === "rejected" || entry.status === "reverted"
      ? [{ hash, status: "failed" }]
      : [];
  });
};

// Scopes this account may READ allowances for, mapped to the ADDRESS that owns
// each one: its own, plus every watched multisig on this network that lists the
// account as a signer. The membership rule is the same one the activity feed
// authorizes a multisig scope with — a signer may see what the multisig it
// belongs to granted, and nothing else. Read-only: a multisig-owned record is
// never revokable from here (the revoke handler refuses any record the active
// account does not own), because zeroing it requires a separately reviewed
// multisig intent and threshold authorization. The address is what makes a multisig row correctable
// on-chain: `allowance(multisig, spender)` is a question only its own address
// can answer.
//
// A multisig that cannot be read is left out rather than failing the list: the
// account's own scope needs no chain read, and hiding it behind an undeployed
// multisig showed "no allowances" over live ones (Sherlock 190).
const allowanceScopeOwners = async (
  deps: WalletOpsDeps,
  context: { readonly account: AccountRef; readonly networkId: StarknetNetworkId },
): Promise<{ readonly owners: ReadonlyMap<string, string>; readonly multisigUnread: boolean }> => {
  const owners = new Map<string, string>([[context.account.id, context.account.address]]);
  const signed = await currentArgentSignerRecords(deps, context.account, context.networkId).catch(
    () => ({ records: [], unreadable: true }),
  );
  for (const record of signed.records) {
    owners.set(record.id, record.address);
  }
  return { multisigUnread: signed.unreadable, owners };
};

// What the listing could not vouch for, in the order the manager states it.
const listingNotices = (flags: {
  readonly multisigUnread: boolean;
  readonly retentionFull: boolean;
  readonly scanComplete: boolean;
}): readonly AllowanceNotice[] => [
  ...(flags.scanComplete ? [] : (["scan-incomplete"] as const)),
  ...(flags.multisigUnread ? (["multisig-unread"] as const) : []),
  ...(flags.retentionFull ? (["retention-full"] as const) : []),
];

// What the manager may claim about each row. A contract this account tracks as
// a token is fungible by the user's own say-so; any other contract is fungible
// only if the chain answered `allowance(owner, spender)` for that exact pair,
// which an ERC721 cannot do. Everything else is listed as an approval whose
// units the wallet will not vouch for, rather than as an amount of a token that
// may not exist. A row the chain has resolved to an exact zero is dropped: the
// spender's reach is nil, so there is nothing outstanding to show.
const outstandingAllowances = (
  views: readonly AllowanceView[],
  assets: ApprovedAssets,
  confirmed: ReadonlySet<string>,
): readonly AllowanceView[] =>
  views.flatMap((view) => {
    if (view.amount === "0" && !view.lowerBound) {
      return [];
    }
    return approvedAssetKind(assets, view.token) === "fungible" || confirmed.has(view.id)
      ? [view]
      : [{ ...view, unconfirmedToken: true as const }];
  });

// Whether an ERC20 revoke may be broadcast at this contract at all. The revoke
// is `approve(spender, 0)`, which on an ERC721 APPROVES item #0 to the spender
// — a grant where the user asked for a revocation — so it is sent only against
// a contract the wallet can call fungible: one this account tracks as a token,
// or one the node answers an `allowance(owner, spender)` read for. The read
// costs nothing on a healthy path (the same node has to relay the revoke
// anyway) and fails closed on an unknown contract, an ERC721, and a node that
// will not answer.
const isRevokableErc20 = async (
  deps: WalletOpsDeps,
  assets: ApprovedAssets,
  pair: TrackedAllowancePair,
  rpcUrls: readonly string[],
): Promise<boolean> => {
  if (approvedAssetKind(assets, pair.token) === "fungible") {
    return true;
  }
  const read = deps.runtimeRpc.getTrackedAllowances;
  if (!read) {
    return false;
  }
  const readings = await read({ pairs: [pair], rpcUrls }).catch(() => []);
  return readings.some((reading) => reading.id === pair.id);
};

type AllowanceOpsHandler = (deps: WalletOpsDeps, message: unknown) => Promise<RuntimeResponse>;

const handleListAllowances: AllowanceOpsHandler = async (deps, message) => {
  if (!readTypeOnlyInput(message, "wallet.allowances")) {
    return { error: "invalid allowances request" };
  }
  // Scope the list to the active account and the multisigs it signs for:
  // allowances granted by an unrelated account must not appear (or be
  // revocable) here. Observed, never renewing: the panel re-reads this list on
  // its ambient cadence.
  const context = await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { allowances: [], ok: true };
  }
  const preferences = await deps.preferencesStore.read();
  const trusted = verificationContext(context.account, preferences);
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  const { multisigUnread, owners } = await allowanceScopeOwners(deps, context);
  const stored = await deps.allowanceStore.list();
  const scoped = stored.filter(
    (entry) =>
      entry.networkId === context.networkId &&
      owners.has(entry.accountId) &&
      !isWatchedNftContract(trusted, entry.token),
  );
  const external = await discoverExternalAllowances(
    deps,
    context,
    rpcUrls,
    trusted.tokens.map((token) => token.address),
  );
  // A revoke is recorded when submitted; a reading of zero, or its own
  // transaction's outcome, is what settles it. Outcomes are read BEFORE the
  // allowance readings, so an `accepted` outcome is never paired with a
  // reading taken before the reconciler saw the revoke execute. The rows
  // listed below are the settled ones, so a failed revoke stops showing as on
  // its way in the same listing. Best effort: the listing does not depend on it.
  const outcomes = await revokeOutcomes(deps, scoped, context.networkId);
  const readings = await readTrackedAmounts(deps, scoped, owners, rpcUrls);
  await deps.allowanceStore.settleRevocations(readings, outcomes).catch(() => undefined);
  const settled =
    outcomes.length === 0
      ? scoped
      : (await deps.allowanceStore.list().catch(() => stored)).filter((entry) =>
          scoped.some((candidate) => candidate.id === entry.id),
        );
  const notices = listingNotices({
    multisigUnread,
    // The total cap evicts too, from the fullest scopes, so a full log counts.
    retentionFull:
      stored.length >= ALLOWANCE_LIMITS.entriesTotal ||
      stored.filter((entry) => entry.accountId === context.account.id).length >=
        ALLOWANCE_LIMITS.entriesPerScope,
    scanComplete: external.complete,
  });
  return {
    allowances: outstandingAllowances(
      mergeAllowanceViews({
        account: context.account,
        external: external.allowances,
        inWallet: settled.filter((entry) => entry.accountId === context.account.id),
        // Never both: an entry the active account owns is listed once, as its own
        // and revokable, whatever else claims the same scope id.
        multisig: settled.filter((entry) => entry.accountId !== context.account.id),
        networkId: context.networkId,
        readings,
      }),
      trusted,
      new Set(readings.map((reading) => reading.id)),
    ),
    ...(notices.length > 0 ? { notices } : {}),
    ok: true,
  };
};

type RevokeSubmission = {
  readonly account: AccountRef;
  readonly call: ReturnType<typeof buildErc20ApproveCall>;
  readonly isAuthorized: () => boolean;
  readonly reviewedFee: NonNullable<
    Parameters<WalletOpsDeps["runtimeRpc"]["submitInvokeTransaction"]>[0]["reviewedFee"]
  >;
  readonly rpcUrls: readonly string[];
  readonly signHash: ReturnType<typeof signerForContext>;
  readonly summary: string;
  readonly trusted: ApprovedAssets;
};

// Sends the reviewed revoke and files its revoke mark and activity line. The
// revoke as signed is captured before it is sent, so a lost reply still leaves
// a pending row and mark to settle on, and the panel is told the outcome is
// unknown (audit L3).
const submitRevoke = async (
  deps: WalletOpsDeps,
  revoke: RevokeSubmission,
): Promise<RuntimeResponse> => {
  // Written before the activity line: the log is what makes a residual grant
  // visible and revokable, so it must not depend on a second store's write
  // succeeding.
  const recordRevoke = async (transactionHash: string): Promise<void> => {
    await recordApproveAllowances({
      assets: revoke.trusted,
      calls: [revoke.call],
      owner: allowanceOwner(revoke.account),
      store: deps.allowanceStore,
      transactionHash,
    });
    await recordSubmittedActivity(deps.activity, {
      accountId: revoke.account.id,
      hash: transactionHash,
      kind: "invoke",
      networkId: revoke.account.networkId,
      summary: revoke.summary,
    });
  };
  let signedHash: string | undefined;
  let transactionHash: string;
  let deploymentHash: string | undefined;
  try {
    ({ deploymentTransactionHash: deploymentHash, transactionHash } =
      await deps.runtimeRpc.submitInvokeTransaction({
        account: revoke.account,
        calls: [revoke.call],
        isAuthorized: revoke.isAuthorized,
        onSigned: async (signed) => {
          signedHash = signed.transactionHash;
        },
        reviewedFee: revoke.reviewedFee,
        rpcUrls: revoke.rpcUrls,
        signHash: revoke.signHash,
      }));
  } catch (error) {
    // An accepted automatic deployment is recorded whatever happened next (mc-wallet 719).
    await afterBroadcast(() => recordAutoDeployment(deps.activity, revoke.account, error));
    if (!(error instanceof IndeterminateRpcWriteError)) throw error;
    const pending = signedHash;
    if (pending !== undefined) await afterBroadcast(() => recordRevoke(pending));
    return submissionUnknownResponse(error.message, pending);
  }
  // Once a hash exists the reply carries it: a failed local write must not
  // turn a revoke that is on its way into a plain error (errors audit F1).
  await afterBroadcast(() => recordAutoDeployment(deps.activity, revoke.account, deploymentHash));
  await afterBroadcast(() => recordRevoke(transactionHash));
  return { ok: true, transactionHash };
};

const handleRevokeAllowance: AllowanceOpsHandler = async (deps, message) => {
  const input = readRevokeAllowanceInput(message);
  if (!input) {
    return { error: "invalid revoke request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const authorized = captureSessionAuthorization(deps.session);
  const record = (await deps.allowanceStore.list()).find((entry) => entry.id === input.id);
  if (record && record.accountId !== context.account.id) {
    return { error: "switch to the account that granted this allowance" };
  }
  // A tracked (in-wallet) allowance is revoked from its stored record; an
  // externally discovered one is not in the store, so its token and spender
  // are recovered from the id, scoped to the active account. Setting an
  // allowance to zero can only reduce a spender's reach, and still runs
  // through the verified invoke path below either way.
  const target = record ?? allowanceTarget(input.id, context.account.id);
  if (!target) {
    return { error: "allowance not found" };
  }
  const preferences = await deps.preferencesStore.read();
  const trusted = verificationContext(context.account, preferences);
  if (isWatchedNftContract(trusted, target.token)) {
    // `approve(spender, 0)` on a collection is an ERC721 approval of token id
    // zero, not a revocation. Fail closed rather than broadcast a call that
    // grants where the user asked to revoke.
    return { error: "this contract is an NFT collection, not a token; revoke it from the dapp" };
  }
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  const pair = {
    id: input.id,
    owner: context.account.address,
    spender: target.spender,
    token: target.token,
  };
  if (!(await isRevokableErc20(deps, trusted, pair, rpcUrls))) {
    return {
      error:
        "this wallet could not confirm that contract is a token, so it will not send a revoke that could approve an NFT instead; revoke it from the dapp",
    };
  }
  const call = buildErc20ApproveCall(target.token, target.spender, 0n);
  const report = verifyCalls([call], trusted);
  const signHash = signerForContext(deps, context);
  if (!input.reviewedFee) {
    return requiredFeeReview(() =>
      deps.runtimeRpc.estimateInvokeFee({
        account: context.account,
        calls: [call],
        rpcUrls,
        signHash,
      }),
    );
  }
  return submitRevoke(deps, {
    account: context.account,
    call,
    isAuthorized: authorized.isCurrent,
    reviewedFee: input.reviewedFee,
    rpcUrls,
    signHash,
    summary: report.calls[0]?.summary ?? "Revoke approval",
    trusted,
  });
};

/**
 * Dispatch table for allowance-manager messages, keyed by message type. Each
 * branch is a self-contained handler, leaving the router a pure lookup.
 */
const ALLOWANCE_OPS_HANDLERS: Readonly<Record<string, AllowanceOpsHandler>> = {
  "wallet.allowances": handleListAllowances,
  "wallet.revokeAllowance": handleRevokeAllowance,
};

/**
 * Handles allowance-manager messages; returns null for other message types.
 */
export const handleAllowanceOps = async (
  deps: WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(ALLOWANCE_OPS_HANDLERS, messageType)
    ? ALLOWANCE_OPS_HANDLERS[messageType]
    : undefined;
  return handler ? handler(deps, message) : null;
};
