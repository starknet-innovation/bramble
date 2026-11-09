/**
 * Collects the second multisig STRK20 round: the paymaster typed-data digest.
 * Co-owners exchange fragments only. The proof stays on the device that built
 * it and is never placed in a gift wrap. Typed data is decoded and bound to
 * this multisig again immediately before every signature.
 */

import {
  MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER,
  type MultisigStrk20RelayRequest,
  withMultisigStrk20RelayFragment,
} from "@bramble/privacy/multisig-strk20";
import { isBoundToMultisig } from "@bramble/privacy/multisig-strk20-binding";
import {
  multisigStrk20RelayInviteFrom,
  withMultisigStrk20RelayInviteFragment,
} from "@bramble/privacy/multisig-strk20-relay-invite";
import { reviewMultisigStrk20TypedData } from "@bramble/privacy/multisig-strk20-review";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import { signerForContext } from "../accounts/wallet-ops";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { MultisigOpsDeps } from "./multisig-deps";
import {
  coordinationRecipients,
  coordinationRelayUrls,
  publishForRecipients,
} from "./multisig-nostr-publish";
import { multisigStrk20Binding, multisigStrk20ReviewScope } from "./multisig-strk20-scope";
import type { MultisigStrk20Session } from "./multisig-strk20-session";
import { nativeNostrRelayTransport } from "./nostr-relay";

const INVALID = { error: "Invalid Argent multisig private proof" } as const;
const NOT_MEMBER = { error: "selected account is not a current Argent multisig signer" } as const;
const NOT_EXACT = {
  error: "signature is not valid for this exact Argent multisig intent",
} as const;

const commitResult = (
  stored: "conflict" | "full" | "invalid" | "stored" | "unauthorized",
  id: string,
  phase: "authorization" | "relay",
): RuntimeResponse => {
  if (stored === "unauthorized") return { error: "wallet locked" };
  return stored === "stored" ? { id, ok: true, phase } : INVALID;
};

/**
 * True when typed data decodes, for this multisig's own address, chain, and
 * pool, into the reviewed approvals and hashes to `messageHash`.
 */
const typedDataReviewed = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  typedData: unknown,
  messageHash: string,
): Promise<boolean> => {
  const preferences = await deps.preferencesStore.read();
  return (
    reviewMultisigStrk20TypedData(
      typedData,
      messageHash,
      Math.floor(deps.now() / 1000),
      multisigStrk20ReviewScope(session.context.record, session.poolAddress, preferences.tokens),
    ) !== null
  );
};

const fragmentFor = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  hash: string,
): Promise<StarkSignature | { readonly error: string }> => {
  const member = session.config.signerPublicKeys.find((key) =>
    sameFelt(key, session.context.active.account.publicKeyX),
  );
  if (!member) return NOT_MEMBER;
  const signed = await signerForContext(deps, {
    account: session.context.active.account,
    vaultPassphrase: session.context.active.vaultPassphrase,
  })(hash);
  return { ...signed, publicKey: member };
};

const signRelayRecord = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  relay: MultisigStrk20RelayRequest,
): Promise<RuntimeResponse> => {
  if (!relay.messageHash || relay.state !== "collecting") {
    return { error: "Argent multisig intent is not collecting signatures" };
  }
  if (
    !isBoundToMultisig(relay, multisigStrk20Binding(session.context.record, session.config)) ||
    !(await typedDataReviewed(deps, session, relay.typedData, relay.messageHash))
  ) {
    return INVALID;
  }
  const fragment = await fragmentFor(deps, session, relay.messageHash);
  if ("error" in fragment) return fragment;
  const next = withMultisigStrk20RelayFragment(relay, fragment);
  if (!next) return NOT_EXACT;
  const stored = await session.store.upsertRelay(next, session.isAuthorized);
  return commitResult(stored, next.id, next.state === "ready" ? "relay" : "authorization");
};

const signInviteRecord = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  id: string,
): Promise<RuntimeResponse | null> => {
  const invite = await session.store.getInvite(id);
  if (!invite || invite.fragments.length >= invite.threshold) return null;
  // Bound again at signing: the live signer set may have changed since import.
  if (
    !isBoundToMultisig(invite, multisigStrk20Binding(session.context.record, session.config)) ||
    !(await typedDataReviewed(deps, session, invite.typedData, invite.messageHash))
  ) {
    return INVALID;
  }
  const fragment = await fragmentFor(deps, session, invite.messageHash);
  if ("error" in fragment) return fragment;
  const next = withMultisigStrk20RelayInviteFragment(invite, fragment);
  if (!next) return NOT_EXACT;
  const stored = await session.store.upsertInvite(next, session.isAuthorized);
  return commitResult(stored, next.id, "authorization");
};

/**
 * Signs a collecting relay or a co-owner's invite. Returns null when `id`
 * is neither, so the caller can try the CallSet round.
 */
export const signCollectedStrk20Relay = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  id: string,
): Promise<RuntimeResponse | null> => {
  const relay = await session.store.getRelay(id);
  return relay ? signRelayRecord(deps, session, relay) : signInviteRecord(deps, session, id);
};

const publishPackage = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  signerPublicKeys: readonly string[],
  content: string,
): Promise<RuntimeResponse> => {
  if (!deps.wallet.nostrPublicKey || !deps.wallet.wrapNostrApplicationData) {
    return { error: "Secure co-signer coordination is unavailable for this wallet" };
  }
  if (content.length > 30_000) return { error: "This authorization is too large to share." };
  const preferences = await deps.preferencesStore.read();
  const own = await deps.wallet.nostrPublicKey(session.context.active.vaultPassphrase);
  const recipients = coordinationRecipients(
    preferences.addressBook,
    session.context.record.networkId,
    own,
    signerPublicKeys.map((key) => argentSignerGuid(key)),
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

/**
 * Wraps a relay invite. The proof is not included. Returns null when `id`
 * is not a typed relay or invite.
 */
export const shareCollectedStrk20Relay = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  id: string,
): Promise<RuntimeResponse | null> => {
  const relay = await session.store.getRelay(id);
  const invite = relay ? multisigStrk20RelayInviteFrom(relay) : await session.store.getInvite(id);
  if (!invite) return null;
  return publishPackage(
    deps,
    session,
    invite.signerPublicKeys,
    JSON.stringify({ invite, kind: "relay", version: 1 }),
  );
};
