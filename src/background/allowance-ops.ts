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
 * approves token id 0 rather than revoking anything. Both the list and the
 * revoke therefore drop records whose contract is a collection this account
 * watches, and the pre-sign reviewer decodes those calls as their own kinds
 * (see ../starknet/verify-decode).
 */
import {
  type AllowanceReading,
  type ExternalAllowance,
  mergeAllowanceViews,
} from "../starknet/allowance-discovery";
import type { TrackedAllowancePair } from "../starknet/allowance-scan";
import { STARKNET_NETWORKS, type StarknetNetworkId, sameFelt } from "../starknet/networks";
import { buildErc20ApproveCall } from "../starknet/rpc";
import { isWatchedNftContract, verifyCalls } from "../starknet/verify";
import { type AllowanceRecord, allowanceTarget } from "../storage/allowance-store";
import type { AccountRef } from "../storage/vault-schema";
import { readRevokeAllowanceInput } from "./allowance-inputs";
import { readTypeOnlyInput } from "./message-inputs";
import { activeAccountContext, networkRpcUrls, observedAccountContext } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { signerForContext, verificationContext, type WalletOpsDeps } from "./wallet-ops";

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
    allowances: mergeAllowanceViews({
      account: context.account,
      external,
      inWallet: scoped.filter((entry) => entry.accountId === context.account.id),
      // Never both: an entry the active account owns is listed once, as its own
      // and revokable, whatever else claims the same scope id.
      multisig: scoped.filter((entry) => entry.accountId !== context.account.id),
      networkId: context.networkId,
      readings,
    }),
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
  const call = buildErc20ApproveCall(target.token, target.spender, 0n);
  const report = verifyCalls([call], trusted);
  const result = await deps.runtimeRpc.submitInvokeTransaction({
    account: context.account,
    calls: [call],
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
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
