/**
 * Origin-bound STRK20 shadow account domain separation.
 *
 * The pinned privacy SDK derives a shadow account as
 * `hash(identity_key, encodeDappName(dappName))`, so `dappName` carries the
 * whole cross-site unlinkability guarantee the approval card promises the user.
 * A label chosen by the requesting page cannot carry it: two unrelated sites
 * can ask for the same label and be handed the identical commitment for one
 * wallet. This module derives that separator from the origin the background
 * already verified against the message sender, keeping the site's own label
 * only as a scope selector within that origin.
 *
 * `shadowAccounts(dappName)` is one identity for both the commitment the user is
 * shown and the `shadow_account_invoke` that later acts through it, so the
 * disclosure path and the action path derive from here alike. Deriving in only
 * one of them would hand a site a commitment it could never name in an action.
 */

import { bytesToHex } from "@bramble/core/hex";
import type { Strk20AccountContext } from "@bramble/privacy/service";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { Strk20ShadowAccountCommitmentResponse } from "./runtime-strk20-types";
import { strk20ServiceForRuntime } from "./strk20-account-context";

const SCOPE_DOMAIN = "bramble/strk20-shadow-account/v1";

// The pinned SDK short-string-encodes every `string` dapp name (`encodeDappName`
// in vendor/starknet-privacy/sdk/src/internal/shadow-accounts.ts), and starknet.js
// rejects a Cairo short string longer than 31 bytes. The separator is therefore
// the digest's first 15 bytes rendered as 30 lowercase hex characters:
// printable ASCII, inside that limit, and still 120 bits — far past any
// second-preimage search a site could mount to land on another origin's scope.
// `|` is a WHATWG forbidden host code point and never appears in a normalized
// wallet origin, so the origin field is unambiguously delimited and a crafted
// label cannot impersonate one.
const SCOPE_HEX_CHARS = 30;

/**
 * The origin-bound separator for one (origin, label) scope: the `dapp_name`
 * the SDK derives the shadow account from. `origin` must be a verified or
 * vault-recorded origin, never one read from an untrusted message body.
 */
export const strk20ShadowAccountScope = async (origin: string, label: string): Promise<string> => {
  const bytes = new TextEncoder().encode(`${SCOPE_DOMAIN}|${origin}|${label}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return bytesToHex(digest).slice(0, SCOPE_HEX_CHARS);
};

/**
 * Derives the commitment for an approved shadow account request. `approval.origin`
 * must be the origin the request was gated on, never one read back out of an
 * untrusted message body: it is the only input that keeps one site's commitment
 * unreachable from another. The result is deterministic in (origin, label), so
 * a site sees a stable identity across sessions and distinct labels stay
 * distinct scopes. An unavailable or failing SDK rejects; nothing is persisted.
 */
export const strk20ShadowAccountCommitment = async (
  runtimeRpc: RuntimeRpc,
  context: Strk20AccountContext,
  approval: {
    readonly origin: string;
    readonly request: { readonly dappName: string; readonly nonce?: string };
  },
): Promise<Strk20ShadowAccountCommitmentResponse> => {
  const commitment = await strk20ServiceForRuntime(runtimeRpc).shadowAccountCommitment({
    ...context,
    dappName: await strk20ShadowAccountScope(approval.origin, approval.request.dappName),
    ...(approval.request.nonce === undefined ? {} : { nonce: approval.request.nonce }),
  });
  return { commitment, ok: true };
};

/**
 * Rewrites every `shadow_account_invoke` action's `dapp_name` to the same
 * origin-bound separator the disclosure path derives, so an approved action
 * acts through exactly the shadow account whose commitment the site was shown.
 * `origin` must be the verified request origin, and callers must apply this
 * once, immediately before the SDK call, so the reviewed batch keeps the site's
 * own label on the approval card. Other action variants pass through unchanged
 * and batch order is preserved, so reviewed and executed batches stay
 * one-to-one. Total: no input rejects here, and nothing is persisted.
 */
export const bindStrk20ActionsToOrigin = async (
  origin: string,
  actions: readonly Strk20Action[],
): Promise<readonly Strk20Action[]> =>
  Promise.all(
    actions.map(async (action) =>
      action.type === "shadow_account_invoke"
        ? { ...action, dapp_name: await strk20ShadowAccountScope(origin, action.dapp_name) }
        : action,
    ),
  );
