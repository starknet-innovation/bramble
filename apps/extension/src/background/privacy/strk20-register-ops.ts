/**
 * Registration for dapp requests: the legacy one-time capability and the
 * Wallet-API 0.10.5 STRK20 `register` action (alone in
 * wallet_strk20InvokeTransaction or wallet_strk20PrepareInvoke). Split from
 * ./strk20-ops.ts by size. Every refusal that depends on the user's setup is
 * held on a notice (audit L1); nothing is proved, signed, or broadcast here.
 */

import type { OriginGuard } from "@bramble/permissions/blocklist";
import { strk20Lines, strk20Text } from "@bramble/privacy/review-messages";
import {
  formatStrk20PoolFee,
  STRK20_SERVICE_UNAVAILABLE,
  type Strk20Service,
} from "@bramble/privacy/service";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { ActivityLog } from "@bramble/transactions/activity";
import { addressText } from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { ApprovalReservation } from "../approvals/approval-limits";
import type { ApprovalQueue } from "../approvals/approvals";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import type { ExtensionIdentity } from "../routing/senders";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { PassiveUnlockSession } from "../runtime/session";
import { strk20AccountContext, strk20ServiceForRuntime } from "./strk20-account-context";
import {
  type ResolvedAccount,
  resolveAccount,
  strk20ErrorMessage,
  strk20RegistrationBlockFor,
} from "./strk20-approval-execution";
import { holdStrk20Notice } from "./strk20-notice";
import { assertPublicPoolSpendAffordable } from "./strk20-op-context";
import { queueStrk20Disclosure } from "./strk20-ops-review";
import { isStrk20AccountRegistered, STRK20_ALREADY_REGISTERED } from "./strk20-registration";

/**
 * Dependencies shared by the STRK20 provider operation handlers.
 */
export type Strk20OpsDeps = {
  readonly activity: ActivityLog;
  readonly approvals: ApprovalQueue;
  readonly extension: ExtensionIdentity;
  readonly guard?: OriginGuard;
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: PassiveUnlockSession;
  readonly wallet: WalletStatusReader;
  readonly waiters: SignatureWaiters;
};

/**
 * Holds a site's private request when this account cannot use the pool, so the
 * site is not answered at once. A foreign registration names itself; a failed
 * check is the ordinary retry notice. Null means privacy may proceed.
 */
export const registrationHold = async (
  deps: Strk20OpsDeps,
  origin: string,
  admission: ApprovalReservation,
  resolved: ResolvedAccount,
): Promise<RuntimeResponse | null> => {
  const block = await strk20RegistrationBlockFor(deps, resolved);
  if (!block) return null;
  return holdStrk20Notice(
    deps,
    origin,
    block.error,
    block.privacyBlocker === "other-wallet" ? "other-wallet" : "request-failed",
    admission,
  );
};

/**
 * How a registration request is served. `spec` marks the Wallet-API register
 * action, which must refuse an already registered account
 * (INVALID_REQUEST_PAYLOAD); the legacy capability keeps its execution-time
 * check only.
 */
export type Strk20RegistrationMode =
  | { readonly kind: "prepare"; readonly simulate: boolean }
  | { readonly kind: "submit"; readonly spec: boolean };

// The reviewed pool fee for "submit" ("" for "prepare", where the site pays
// and no token is needed). Throws the service's mapped error on a failed read
// or unaffordable fee.
const registrationFee = async (
  deps: Strk20OpsDeps,
  resolved: ResolvedAccount,
  token: TokenConfig | undefined,
  mode: Strk20RegistrationMode,
  poolFee: Strk20Service["poolFee"],
): Promise<string> => {
  if (mode.kind === "prepare" || !poolFee || !token) {
    return "";
  }
  const accountContext = strk20AccountContext(deps, resolved);
  const poolFeeFri = await poolFee(accountContext);
  await assertPublicPoolSpendAffordable(
    deps,
    { accountContext, preferences: resolved.preferences, token },
    poolFeeFri,
  );
  return poolFeeFri;
};

// Like registrationHold, except that a key another wallet registered is still
// "already registered" for the Wallet-API register action, so the site gets
// INVALID_REQUEST_PAYLOAD; the notice keeps naming the other wallet.
const registrationBlockHold = async (
  deps: Strk20OpsDeps,
  origin: string,
  admission: ApprovalReservation,
  resolved: ResolvedAccount,
  mode: Strk20RegistrationMode,
): Promise<RuntimeResponse | null> => {
  const block = await strk20RegistrationBlockFor(deps, resolved);
  if (!block) return null;
  const foreign = block.privacyBlocker === "other-wallet";
  const spec = mode.kind === "prepare" || mode.spec;
  return holdStrk20Notice(
    deps,
    origin,
    foreign && spec ? STRK20_ALREADY_REGISTERED : block.error,
    foreign ? "other-wallet" : "request-failed",
    admission,
  );
};

type RegistrationSetup =
  | { readonly hold: RuntimeResponse }
  | {
      readonly poolAddress: string;
      readonly poolFeeFri: string;
      readonly resolved: ResolvedAccount;
      readonly token: string;
    };

// The account, pool, token and (for "submit") reviewed pool fee a registration
// card needs, or the response that holds the request instead. Nothing about
// this account's setup is answered at once (audit L1): a Ledger account, a
// network without private services, a fee the public balance cannot cover, or
// (for the register action) an already registered account each hold the
// request on a notice, and the site gets the refusal only when the user
// closes it.
const registrationSetup = async (
  deps: Strk20OpsDeps,
  origin: string,
  admission: ApprovalReservation,
  mode: Strk20RegistrationMode,
): Promise<RegistrationSetup> => {
  const resolved = await resolveAccount(deps, origin);
  if ("error" in resolved) {
    return { hold: resolved };
  }
  const hold = (refusal: string, notice?: "request-failed") =>
    holdStrk20Notice(deps, origin, refusal, notice, admission).then((held) => ({ hold: held }));
  if (resolved.account.derivation.kind === "ledger") {
    return hold("Private balances are not available for Ledger accounts", "request-failed");
  }
  const blocked = await registrationBlockHold(deps, origin, admission, resolved, mode);
  if (blocked) return { hold: blocked };
  const config = resolved.preferences.strk20Networks?.[resolved.account.networkId];
  if (!config) return hold(STRK20_SERVICE_UNAVAILABLE);
  const token = resolved.preferences.tokens.find(
    (candidate) => candidate.networkId === resolved.account.networkId,
  );
  const poolFee = strk20ServiceForRuntime(deps.runtimeRpc).poolFee;
  try {
    // The register action answers "already registered" (114) from the pool's
    // public registry before any submit prerequisite, so an account with no
    // tracked token still gets the spec's code rather than "unavailable".
    if (
      (mode.kind === "prepare" || mode.spec) &&
      (await isStrk20AccountRegistered(deps.runtimeRpc, strk20AccountContext(deps, resolved)))
    ) {
      return hold(STRK20_ALREADY_REGISTERED, "request-failed");
    }
    // Only the wallet-submitted registration pays (and so reviews) a pool fee
    // in a tracked token; prepare-register needs just the account and pool.
    if (mode.kind === "submit" && (!token || !poolFee)) {
      return hold(STRK20_SERVICE_UNAVAILABLE);
    }
    const poolFeeFri = await registrationFee(deps, resolved, token, mode, poolFee);
    return { poolAddress: config.poolAddress, poolFeeFri, resolved, token: token?.address ?? "" };
  } catch (error) {
    return hold(strk20ErrorMessage(error), "request-failed");
  }
};

/**
 * Queues registration for the origin's active account once admitted: the
 * legacy capability and the Wallet-API 0.10.5 register action share this one
 * path. "submit" stages the wallet-broadcast registration behind a fee
 * approval; "prepare" returns the call and proof for the site to submit.
 */
export const queueStrk20Registration = async (
  deps: Strk20OpsDeps,
  origin: string,
  admission: ApprovalReservation,
  mode: Strk20RegistrationMode,
): Promise<RuntimeResponse> => {
  const setup = await registrationSetup(deps, origin, admission, mode);
  if ("hold" in setup) {
    return setup.hold;
  }
  const { poolAddress, poolFeeFri, resolved, token } = setup;
  const common = { admission, holdFailures: true, kind: "strk20-register" as const, origin };
  if (mode.kind === "prepare") {
    return queueStrk20Disclosure(deps, resolved, {
      ...common,
      request: { poolAddress, simulate: mode.simulate, type: "prepare-register" },
      // The first line's English is STRK20_PREPARE/SIMULATE_REGISTER_SUMMARY,
      // which the approval card keys its hint on.
      ...strk20Lines([
        strk20Text(
          mode.simulate ? "strk20Review.register.simulate" : "strk20Review.register.prepare",
        ),
        strk20Text("strk20Review.register.pool", { address: addressText(poolAddress) }),
        strk20Text("strk20Review.register.commitment"),
        strk20Text("strk20Review.register.channel"),
        strk20Text(
          mode.simulate ? "strk20Review.prepare.simulate" : "strk20Review.register.siteSubmits",
        ),
      ]),
    });
  }
  return queueStrk20Disclosure(deps, resolved, {
    ...common,
    request: {
      poolAddress,
      poolFeeFri,
      ...(mode.spec ? { spec: true as const } : {}),
      token,
      type: "register",
    },
    ...strk20Lines([
      strk20Text("strk20Review.register.activate"),
      strk20Text("strk20Review.register.pool", { address: addressText(poolAddress) }),
      strk20Text("strk20Review.register.preflightToken", { token: addressText(token) }),
      strk20Text("strk20Review.register.poolFee", { fee: formatStrk20PoolFee(poolFeeFri) }),
      strk20Text("strk20Review.register.commitment"),
      strk20Text("strk20Review.register.channel"),
    ]),
  });
};
