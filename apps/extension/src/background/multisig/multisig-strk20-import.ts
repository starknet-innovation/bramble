/**
 * Imports a co-owner's CallSet authorization or relay invite from a Nostr gift
 * wrap. The package is bound to this wallet's own record and to the signer
 * set read from the chain, and it must decode into a review before it is
 * stored. A wrap that can never become valid is final; only a cause that can
 * clear (RPC down, pool unset, key missing, collection full) is retried.
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
  isBoundToMultisig,
  type MultisigStrk20Binding,
} from "@bramble/privacy/multisig-strk20-binding";
import {
  isMultisigStrk20RelayInvite,
  type MultisigStrk20RelayInvite,
} from "@bramble/privacy/multisig-strk20-relay-invite";
import {
  type MultisigStrk20ReviewScope,
  reviewMultisigStrk20Calls,
  reviewMultisigStrk20TypedData,
} from "@bramble/privacy/multisig-strk20-review";
import type { MultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import type { NostrApplicationData } from "@bramble/vault/kms-port";
import { readMultisigStrk20KeyPackage } from "@bramble/vault/multisig-strk20-key";
import { canonicalFelt, STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import type { AddressBookEntry } from "@bramble/wallet-model/preferences";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { MultisigOpsDeps } from "./multisig-deps";
import { isCoordinationSigner, isSavedNostrContact } from "./multisig-nostr-publish";
import { currentConfigFor } from "./multisig-ops";
import { multisigStrk20Binding, multisigStrk20ReviewScope } from "./multisig-strk20-scope";

type Imported = { readonly final: boolean };
type Upsert = "conflict" | "full" | "invalid" | "stored" | "unauthorized";

type SharedPackage =
  | { readonly body: Record<string, unknown>; readonly kind: "call-set" | "relay" }
  | { readonly final: true };

const parsedPackage = (content: string): SharedPackage => {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed) || parsed["version"] !== 1) return { final: true };
    if (parsed["kind"] === "call-set" && isRecord(parsed["authorization"])) {
      return { body: parsed["authorization"], kind: "call-set" };
    }
    if (parsed["kind"] === "relay" && isRecord(parsed["invite"])) {
      return { body: parsed["invite"], kind: "relay" };
    }
    return { final: true };
  } catch {
    return { final: true };
  }
};

// A full collection can clear once a row finishes, so that wrap is retried.
const settled = (stored: Upsert): Imported => {
  if (stored === "unauthorized") throw new WalletError("wallet locked");
  return { final: stored !== "full" };
};

const mergeRelay = async (
  store: MultisigStrk20Store,
  relay: MultisigStrk20RelayRequest,
  invite: MultisigStrk20RelayInvite,
  isAuthorized: () => boolean,
): Promise<Imported> => {
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
  deps: MultisigOpsDeps,
  store: MultisigStrk20Store,
  body: Record<string, unknown>,
  bound: { readonly binding: MultisigStrk20Binding; readonly scope: MultisigStrk20ReviewScope },
  isAuthorized: () => boolean,
): Promise<Imported> => {
  if (
    !isMultisigStrk20RelayInvite(body) ||
    !isBoundToMultisig(body, bound.binding) ||
    !reviewMultisigStrk20TypedData(
      body.typedData,
      body.messageHash,
      Math.floor(deps.now() / 1000),
      bound.scope,
    )
  ) {
    return { final: true };
  }
  const relay = await store.getRelay(body.id);
  if (relay) {
    if (!relay.messageHash || !sameFelt(relay.messageHash, body.messageHash)) {
      return { final: true };
    }
    return mergeRelay(store, relay, body, isAuthorized);
  }
  return settled(await store.upsertInvite(body, isAuthorized));
};

const boundShape = (
  body: Record<string, unknown>,
): body is Record<string, unknown> & Parameters<typeof isBoundToMultisig>[0] =>
  typeof body["accountAddress"] === "string" &&
  typeof body["accountId"] === "string" &&
  typeof body["chainId"] === "string" &&
  typeof body["threshold"] === "number" &&
  Array.isArray(body["signerPublicKeys"]) &&
  body["signerPublicKeys"].every((key) => typeof key === "string");

const importCallSet = async (
  deps: MultisigOpsDeps,
  store: MultisigStrk20Store,
  record: ArgentMultisigRecord,
  body: Record<string, unknown>,
  bound: { readonly binding: MultisigStrk20Binding; readonly scope: MultisigStrk20ReviewScope },
  passphrase: string,
  isAuthorized: () => boolean,
): Promise<Imported> => {
  // Binding needs no key, so a package for another account, chain, or signer
  // set is final before it can wait on one.
  if (!boundShape(body) || !isBoundToMultisig(body, bound.binding)) return { final: true };
  const pack = deps.wallet.packageMultisigStrk20Key;
  if (!pack) return { final: false };
  const packed = await pack({
    chainId: bound.binding.chainId,
    multisigId: record.id,
    poolAddress: bound.scope.poolAddress,
    vaultPassphrase: passphrase,
  });
  // The viewing key may arrive in a later wrap of this same sync.
  const scalar = packed ? readMultisigStrk20KeyPackage(packed)?.key : undefined;
  if (!scalar) return { final: false };
  if (
    !isMultisigStrk20Authorization(body, scalar) ||
    !isBoundToMultisig(body, bound.binding) ||
    !reviewMultisigStrk20Calls(body.calls, scalar, bound.scope)
  ) {
    return { final: true };
  }
  return settled(await store.upsertAuthorization(body, scalar, isAuthorized));
};

const liveBinding = async (
  deps: MultisigOpsDeps,
  record: ArgentMultisigRecord,
): Promise<{
  readonly binding: MultisigStrk20Binding;
  readonly scope: MultisigStrk20ReviewScope;
} | null> => {
  const preferences = await deps.preferencesStore.read();
  const pool = canonicalFelt(preferences.strk20Networks?.[record.networkId]?.poolAddress ?? "");
  if (!pool) return null;
  try {
    const config = await currentConfigFor(deps, {
      record,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences),
    });
    return {
      binding: multisigStrk20Binding(record, config),
      scope: multisigStrk20ReviewScope(record, pool, preferences.tokens),
    };
  } catch {
    return null;
  }
};

/**
 * Stores a co-owner's CallSet authorization or relay invite. Returns null
 * when the wrap is some other application. A wrap for another multisig, from
 * a non-contact or a non-signer, or that does not bind and decode, is final.
 * Proof bytes are not accepted on this path.
 */
export const importSharedStrk20Authorization = async (
  deps: MultisigOpsDeps,
  opened: NostrApplicationData,
  contacts: readonly AddressBookEntry[],
  records: readonly ArgentMultisigRecord[],
  passphrase: string,
  isAuthorized: () => boolean,
): Promise<Imported | null> => {
  if (opened.identifier !== MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER) return null;
  if (!isAuthorized()) throw new WalletError("wallet locked");
  const parsed = parsedPackage(opened.content);
  if ("final" in parsed) return parsed;
  const record = records.find((candidate) => candidate.id === parsed.body["accountId"]);
  if (!record || !isSavedNostrContact(contacts, opened.senderPublicKey, record.networkId)) {
    return { final: true };
  }
  const store = deps.strk20MultisigStore;
  const bound = store ? await liveBinding(deps, record) : null;
  if (!store || !bound) return { final: false };
  const guids = bound.binding.signerPublicKeys.map((key) => argentSignerGuid(key));
  if (!isCoordinationSigner(contacts, opened.senderPublicKey, record.networkId, guids)) {
    return { final: true };
  }
  return parsed.kind === "relay"
    ? importRelay(deps, store, parsed.body, bound, isAuthorized)
    : importCallSet(deps, store, record, parsed.body, bound, passphrase, isAuthorized);
};
