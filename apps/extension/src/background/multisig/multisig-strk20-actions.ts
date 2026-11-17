/**
 * Multisig STRK20 actions: register, deposit, transfer, and withdraw.
 * Messages report ids and phases, never the shared scalar or proof bytes.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER,
  type MultisigStrk20ActionRequest,
  type MultisigStrk20Authorization,
  multisigStrk20CallSetHash,
  withMultisigStrk20Fragment,
} from "@bramble/privacy/multisig-strk20";
import { isBoundToMultisig } from "@bramble/privacy/multisig-strk20-binding";
import { reviewMultisigStrk20Calls } from "@bramble/privacy/multisig-strk20-review";
import { resolveMultisigStrk20Amount } from "@bramble/privacy/multisig-strk20-token";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { isAccountId } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { signerForContext } from "../accounts/wallet-ops";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { MultisigOpsDeps } from "./multisig-deps";
import {
  coordinationRecipients,
  coordinationRelayUrls,
  publishForRecipients,
} from "./multisig-nostr-publish";
import { multisigStrk20PanelCards } from "./multisig-strk20-cards";
import { proveMultisigStrk20 } from "./multisig-strk20-prove";
import { shareCollectedStrk20Relay, signCollectedStrk20Relay } from "./multisig-strk20-relay";
import { multisigStrk20Binding, multisigStrk20ReviewScope } from "./multisig-strk20-scope";
import { refreshMultisigStrk20, submitMultisigStrk20Relay } from "./multisig-strk20-send";
import {
  MULTISIG_STRK20_SHARE_FIRST,
  type MultisigStrk20Session,
  openMultisigStrk20Session,
} from "./multisig-strk20-session";
import {
  multisigStrk20Unaffordable,
  readMultisigStrk20PrivateBalances,
} from "./multisig-strk20-token";
import { nativeNostrRelayTransport } from "./nostr-relay";

const PREPARE = "wallet.prepareArgentMultisigStrk20";
const SIGN = "wallet.signArgentMultisigStrk20Authorization";
const SHARE = "wallet.shareArgentMultisigStrk20Authorization";
const REFRESH = "wallet.refreshArgentMultisigStrk20";
const SUBMIT = "wallet.submitArgentMultisigStrk20Relay";
const PANEL = "wallet.argentMultisigStrk20Panel";

const readId = (message: unknown, type: string, key: "id" | "multisigId"): string | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, [key, "type"]) &&
  message["type"] === type &&
  typeof message[key] === "string" &&
  message[key].length > 0 &&
  message[key].length <= 256
    ? message[key]
    : null;

const INVALID_ACTION = { error: "invalid multisig private action" } as const;

const counterparty = (recipient: unknown): string | { readonly error: string } => {
  const to = canonicalFelt(String(recipient ?? ""));
  return to !== null && isNonZeroStarkFieldElement(to) ? to : INVALID_ACTION;
};

type PaidDraft = {
  readonly amount: string;
  readonly kind: "deposit" | "transfer" | "withdraw";
  readonly recipient?: string;
  readonly tokenId: string;
};

const paidRequest = (
  id: string,
  kind: "deposit" | "transfer" | "withdraw",
  amount: unknown,
  recipient: unknown,
  tokenId: unknown,
): { readonly draft: PaidDraft; readonly id: string } | { readonly error: string } => {
  if (typeof amount !== "string" || typeof tokenId !== "string" || tokenId.length === 0) {
    return INVALID_ACTION;
  }
  if (kind === "deposit" && recipient === undefined) {
    return { draft: { amount, kind, tokenId }, id };
  }
  const to = counterparty(recipient);
  if (typeof to !== "string") return to;
  return { draft: { amount, kind, recipient: to, tokenId }, id };
};

const requestFrom = (message: unknown) => {
  if (!isRecord(message) || message["type"] !== PREPARE || !isAccountId(message["multisigId"])) {
    return null;
  }
  const kind = message["kind"];
  if (kind === "register") {
    const request: MultisigStrk20ActionRequest = { kind: "register" };
    return { id: message["multisigId"], request };
  }
  if (kind !== "deposit" && kind !== "transfer" && kind !== "withdraw") return INVALID_ACTION;
  return paidRequest(
    message["multisigId"],
    kind,
    message["amount"],
    message["recipient"],
    message["tokenId"],
  );
};

const actionFor = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  draft: PaidDraft,
): Promise<{ readonly error: string } | { readonly request: MultisigStrk20ActionRequest }> => {
  const preferences = await deps.preferencesStore.read();
  const resolved = resolveMultisigStrk20Amount(
    preferences.tokens,
    session.context.record.networkId,
    draft.tokenId,
    draft.amount,
  );
  if ("error" in resolved) return resolved;
  const token = preferences.tokens.find((candidate) => candidate.id === draft.tokenId);
  if (!token) return { error: "That token isn't tracked on this network." };
  const refusal = await multisigStrk20Unaffordable(deps, session, draft.kind, token, resolved.raw);
  if (refusal) return refusal;
  return {
    request: {
      amount: resolved.raw,
      kind: draft.kind,
      token: resolved.token,
      ...(draft.recipient ? { recipient: draft.recipient } : {}),
    },
  };
};

// True while co-owners exist and none of them is known to hold the key.
const soleKeyCopy = async (session: MultisigStrk20Session): Promise<boolean> =>
  session.config.signerPublicKeys.some(
    (key) => !sameFelt(key, session.context.active.account.publicKeyX),
  ) && !(await session.store.isKeyShared(session.context.record.id));

const prepare = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const parsed = requestFrom(message);
  if (!parsed) return { error: "invalid multisig private action" };
  if ("error" in parsed) return parsed;
  const session = await openMultisigStrk20Session(deps, parsed.id);
  if ("error" in session) return session;
  const kind = "request" in parsed ? parsed.request.kind : parsed.draft.kind;
  if ((kind === "register" || kind === "deposit") && (await soleKeyCopy(session))) {
    return { error: MULTISIG_STRK20_SHARE_FIRST };
  }
  if ("request" in parsed) {
    return proveMultisigStrk20(deps, session, parsed.request, session.readScalar);
  }
  const action = await actionFor(deps, session, parsed.draft);
  if ("error" in action) return action;
  return proveMultisigStrk20(deps, session, action.request, session.readScalar);
};

/**
 * True when a stored CallSet is for this multisig as this wallet knows it:
 * the digest recomputed from the record's own address and chain, the live
 * signer set and threshold, and calls that decode into a review.
 */
const authorizationReviewed = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  authorization: MultisigStrk20Authorization,
): Promise<boolean> => {
  const record = session.context.record;
  const scalar = await session.readScalar();
  const digest = multisigStrk20CallSetHash(
    record.address,
    authorization.calls,
    session.chainId,
    scalar,
  );
  const preferences = await deps.preferencesStore.read();
  return (
    digest !== null &&
    sameFelt(digest, authorization.hash) &&
    isBoundToMultisig(authorization, multisigStrk20Binding(record, session.config)) &&
    reviewMultisigStrk20Calls(
      authorization.calls,
      scalar,
      multisigStrk20ReviewScope(record, session.poolAddress, preferences.tokens),
    ) !== null
  );
};

const signCollected = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const id = readId(message, SIGN, "id");
  if (!id) return { error: "invalid multisig private action" };
  const accountId = id.slice(0, id.lastIndexOf(":"));
  const session = await openMultisigStrk20Session(deps, accountId);
  if ("error" in session) return session;
  const authorization = await session.store.getAuthorization(id, await session.readScalar());
  if (!authorization) {
    return (
      (await signCollectedStrk20Relay(deps, session, id)) ?? {
        error: "Argent multisig intent not found",
      }
    );
  }
  if (authorization.state !== "collecting") {
    return { error: "Argent multisig intent is not collecting signatures" };
  }
  if (!(await authorizationReviewed(deps, session, authorization))) {
    return { error: "Invalid Argent multisig private proof" };
  }
  const member = session.config.signerPublicKeys.find((key) =>
    sameFelt(key, session.context.active.account.publicKeyX),
  );
  if (!member) return { error: "selected account is not a current Argent multisig signer" };
  const signed = await signerForContext(deps, {
    account: session.context.active.account,
    vaultPassphrase: session.context.active.vaultPassphrase,
  })(authorization.hash);
  const next = withMultisigStrk20Fragment(authorization, { ...signed, publicKey: member });
  if (!next) return { error: "signature is not valid for this exact Argent multisig intent" };
  const stored = await session.store.upsertAuthorization(
    next,
    await session.readScalar(),
    session.isAuthorized,
  );
  if (stored === "unauthorized") return { error: "wallet locked" };
  return stored === "stored"
    ? { id: next.id, ok: true, phase: next.state === "ready" ? "fresh" : "authorization" }
    : { error: "Invalid Argent multisig private proof" };
};

const shareCollected = async (
  deps: MultisigOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const id = readId(message, SHARE, "id");
  if (!id) return { error: "invalid multisig private action" };
  const accountId = id.slice(0, id.lastIndexOf(":"));
  const session = await openMultisigStrk20Session(deps, accountId);
  if ("error" in session) return session;
  const authorization = await session.store.getAuthorization(id, await session.readScalar());
  if (!authorization) {
    return (
      (await shareCollectedStrk20Relay(deps, session, id)) ?? {
        error: "Argent multisig intent not found",
      }
    );
  }
  if (!deps.wallet.nostrPublicKey || !deps.wallet.wrapNostrApplicationData) {
    return { error: "Secure co-signer coordination is unavailable for this wallet" };
  }
  const content = JSON.stringify({ authorization, kind: "call-set", version: 1 });
  if (content.length > 30_000) return { error: "This authorization is too large to share." };
  const preferences = await deps.preferencesStore.read();
  const own = await deps.wallet.nostrPublicKey(session.context.active.vaultPassphrase);
  const recipients = coordinationRecipients(
    preferences.addressBook,
    session.context.record.networkId,
    own,
    authorization.signerPublicKeys.map((key) => argentSignerGuid(key)),
  );
  const published = await publishForRecipients(
    recipients,
    content,
    MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER,
    session.context.active.vaultPassphrase,
    session.isAuthorized,
    coordinationRelayUrls(preferences),
    deps.nostrRelayTransport ?? nativeNostrRelayTransport,
    deps.wallet.wrapNostrApplicationData,
    deps.wallet.wrapNostrApplicationDataBatch,
  );
  return published ? { ok: true, ...published } : { error: "wallet locked" };
};

const refresh = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const id = readId(message, REFRESH, "id");
  return id ? refreshMultisigStrk20(deps, id) : INVALID_ACTION;
};

const submitRelay = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const id = readId(message, SUBMIT, "id");
  return id ? submitMultisigStrk20Relay(deps, id) : INVALID_ACTION;
};

const panel = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const multisigId = readId(message, PANEL, "multisigId");
  if (!multisigId) return { error: "invalid multisig private action" };
  const session = await openMultisigStrk20Session(deps, multisigId);
  if ("error" in session) {
    return session.error === "wallet locked"
      ? session
      : { authorizations: [], balances: [], ok: true, relays: [] };
  }
  const scalar = await session.readScalar();
  const balances = (await readMultisigStrk20PrivateBalances(deps, session)) ?? [];
  const preferences = await deps.preferencesStore.read();
  const cards = await multisigStrk20PanelCards(
    session,
    scalar,
    multisigStrk20ReviewScope(session.context.record, session.poolAddress, preferences.tokens),
    session.context.active.account.publicKeyX,
    Math.floor(deps.now() / 1000),
  );
  return { ...cards, balances, ok: true };
};

const HANDLERS = {
  [PANEL]: panel,
  [PREPARE]: prepare,
  [REFRESH]: refresh,
  [SHARE]: shareCollected,
  [SIGN]: signCollected,
  [SUBMIT]: submitRelay,
} as const;

/**
 * Dispatches multisig STRK20 action messages. Unknown types return null.
 */
export const handleMultisigStrk20Actions = async (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(HANDLERS, messageType)
    ? HANDLERS[messageType as keyof typeof HANDLERS]
    : undefined;
  return handler ? handler(deps, message) : null;
};
