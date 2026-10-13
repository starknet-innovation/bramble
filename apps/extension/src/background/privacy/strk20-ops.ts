/**
 * Approval-gated STRK20 privacy provider operations. Every handler validates
 * sender, origin, connection grant, and payload before touching private state.
 * All six are dapp-reachable, so every session read here is a non-renewing peek.
 */

import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@bramble/permissions/blocklist";
import {
  formatStrk20PoolFee,
  quoteStrk20Plan,
  STRK20_SERVICE_UNAVAILABLE,
  type Strk20AssetLookup,
  summarizeStrk20Action,
  summarizeStrk20Plan,
} from "@bramble/privacy/service";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { ActivityLog } from "@bramble/transactions/activity";
import { verificationContext } from "@bramble/transactions/verify";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { ApprovalRiskFlag } from "@bramble/wallet-protocol/extension-responses";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import { strk20BatchRefusalError } from "@bramble/wallet-protocol/strk20-batch";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { createApprovalContext } from "../approvals/approval-context";
import { requireApprovalAdmission } from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalQueue } from "../approvals/approvals";
import type { SignatureWaiters } from "../approvals/signature-waiters";
import {
  type ExtensionIdentity,
  isClaimedSenderOrigin,
  type RuntimeSender,
} from "../routing/senders";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { PassiveUnlockSession } from "../runtime/session";
import { strk20AccountContext, strk20ServiceForRuntime } from "./strk20-account-context";
import {
  type ResolvedAccount,
  resolveAccount,
  strk20ErrorMessage,
} from "./strk20-approval-execution";
import type {
  Strk20DisclosureApprovalKind,
  Strk20DisclosureRequest,
} from "./strk20-approval-types";
import { strk20FeeAssetFor } from "./strk20-fee-reference";
import { assertPublicPoolSpendAffordable } from "./strk20-op-context";
import {
  readStrk20BalancesMessage,
  readStrk20InvokeMessage,
  readStrk20PrepareMessage,
  readStrk20RegisterMessage,
  readStrk20ShadowAccountMessage,
} from "./strk20-provider-inputs";
import { poisonedStrk20ActionFlags } from "./strk20-recipient-policy";

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

const gateOrigin = (
  deps: Strk20OpsDeps,
  origin: string,
  sender: RuntimeSender | undefined,
): { readonly error: string } | null => {
  if (!isClaimedSenderOrigin(sender, deps.extension, origin)) {
    return { error: "sender origin mismatch" };
  }
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(origin)) {
    return { error: "origin blocked" };
  }
  return null;
};

type Strk20OpsHandler = (
  deps: Strk20OpsDeps,
  message: unknown,
  sender: RuntimeSender | undefined,
) => Promise<RuntimeResponse>;

const actionTokenAddresses = (actions: readonly Strk20Action[]): readonly string[] =>
  actions.flatMap((action) => ("token" in action ? [action.token] : []));

// Card labels come from the same network-scoped, spam- and source-filtered
// trusted set the call reviewer uses, never raw preferences: a dapp-watched or
// spoof token must not lend its ticker to a card (audit 171).
const reviewAssetsFor = (
  resolved: ResolvedAccount,
  addresses: readonly string[],
): readonly { readonly address: string; readonly symbol: string }[] =>
  verificationContext(resolved.account, resolved.preferences)
    .tokens.filter((token) => addresses.some((address) => sameFelt(address, token.address)))
    .map((token) => ({ address: token.address, symbol: token.symbol }));

// Action amounts on a card read in the token's own units only for a token in
// that same trusted set (Sherlock 154); any other token keeps its exact felt.
const trustedAssetLookup = (resolved: ResolvedAccount): Strk20AssetLookup => {
  const tokens = verificationContext(resolved.account, resolved.preferences).tokens;
  return (address) => {
    const token = tokens.find((candidate) => sameFelt(candidate.address, address));
    return token ? { decimals: token.decimals, symbol: token.symbol } : undefined;
  };
};

const queueDisclosure = async (
  deps: Strk20OpsDeps,
  resolved: ResolvedAccount,
  input: {
    readonly flags?: readonly ApprovalRiskFlag[];
    readonly kind: Strk20DisclosureApprovalKind;
    readonly origin: string;
    readonly request: Strk20DisclosureRequest;
    readonly summaries: readonly string[];
  },
): Promise<RuntimeResponse> => {
  try {
    const payload = { strk20Request: input.request };
    const approval = deps.approvals.requestStrk20Disclosure({
      context: await createApprovalContext(resolved.account, payload),
      ...(input.flags === undefined ? {} : { flags: input.flags }),
      kind: input.kind,
      origin: input.origin,
      request: input.request,
      reviewAssets: reviewAssetsFor(
        resolved,
        input.request.type === "register"
          ? [input.request.token]
          : input.request.type === "balances"
            ? input.request.tokens
            : input.request.type === "prepare"
              ? actionTokenAddresses(input.request.actions)
              : [],
      ),
      summaries: input.summaries,
    });
    notifyApprovalsChanged();
    return deps.waiters.register(approval.id);
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
};

const handleStrk20Register: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20RegisterMessage(message);
  if (!input) {
    return { error: "invalid strk20 registration request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  // Queue admission first: no privacy approval here deduplicates, so an origin
  // at its cap is refused whatever this request contains — and refusing it now
  // costs a map filter instead of a vault read plus a pool quote.
  requireApprovalAdmission(deps.approvals, input.origin);
  const resolved = await resolveAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  if (resolved.account.derivation.kind === "ledger") {
    return { error: "Private balances are not available for Ledger accounts" };
  }
  const config = resolved.preferences.strk20Networks?.[resolved.account.networkId];
  const token = resolved.preferences.tokens.find(
    (candidate) => candidate.networkId === resolved.account.networkId,
  );
  if (!config || !token) {
    return { error: "strk20 services unavailable" };
  }
  try {
    const accountContext = strk20AccountContext(deps, resolved);
    const service = strk20ServiceForRuntime(deps.runtimeRpc);
    if (!service.poolFee) {
      return { error: "strk20 services unavailable" };
    }
    const poolFeeFri = await service.poolFee(accountContext);
    await assertPublicPoolSpendAffordable(
      deps,
      { accountContext, preferences: resolved.preferences, token },
      poolFeeFri,
    );
    return queueDisclosure(deps, resolved, {
      kind: "strk20-register",
      origin: input.origin,
      request: {
        poolAddress: config.poolAddress,
        poolFeeFri,
        token: token.address,
        type: "register",
      },
      summaries: [
        "Activate private balances for this account",
        `Privacy pool ${config.poolAddress}`,
        `Registration preflight token ${token.address}`,
        `Approve and pay the reviewed ${formatStrk20PoolFee(poolFeeFri)} pool fee`,
        "Publishes a viewing-key commitment, never the viewing key",
        "Opens this account's own private channel",
      ],
    });
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
};

const handleStrk20Balances: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20BalancesMessage(message);
  if (!input) {
    return { error: "invalid strk20 balances request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  // Queue admission first: no privacy approval here deduplicates, so an origin
  // at its cap is refused whatever this request contains — and refusing it now
  // costs a map filter instead of a vault read plus a pool quote.
  requireApprovalAdmission(deps.approvals, input.origin);
  const resolved = await resolveAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  return queueDisclosure(deps, resolved, {
    kind: "strk20-balances",
    origin: input.origin,
    request: { tokens: input.tokens, type: "balances" },
    summaries:
      input.tokens.length === 0
        ? ["Share all private token balances"]
        : [
            `Share private balances for ${input.tokens.length} token${input.tokens.length === 1 ? "" : "s"}`,
            ...input.tokens.map((token) => `Token ${token}`),
          ],
  });
};

// The SDK shadow account module is opt-in per network. A request that needs it
// is refused before its approval is queued, not after the user approves into
// a certain failure (#443); the error is the same one the SDK adapter raises.
const MISSING_ANONYMIZER = {
  error: `${STRK20_SERVICE_UNAVAILABLE}: no shadow account anonymizer is configured for this network`,
} as const;

const lacksAnonymizer = (resolved: ResolvedAccount): boolean =>
  !resolved.preferences.strk20Networks?.[resolved.account.networkId]
    ?.shadowAccountAnonymizerAddress;

const needsAnonymizer = (actions: readonly Strk20Action[]): boolean =>
  actions.some((action) => action.type === "shadow_account_invoke");

const handleStrk20PrepareInvoke: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20PrepareMessage(message);
  if (!input) {
    return { error: "invalid strk20 prepare request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  // A batch the SDK or pool is known to reject, or whose reviewed call is not
  // the executed one, is refused before it can reach the user (#443).
  const refusal = strk20BatchRefusalError(input.actions);
  if (refusal) {
    return { error: refusal };
  }
  // Queue admission first: no privacy approval here deduplicates, so an origin
  // at its cap is refused whatever this request contains — and refusing it now
  // costs a map filter instead of a vault read plus a pool quote.
  requireApprovalAdmission(deps.approvals, input.origin);
  const resolved = await resolveAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  if (needsAnonymizer(input.actions) && lacksAnonymizer(resolved)) {
    return MISSING_ANONYMIZER;
  }
  // The same recipient policy the wallet's own pool routes apply. A poisoned
  // payment is queued with the flag, which leaves the card with Deny only,
  // rather than refused at once: an instant refusal told the site which
  // addresses the user has saved or paid (Sherlock 140).
  const flags = poisonedStrk20ActionFlags(resolved.account, resolved.preferences, input.actions);
  return queueDisclosure(deps, resolved, {
    flags,
    kind: "strk20-prepare",
    origin: input.origin,
    request: { actions: input.actions, simulate: input.simulate, type: "prepare" },
    summaries: [
      ...input.actions.map((action) =>
        summarizeStrk20Action(action, resolved.account.address, trustedAssetLookup(resolved)),
      ),
      input.simulate
        ? "Simulate only — no submittable proof"
        : "Generate a submittable private proof for this site",
    ],
  });
};

const handleStrk20InvokeTransaction: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20InvokeMessage(message);
  if (!input) {
    return { error: "invalid strk20 invoke request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  const refusal = strk20BatchRefusalError(input.actions);
  if (refusal) {
    return { error: refusal };
  }
  // Queue admission first: no privacy approval here deduplicates, so an origin
  // at its cap is refused whatever this request contains — and refusing it now
  // costs a map filter instead of a vault read plus a pool quote.
  requireApprovalAdmission(deps.approvals, input.origin);
  const resolved = await resolveAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  if (needsAnonymizer(input.actions) && lacksAnonymizer(resolved)) {
    return MISSING_ANONYMIZER;
  }
  // A private transfer or withdrawal to an address that mimics a saved contact
  // is the same attack whether the wallet composed it or the site did. It is
  // queued with the flag, Deny only, rather than refused on arrival, so the
  // site cannot use the answer to read the address book (Sherlock 140).
  const flags = poisonedStrk20ActionFlags(resolved.account, resolved.preferences, input.actions);
  try {
    const plan = await quoteStrk20Plan(strk20ServiceForRuntime(deps.runtimeRpc), {
      ...strk20AccountContext(deps, resolved),
      actions: input.actions,
    });
    const payload = { actions: input.actions, strk20Plan: plan };
    const approval = deps.approvals.requestStrk20Invoke({
      actions: input.actions,
      context: await createApprovalContext(resolved.account, payload),
      flags,
      origin: input.origin,
      plan,
      reviewAssets: reviewAssetsFor(resolved, [
        ...actionTokenAddresses(input.actions),
        ...("feeAction" in plan ? [plan.feeAction.token] : []),
      ]),
      summaries: [
        ...input.actions.map((action) =>
          summarizeStrk20Action(action, resolved.account.address, trustedAssetLookup(resolved)),
        ),
        summarizeStrk20Plan(plan, strk20FeeAssetFor(resolved.account.networkId, plan)),
      ],
    });
    notifyApprovalsChanged();
    return deps.waiters.register(approval.id);
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
};

const handleStrk20ShadowAccountCommitment: Strk20OpsHandler = async (deps, message, sender) => {
  const input = readStrk20ShadowAccountMessage(message);
  if (!input) {
    return { error: "invalid strk20 shadow account request" };
  }
  const gate = gateOrigin(deps, input.origin, sender);
  if (gate) {
    return gate;
  }
  // Queue admission first: no privacy approval here deduplicates, so an origin
  // at its cap is refused whatever this request contains — and refusing it now
  // costs a map filter instead of a vault read plus a pool quote.
  requireApprovalAdmission(deps.approvals, input.origin);
  const resolved = await resolveAccount(deps, input.origin);
  if ("error" in resolved) {
    return resolved;
  }
  if (lacksAnonymizer(resolved)) {
    return MISSING_ANONYMIZER;
  }
  return queueDisclosure(deps, resolved, {
    kind: "strk20-shadow-account",
    origin: input.origin,
    request: {
      dappName: input.dappName,
      ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
      type: "shadowAccount",
    },
    summaries: [
      `Share a private shadow account commitment for ${input.origin}`,
      `Site-chosen scope label ${input.dappName}`,
      ...(input.nonce === undefined ? [] : [`Nonce ${input.nonce}`]),
    ],
  });
};

// Dispatch table kept explicit so the router defaults closed.
const STRK20_OPS_HANDLERS: Readonly<Record<string, Strk20OpsHandler>> = {
  "wallet.strk20Balances": handleStrk20Balances,
  "wallet.strk20InvokeTransaction": handleStrk20InvokeTransaction,
  "wallet.strk20PrepareInvoke": handleStrk20PrepareInvoke,
  "wallet.strk20Register": handleStrk20Register,
  "wallet.strk20ShadowAccountCommitment": handleStrk20ShadowAccountCommitment,
};

/**
 * Handles the STRK20 privacy messages; returns null for other message types.
 * The invoke request is never auto-submitted: it is queued as a "Private
 * transaction" approval and its response is held until the user decides.
 */
export const handleStrk20Ops = async (
  deps: Strk20OpsDeps,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(STRK20_OPS_HANDLERS, messageType)
    ? STRK20_OPS_HANDLERS[messageType]
    : undefined;
  return handler ? handler(deps, message, sender) : null;
};
