/**
 * Collects the second multisig STRK20 round: the paymaster typed-data digest.
 * Co-owners exchange fragments only. The proof stays on the device that built
 * it and is never placed in a gift wrap.
 */

import { WalletError } from "@bramble/core/errors";
import { isRecord } from "@bramble/core/json";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import {
  isMultisigStrk20Authorization,
  MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER,
  type MultisigStrk20RelayRequest,
  withMultisigStrk20RelayFragment,
} from "@bramble/privacy/multisig-strk20";
import {
  isMultisigStrk20RelayInvite,
  type MultisigStrk20RelayInvite,
  multisigStrk20RelayInviteFrom,
  withMultisigStrk20RelayInviteFragment,
} from "@bramble/privacy/multisig-strk20-relay-invite";
import {
  reviewMultisigStrk20Calls,
  reviewMultisigStrk20TypedData,
} from "@bramble/privacy/multisig-strk20-review";
import type { MultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import type { NostrApplicationData } from "@bramble/vault/kms-port";
import { readMultisigStrk20KeyPackage } from "@bramble/vault/multisig-strk20-key";
import { canonicalFelt, STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import type { AddressBookEntry } from "@bramble/wallet-model/preferences";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import { signerForContext } from "../accounts/wallet-ops";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { MultisigOpsDeps } from "./multisig-deps";
import {
  coordinationRecipients,
  coordinationRelayUrls,
  isCoordinationSigner,
  publishForRecipients,
} from "./multisig-nostr-publish";
import type { MultisigStrk20Session } from "./multisig-strk20-session";
import { nativeNostrRelayTransport } from "./nostr-relay";

/**
 * One card the private-balance panel can offer. `summary` and `lines` come
 * from the hashed calls or the typed data, never from a sender's label.
 */
export type MultisigStrk20PanelCard = {
  readonly id: string;
  readonly lines: readonly string[];
  readonly offer: "send" | "share" | "sign";
  readonly refresh: boolean;
  readonly summary: string;
};

type TokenName = { readonly address: string; readonly symbol: string };

const INVALID = { error: "Invalid Argent multisig private proof" } as const;
const NOT_MEMBER = { error: "selected account is not a current Argent multisig signer" } as const;
const NOT_EXACT = {
  error: "signature is not valid for this exact Argent multisig intent",
} as const;

const youSigned = (fragments: readonly { readonly publicKey: string }[], mine: string): boolean =>
  fragments.some((fragment) => sameFelt(fragment.publicKey, mine));

const commitResult = (
  stored: "conflict" | "full" | "invalid" | "stored" | "unauthorized",
  id: string,
  phase: "authorization" | "relay",
): RuntimeResponse => {
  if (stored === "unauthorized") return { error: "wallet locked" };
  return stored === "stored" ? { id, ok: true, phase } : INVALID;
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

const plainLines = (
  calldata: readonly string[],
  scalar: string,
  tokens: readonly TokenName[],
): readonly string[] =>
  calldata.flatMap((felt) => {
    if (sameFelt(felt, scalar)) return [];
    return [tokens.find((candidate) => sameFelt(candidate.address, felt))?.symbol ?? felt];
  });

const authorizationCard = (
  row: {
    readonly calls: Parameters<typeof reviewMultisigStrk20Calls>[0];
    readonly fragments: readonly { readonly publicKey: string }[];
    readonly id: string;
    readonly state: "collecting" | "ready";
  },
  scalar: string,
  tokens: readonly TokenName[],
  mine: string,
): MultisigStrk20PanelCard | null => {
  const review = reviewMultisigStrk20Calls(row.calls, scalar, tokens);
  if (!review) return null;
  const signed = youSigned(row.fragments, mine);
  return {
    id: row.id,
    lines: review.lines,
    offer: !signed && row.state === "collecting" ? "sign" : "share",
    refresh: false,
    summary: review.title,
  };
};

const relayCard = (
  row: MultisigStrk20RelayRequest,
  scalar: string,
  tokens: readonly TokenName[],
  mine: string,
): MultisigStrk20PanelCard | null => {
  const signed = youSigned(row.fragments, mine);
  if (row.messageHash && row.typedData) {
    const review = reviewMultisigStrk20TypedData(
      row.typedData,
      row.accountAddress,
      row.messageHash,
      scalar,
      tokens,
      row.call.entrypoint,
    );
    if (!review) return null;
    return {
      id: row.id,
      lines: review.lines,
      offer: row.state === "ready" ? "send" : signed ? "share" : "sign",
      refresh: true,
      summary: review.title,
    };
  }
  return {
    id: row.id,
    lines: plainLines(row.call.calldata, scalar, tokens),
    offer: "send",
    refresh: true,
    summary: row.call.entrypoint,
  };
};

const inviteCard = (
  row: MultisigStrk20RelayInvite,
  scalar: string,
  tokens: readonly TokenName[],
  mine: string,
): MultisigStrk20PanelCard | null => {
  const review = reviewMultisigStrk20TypedData(
    row.typedData,
    row.accountAddress,
    row.messageHash,
    scalar,
    tokens,
  );
  if (!review) return null;
  const signed = youSigned(row.fragments, mine);
  return {
    id: row.id,
    lines: review.lines,
    offer: !signed && row.fragments.length < row.threshold ? "sign" : "share",
    refresh: false,
    summary: review.title,
  };
};

/**
 * Panel cards for this multisig. Ready CallSet records stay visible so a
 * co-owner can return the fragment. Relays stay visible after a reload.
 */
export const multisigStrk20PanelCards = async (
  session: MultisigStrk20Session,
  scalar: string,
  tokens: readonly TokenName[],
  mine: string,
): Promise<{
  readonly authorizations: readonly MultisigStrk20PanelCard[];
  readonly relays: readonly MultisigStrk20PanelCard[];
}> => {
  const stored = await session.store.listAuthorizations(session.context.record.id, scalar);
  const authorizations = stored.flatMap((row) => {
    const card = authorizationCard(row, scalar, tokens, mine);
    return card ? [card] : [];
  });
  const relays = await session.store.listRelays(session.context.record.id);
  const relayIds = new Set(relays.map((row) => row.id));
  const invites = (await session.store.listInvites(session.context.record.id)).filter(
    (row) => !relayIds.has(row.id),
  );
  return {
    authorizations,
    relays: [
      ...relays.flatMap((row) => {
        const card = relayCard(row, scalar, tokens, mine);
        return card ? [card] : [];
      }),
      ...invites.flatMap((row) => {
        const card = inviteCard(row, scalar, tokens, mine);
        return card ? [card] : [];
      }),
    ],
  };
};

type SharedPackage =
  | { readonly body: Record<string, unknown>; readonly kind: "call-set" | "relay" }
  | { readonly final: true };

const parsedPackage = (content: string): SharedPackage => {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed) || parsed["version"] !== 1) return { final: true };
    if (parsed["kind"] === "call-set" && isRecord(parsed["authorization"])) {
      return typeof parsed["authorization"]["accountId"] === "string"
        ? { body: parsed["authorization"], kind: "call-set" }
        : { final: true };
    }
    if (parsed["kind"] === "relay" && isRecord(parsed["invite"])) {
      return { body: parsed["invite"], kind: "relay" };
    }
    return { final: true };
  } catch {
    return { final: true };
  }
};

const signerGuids = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value)) return [];
  try {
    return value
      .filter((key): key is string => typeof key === "string")
      .map((key) => argentSignerGuid(key));
  } catch {
    return null;
  }
};

const settled = (
  stored: "conflict" | "full" | "invalid" | "stored" | "unauthorized",
): { readonly final: boolean } => {
  if (stored === "unauthorized") throw new WalletError("wallet locked");
  return { final: stored === "stored" || stored === "conflict" };
};

const mergeRelay = async (
  store: MultisigStrk20Store,
  relay: MultisigStrk20RelayRequest,
  invite: MultisigStrk20RelayInvite,
  isAuthorized: () => boolean,
): Promise<{ readonly final: boolean }> => {
  let next = relay;
  for (const fragment of invite.fragments) {
    if (next.fragments.some((existing) => existing.publicKey === fragment.publicKey)) continue;
    const added = withMultisigStrk20RelayFragment(next, fragment);
    if (!added) return { final: true };
    next = added;
  }
  if (next === relay) return { final: true };
  return settled(await store.upsertRelay(next, isAuthorized));
};

const importRelay = async (
  store: MultisigStrk20Store,
  body: Record<string, unknown>,
  isAuthorized: () => boolean,
): Promise<{ readonly final: boolean }> => {
  if (!isMultisigStrk20RelayInvite(body)) return { final: true };
  const relay = await store.getRelay(body.id);
  if (relay) {
    if (!relay.messageHash || !sameFelt(relay.messageHash, body.messageHash))
      return { final: true };
    return mergeRelay(store, relay, body, isAuthorized);
  }
  return settled(await store.upsertInvite(body, isAuthorized));
};

const importCallSet = async (
  deps: MultisigOpsDeps,
  store: MultisigStrk20Store,
  record: ArgentMultisigRecord,
  body: Record<string, unknown>,
  passphrase: string,
  isAuthorized: () => boolean,
): Promise<{ readonly final: boolean }> => {
  const preferences = await deps.preferencesStore.read();
  const pool = canonicalFelt(preferences.strk20Networks?.[record.networkId]?.poolAddress ?? "");
  const pack = deps.wallet.packageMultisigStrk20Key;
  if (!pool || !pack) return { final: false };
  const packed = await pack({
    chainId: STARKNET_NETWORKS[record.networkId].chainId,
    multisigId: record.id,
    poolAddress: pool,
    vaultPassphrase: passphrase,
  });
  const scalar = packed ? readMultisigStrk20KeyPackage(packed)?.key : undefined;
  if (!scalar || !isMultisigStrk20Authorization(body, scalar)) return { final: !scalar };
  return settled(await store.upsertAuthorization(body, scalar, isAuthorized));
};

/**
 * Stores a co-owner's CallSet authorization or relay invite. Returns null
 * when the wrap is some other application. A missing scalar is left for a
 * later sync. Proof bytes are not accepted on this path.
 */
export const importSharedStrk20Authorization = async (
  deps: MultisigOpsDeps,
  opened: NostrApplicationData,
  contacts: readonly AddressBookEntry[],
  records: readonly ArgentMultisigRecord[],
  passphrase: string,
  isAuthorized: () => boolean,
): Promise<{ readonly final: boolean } | null> => {
  if (opened.identifier !== MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER) return null;
  if (!isAuthorized()) throw new WalletError("wallet locked");
  const parsed = parsedPackage(opened.content);
  if ("final" in parsed) return parsed;
  const record = records.find((candidate) => candidate.id === parsed.body["accountId"]);
  const store = deps.strk20MultisigStore;
  if (!record || !store) return { final: false };
  const guids = signerGuids(parsed.body["signerPublicKeys"]);
  if (!guids) return { final: true };
  if (!isCoordinationSigner(contacts, opened.senderPublicKey, record.networkId, guids)) {
    return { final: true };
  }
  return parsed.kind === "relay"
    ? importRelay(store, parsed.body, isAuthorized)
    : importCallSet(deps, store, record, parsed.body, passphrase, isAuthorized);
};
