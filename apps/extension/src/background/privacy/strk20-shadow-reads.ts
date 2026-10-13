/**
 * Reads behind the Shadow accounts view (#443, PR 5): the recorded scopes, from
 * the encrypted vault only, and — when the user asks — each scope's shadow
 * accounts and their token balances from the network.
 *
 * Privacy: the network read sends the scope's partial commitment to the RPC
 * node (`get_shadow_accounts`) and then reads each address's balances, so the
 * node can link those addresses to each other and to this client. That is why
 * it runs only on an explicit request, never on a view's hydration.
 */
import { WalletError } from "@bramble/core/errors";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import type { ShadowAccountScopeRef } from "@bramble/vault/shadow-account-scopes";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { ShadowAccountBalance, ShadowAccountEntry } from "./runtime-strk20-types";
import { strk20ServiceForRuntime } from "./strk20-account-context";
import type { ActivePrivacyContext, Strk20WalletOpsDeps } from "./strk20-op-context";
import { strk20ShadowAccountScope } from "./strk20-shadow-account";

// Nonces every scope is read at, recorded or not: a site may fund one first.
const SHADOW_SCAN_NONCES = 16n;

/** Largest nonce the anonymizer's view can address (its nonce is a u64). */
const VIEW_NONCE_LIMIT = 1n << 64n;

// Refusal for a scope the vault has no record of. Stable error code.
const SHADOW_ACCOUNT_SCOPE_UNKNOWN = "shadow account scope not recorded";

// Refusal for a scope recorded under an anonymizer the network no longer
// routes through. Its identity derives from that anonymizer, so the configured
// one cannot reach it. Stable error code.
const SHADOW_ACCOUNT_ANONYMIZER_CHANGED = "shadow account anonymizer changed";

/** The site and label that name one recorded scope. */
export type ShadowScopeTarget = { readonly label: string; readonly origin: string };

/**
 * Whether `record` is the scope `target` names under `anonymizer`. The vault
 * keys a scope on its anonymizer too, so after the network's anonymizer
 * changes the same site and label can have one record per anonymizer; only
 * the one under the configured anonymizer is reachable, wherever it sits in
 * record order (audit F3).
 */
export const isShadowScopeUnder = (
  record: ShadowAccountScopeRef,
  target: ShadowScopeTarget,
  anonymizer: string | undefined,
): boolean =>
  record.origin === target.origin &&
  record.label === target.label &&
  sameFelt(record.anonymizer, anonymizer);

const nonZeroBalances = async (
  deps: Pick<Strk20WalletOpsDeps, "runtimeRpc">,
  context: ActivePrivacyContext,
  address: string,
): Promise<readonly ShadowAccountBalance[]> => {
  const tokens = context.preferences.tokens.filter(
    (token) => token.networkId === context.accountContext.account.networkId,
  );
  const balances = await deps.runtimeRpc.getTokenBalances({
    accountAddress: address,
    rpcUrls: context.accountContext.rpcUrls,
    tokens,
  });
  return tokens.flatMap((token) => {
    const entry = balances.find((candidate) => sameFelt(candidate.address, token.address));
    if (!entry || !/^\d+$/.test(entry.balance) || BigInt(entry.balance) === 0n) {
      return [];
    }
    const raw = BigInt(entry.balance);
    return [
      {
        balance: `0x${raw.toString(16)}`,
        formatted: formatTokenAmount(raw, token.decimals),
        symbol: token.symbol,
        tokenId: token.id,
      },
    ];
  });
};

/**
 * Reads one of `records` (the account's recorded scopes) from the network: the recorded
 * nonces plus the first {@link SHADOW_SCAN_NONCES}, or exactly `nonces` when
 * given. Lists an account when it is recorded, deployed, or holds a tracked
 * token. Recorded nonces the anonymizer's view cannot address are returned as
 * `unlisted`. Reads the record under the configured anonymizer; refuses a
 * scope that is not recorded, or recorded only under another anonymizer.
 */
export const readShadowAccounts = async (
  deps: Pick<Strk20WalletOpsDeps, "runtimeRpc">,
  context: ActivePrivacyContext,
  records: readonly ShadowAccountScopeRef[],
  target: ShadowScopeTarget,
  nonces?: readonly bigint[],
): Promise<{
  readonly accounts: readonly ShadowAccountEntry[];
  readonly anonymizer: string;
  readonly unlisted: readonly string[];
}> => {
  const configured = context.accountContext.config?.shadowAccountAnonymizerAddress;
  const scope = records.find((candidate) => isShadowScopeUnder(candidate, target, configured));
  if (!scope) {
    const named = records.some(
      (candidate) => candidate.origin === target.origin && candidate.label === target.label,
    );
    throw new WalletError(named ? SHADOW_ACCOUNT_ANONYMIZER_CHANGED : SHADOW_ACCOUNT_SCOPE_UNKNOWN);
  }
  const recorded = scope.nonces.map((nonce) => BigInt(nonce));
  const scan = Array.from({ length: Number(SHADOW_SCAN_NONCES) }, (_, index) => BigInt(index));
  const wanted = nonces ?? [...recorded, ...scan];
  if (nonces?.some((nonce) => !recorded.includes(nonce) && nonce >= SHADOW_SCAN_NONCES)) {
    throw new WalletError(SHADOW_ACCOUNT_SCOPE_UNKNOWN);
  }
  const service = strk20ServiceForRuntime(deps.runtimeRpc);
  if (!service.shadowAccounts) {
    throw new WalletError("shadow account records unavailable");
  }
  const infos = await service.shadowAccounts({
    ...context.accountContext,
    dappName: await strk20ShadowAccountScope(scope.origin, scope.label),
    nonces: wanted.filter((nonce) => nonce < VIEW_NONCE_LIMIT),
  });
  const accounts: ShadowAccountEntry[] = [];
  for (const info of infos) {
    const balances = await nonZeroBalances(deps, context, info.address);
    const isRecorded = recorded.includes(BigInt(info.nonce));
    if (isRecorded || info.deployed || balances.length > 0) {
      accounts.push({ ...info, balances, recorded: isRecorded });
    }
  }
  return {
    accounts,
    anonymizer: scope.anonymizer,
    unlisted: scope.nonces.filter((nonce) => BigInt(nonce) >= VIEW_NONCE_LIMIT),
  };
};
