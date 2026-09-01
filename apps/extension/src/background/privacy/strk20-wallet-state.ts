/**
 * The privacy screen's read-only disclosure: whether this account is registered,
 * whether a registration is still settling, and what the pool currently charges.
 *
 * Split from ./strk20-wallet-ops because it broadcasts nothing. The screen polls
 * this on a timer, so it reads through the non-renewing session view: renewing
 * the unlock lifetime here would let one open panel hold the wallet unlocked.
 */

import { STRK20_SIGN_INTENTS } from "@mc-wallet/ledger-protocol/intent";
import { readStrk20Balances, readStrk20RegistrationStatus } from "@mc-wallet/privacy/service";
// A registration the privacy indexer cannot see yet. Derived from the activity
// log rather than stored separately: the registration is already recorded there
// with its hash, and background reconciliation already advances that entry, so a
// rejected or reverted attempt drops out of this check on its own.
import { formatTokenAmount } from "@mc-wallet/starknet/rpc";
import { type ActivityEntry, systemClock } from "@mc-wallet/transactions/activity";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import { observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { strk20ServiceForRuntime } from "./strk20-account-context";
import {
  type ActivePrivacyContext,
  errorText,
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";
import { needsViewingKeyCeremony } from "./strk20-viewing-key-state";

/**
 * Activity summary recorded for a pool registration. Exported because the
 * pending-registration derivation below matches on it: that entry is the only
 * durable local record that a registration was broadcast, so the string is
 * load-bearing in two places and must never be duplicated as a literal.
 */
export const STRK20_REGISTRATION_SUMMARY = "Activate private balances";

// How long a submitted registration is still treated as settling.
const REGISTRATION_PENDING_WINDOW_MS = 30 * 60_000;

/**
 * Whether this account's registration is still settling: submitted recently
 * enough that the pool's indexer may not have seen it yet. Read-only.
 */
export const hasPendingRegistration = async (
  deps: Strk20WalletOpsDeps,
  context: ActivePrivacyContext,
): Promise<boolean> => {
  const now = (deps.now ?? systemClock)();
  const entries = await deps.activity.list();
  return entries.some(
    (entry: ActivityEntry) =>
      entry.summary === STRK20_REGISTRATION_SUMMARY &&
      entry.accountId === context.accountContext.account.id &&
      entry.networkId === context.accountContext.account.networkId &&
      entry.status !== "rejected" &&
      entry.status !== "reverted" &&
      now - entry.submittedAt < REGISTRATION_PENDING_WINDOW_MS,
  );
};

// The fee is a hard input to every pool route, and it is readable without the
// viewing key. Returning a state without it leaves Send in an endless "Checking",
// so an unavailable reader or a failed read rejects the whole request.
const requirePoolFee = async (
  service: ReturnType<typeof strk20ServiceForRuntime>,
  context: ActivePrivacyContext,
): Promise<string> => {
  if (!service.poolFee) {
    throw new Error("Private pool fee is unavailable. Retry the balance check.");
  }
  return service.poolFee(context.accountContext);
};

/**
 * The privacy screen's disclosure for the active account: registration state,
 * whether one is settling, the pool fee, and the viewing-key custody notice.
 * Reads only — nothing here signs, proves, or broadcasts.
 */
export const stateResponse = async (deps: Strk20WalletOpsDeps): Promise<RuntimeResponse> => {
  // The privacy screen re-reads this disclosure on every hydration and, while a
  // registration is settling, on a three-second poll. It is pure observation of
  // state the user did not ask for again, so it must not extend the unlock
  // window — otherwise one open panel keeps the wallet unlocked forever.
  //
  // Reads only. Registration is the named intent because it is the one action
  // this surface offers an account that has none, and no read reaches a signer.
  const context = await resolvePrivacyContext(deps, {
    active: await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    intents: STRK20_SIGN_INTENTS.register,
  });
  if ("error" in context) {
    return { error: context.error };
  }
  try {
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    // Every private read below needs the viewing key. A Ledger account that has
    // not run the device ceremony for this pool has none, which is a recoverable
    // setup state, not a failure — answer with it instead of attempting reads
    // that would all fail, and report no balances rather than implying zero.
    if (await needsViewingKeyCeremony(context)) {
      // Registration still has to be read, and read from the pool directly: an
      // account restored from its phrase or re-added on a new device is already
      // registered on chain while holding no key locally. Reporting it as
      // unregistered offered to register a second time, which the pool refuses —
      // the account needs its key derived, not another registration.
      return {
        ok: true,
        strk20State: {
          accountId: context.accountContext.account.id,
          balances: [],
          networkId: context.accountContext.account.networkId,
          poolFeeFri: await requirePoolFee(service, context),
          registration: await readStrk20RegistrationStatus(service, {
            ...context.accountContext,
            subject: context.accountContext.account.address,
            token: context.token.address,
          }),
          relayConfigured: context.accountContext.config?.paymaster !== undefined,
          privateBalances: "setup-required",
        },
      };
    }
    const status = await readStrk20RegistrationStatus(service, {
      ...context.accountContext,
      token: context.token.address,
    });
    // An accepted-but-unindexed registration reads as `pending` rather than
    // `unregistered`, so no surface offers to register a second time while the
    // first one is still settling.
    const registration =
      status === "registered"
        ? "registered"
        : (await hasPendingRegistration(deps, context))
          ? "pending"
          : "unregistered";
    const balances =
      registration === "registered"
        ? await readStrk20Balances(strk20ServiceForRuntime(deps.runtimeRpc), {
            ...context.accountContext,
            tokens: context.preferences.tokens
              .filter((token) => token.networkId === context.accountContext.account.networkId)
              .map((token) => token.address),
          })
        : [];
    const poolFeeFri = await requirePoolFee(service, context);
    return {
      ok: true,
      strk20State: {
        accountId: context.accountContext.account.id,
        balances: balances.map((entry) => {
          const token = context.preferences.tokens.find(
            (candidate) =>
              candidate.networkId === context.accountContext.account.networkId &&
              sameFelt(candidate.address, entry.token),
          );
          return {
            balance: entry.balance,
            formatted: token ? formatTokenAmount(BigInt(entry.balance), token.decimals) : "0",
            symbol: token?.symbol ?? "Token",
            token: entry.token,
            tokenId: token?.id ?? "",
          };
        }),
        networkId: context.accountContext.account.networkId,
        poolFeeFri,
        relayConfigured: context.accountContext.config?.paymaster !== undefined,
        registration,
        privateBalances: "ready",
      },
    };
  } catch (error) {
    return { error: errorText(error, "Private balances unavailable") };
  }
};
