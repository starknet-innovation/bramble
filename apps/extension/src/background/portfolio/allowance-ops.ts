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

import { type TrackedAllowancePair } from "@mc-wallet/transactions/allowance-scan";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS, type StarknetNetworkId, sameFelt } from "@mc-wallet/wallet-model/networks";
import { type ExternalAllowance, mergeAllowanceViews, type AllowanceReading, type AllowanceView } from "@mc-wallet/transactions/allowance-discovery";
import { approvedAssetKind, type ApprovedAssets } from "@mc-wallet/transactions/allowances";
import { buildErc20ApproveCall } from "@mc-wallet/starknet/rpc";
import { verifyCalls } from "@mc-wallet/transactions/verify";
import { allowanceTarget, type AllowanceRecord } from "@mc-wallet/transactions/allowance-store";
import { readRevokeAllowanceInput } from "./allowance-inputs";
import { readTypeOnlyInput } from "../routing/message-inputs";
import { activeAccountContext, networkRpcUrls, observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { signerForContext, verificationContext, type WalletOpsDeps } from "../accounts/wallet-ops";
import { isWatchedNftContract } from "@mc-wallet/transactions/verify-decode";


/**
 * Discovers ERC20 allowances granted outside this wallet for the active
 * account's tracked tokens. Best-effort: with no discovery source wired, no
 * tracked tokens, or a failing query it yields an empty list so the manager
 * still lists the locally tracked (in-wallet) approvals.
 */
const discoverExternalAllowances = async (
  deps: WalletOpsDeps,
  context: { readonly account: AccountRef; readonly networkId: StarknetNetworkId },
  rpcUrls: readonly string[],
  tokens: readonly string[],
): Promise<readonly ExternalAllowance[]> => {
  const scan = deps.runtimeRpc.getExternalAllowances;
  if (!scan || tokens.length === 0) {
    return [];
  }
  return scan({ owner: context.account.address, rpcUrls, tokens }).catch(() => []);
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

// Scopes this account may READ allowances for, mapped to the ADDRESS that owns
// each one: its own, plus every watched multisig on this network that lists the
// account as a signer. The membership rule is the same one the activity feed
// authorizes a multisig scope with — a signer may see what the multisig it
// belongs to granted, and nothing else. Read-only: a multisig-owned record is
// never revokable from here (the revoke handler refuses any record the active
// account does not own), because zeroing it requires a proposal the multisig's
// own quorum executes. The address is what makes a multisig row correctable
// on-chain: `allowance(multisig, spender)` is a question only its own address
// can answer.
const allowanceScopeOwners = async (
  deps: WalletOpsDeps,
  context: { readonly account: AccountRef; readonly networkId: StarknetNetworkId },
): Promise<ReadonlyMap<string, string>> => {
  const watched = await deps.multisigStore?.listMultisigs().catch(() => []);
  const owners = new Map<string, string>([[context.account.id, context.account.address]]);
  for (const record of watched ?? []) {
    if (
      record.networkId === context.networkId &&
      record.id !== context.account.id &&
      record.signers.some((signer) => sameFelt(signer, context.account.address))
    ) {
      owners.set(record.id, record.address);
    }
  }
  return owners;
};

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
  const owners = await allowanceScopeOwners(deps, context);
  const scoped = (await deps.allowanceStore.list()).filter(
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
  const readings = await readTrackedAmounts(deps, scoped, owners, rpcUrls);
  return {
    allowances: outstandingAllowances(
      mergeAllowanceViews({
        account: context.account,
        external,
        inWallet: scoped.filter((entry) => entry.accountId === context.account.id),
        // Never both: an entry the active account owns is listed once, as its own
        // and revokable, whatever else claims the same scope id.
        multisig: scoped.filter((entry) => entry.accountId !== context.account.id),
        networkId: context.networkId,
        readings,
      }),
      trusted,
      new Set(readings.map((reading) => reading.id)),
    ),
    ok: true,
  };
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
  const result = await deps.runtimeRpc.submitInvokeTransaction({
    account: context.account,
    calls: [call],
    rpcUrls,
    signHash: signerForContext(deps, context),
  });
  // Written before the activity line: the log is what makes a residual grant
  // visible and revokable, so it must not depend on a second store's write
  // succeeding.
  await deps.allowanceStore.record({
    accountId: context.account.id,
    amount: "0",
    networkId: context.networkId,
    spender: target.spender,
    token: target.token,
  });
  await deps.activity.record({
    accountId: context.account.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: context.networkId,
    summary: report.calls[0]?.summary ?? "Revoke approval",
  });
  return { ok: true, transactionHash: result.transactionHash };
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
  const handler = ALLOWANCE_OPS_HANDLERS[messageType];
  return handler ? handler(deps, message) : null;
};
