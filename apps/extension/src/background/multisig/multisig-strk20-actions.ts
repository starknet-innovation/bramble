/**
 * Multisig STRK20 actions: register, deposit, transfer, and withdraw.
 * Messages report ids and phases, never the shared scalar or proof bytes.
 */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import { staleArgentMultisigIntent } from "@bramble/multisig/repository";
import {
  strk20ProofBaseBlock,
  strk20ProofSubmittable,
} from "@bramble/privacy/multisig-proof-window";
import {
  isMultisigStrk20Authorization,
  MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER,
  type MultisigStrk20ActionRequest,
  multisigStrk20CallSetAggregate,
  withMultisigStrk20Fragment,
} from "@bramble/privacy/multisig-strk20";
import { submitStrk20PaymasterPlan } from "@bramble/privacy/paymaster";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { parseTokenAmount } from "@bramble/starknet/rpc";
import type { NostrApplicationData } from "@bramble/vault/kms-port";
import { isAccountId } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  STARKNET_NETWORKS,
  STRK_TOKEN_ADDRESS,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { AddressBookEntry } from "@bramble/wallet-model/preferences";
import { num, type TypedData, typedData } from "starknet";
import { signerForContext } from "../accounts/wallet-ops";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { MultisigOpsDeps } from "./multisig-deps";
import {
  coordinationRecipients,
  coordinationRelayUrls,
  isCoordinationSigner,
  publishForRecipients,
} from "./multisig-nostr-publish";
import { proveMultisigStrk20 } from "./multisig-strk20-prove";
import {
  MULTISIG_STRK20_PROOF_EXPIRED,
  openMultisigStrk20Session,
  readMultisigStrk20Window,
} from "./multisig-strk20-session";
import { nativeNostrRelayTransport } from "./nostr-relay";

const PREPARE = "wallet.prepareArgentMultisigStrk20";
const SIGN = "wallet.signArgentMultisigStrk20Authorization";
const SHARE = "wallet.shareArgentMultisigStrk20Authorization";
const REFRESH = "wallet.refreshArgentMultisigStrk20";
const SUBMIT = "wallet.submitArgentMultisigStrk20Relay";

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

const rawUnits = (amount: unknown): string | { readonly error: string } => {
  if (typeof amount !== "string") return INVALID_ACTION;
  try {
    return num.toHex(parseTokenAmount(amount, 18));
  } catch (error) {
    return { error: error instanceof WalletError ? error.message : INVALID_ACTION.error };
  }
};

const counterparty = (recipient: unknown): string | { readonly error: string } => {
  const to = canonicalFelt(String(recipient ?? ""));
  return to !== null && isNonZeroStarkFieldElement(to) ? to : INVALID_ACTION;
};

const paidRequest = (
  id: string,
  kind: "deposit" | "transfer" | "withdraw",
  amount: unknown,
  recipient: unknown,
  tokenText: unknown,
):
  | { readonly id: string; readonly request: MultisigStrk20ActionRequest }
  | { readonly error: string } => {
  const raw = rawUnits(amount);
  if (typeof raw !== "string") return raw;
  const token = canonicalFelt(typeof tokenText === "string" ? tokenText : STRK_TOKEN_ADDRESS);
  if (!token) return INVALID_ACTION;
  if (kind === "deposit" && recipient === undefined) {
    return { id, request: { amount: raw, kind, token } };
  }
  const to = counterparty(recipient);
  if (typeof to !== "string") return to;
  return { id, request: { amount: raw, kind, recipient: to, token } };
};

const requestFrom = (
  message: unknown,
):
  | { readonly id: string; readonly request: MultisigStrk20ActionRequest }
  | { readonly error: string }
  | null => {
  if (!isRecord(message) || message["type"] !== PREPARE || !isAccountId(message["multisigId"])) {
    return null;
  }
  const kind = message["kind"];
  if (kind === "register") return { id: message["multisigId"], request: { kind } };
  if (kind !== "deposit" && kind !== "transfer" && kind !== "withdraw") return INVALID_ACTION;
  return paidRequest(
    message["multisigId"],
    kind,
    message["amount"],
    message["recipient"],
    message["token"],
  );
};

const prepare = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const parsed = requestFrom(message);
  if (!parsed) return { error: "invalid multisig private action" };
  if ("error" in parsed) return parsed;
  const session = await openMultisigStrk20Session(deps, parsed.id);
  if ("error" in session) return session;
  return proveMultisigStrk20(deps, session, parsed.request, session.readScalar);
};

const signCollected = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const id = readId(message, SIGN, "id");
  if (!id) return { error: "invalid multisig private action" };
  const accountId = id.slice(0, id.lastIndexOf(":"));
  const session = await openMultisigStrk20Session(deps, accountId);
  if ("error" in session) return session;
  const authorization = await session.store.getAuthorization(id, await session.readScalar());
  if (authorization?.state !== "collecting") {
    return {
      error: authorization
        ? "Argent multisig intent is not collecting signatures"
        : "Argent multisig intent not found",
    };
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
  const stored = await session.store.upsertAuthorization(next, await session.readScalar());
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
  if (!authorization) return { error: "Argent multisig intent not found" };
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
  if (!id) return { error: "invalid multisig private action" };
  const intent = await deps.multisigStore.getIntent(id);
  const accountId = intent?.accountId ?? id.slice(0, id.lastIndexOf(":"));
  const session = await openMultisigStrk20Session(deps, accountId);
  if ("error" in session) return session;
  const proof = intent ? await session.store.getProof(intent.id) : null;
  const relay = proof ? null : await session.store.getRelay(id);
  const base = strk20ProofBaseBlock(proof?.proof.proof_facts ?? relay?.proof.proof_facts ?? []);
  if (base === null) return { error: "Argent multisig private proof is missing" };
  const window = await readMultisigStrk20Window(session.context.rpcUrls, session.poolAddress);
  if (strk20ProofSubmittable({ baseBlock: base, ...window })) {
    return { id, ok: true, phase: "fresh" };
  }
  const request = proof?.request ?? relay?.request;
  if (!request) return { error: "Argent multisig private proof is missing" };
  if (intent) {
    await deps.multisigStore.upsertIntent(
      staleArgentMultisigIntent(intent, "proof"),
      session.isAuthorized,
    );
    await session.store.dropProof(intent.id);
  }
  return proveMultisigStrk20(deps, session, request, session.readScalar);
};

const submitRelay = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const id = readId(message, SUBMIT, "id");
  if (!id) return { error: "invalid multisig private action" };
  const session = await openMultisigStrk20Session(deps, id.slice(0, id.lastIndexOf(":")));
  if ("error" in session) return session;
  const relay = await session.store.getRelay(id);
  if (!relay || relay.state === "collecting") {
    return { error: relay ? "Argent multisig intent is not ready" : "Argent multisig intent not found" };
  }
  const base = strk20ProofBaseBlock(relay.proof.proof_facts);
  if (base === null) return { error: "Invalid Argent multisig private proof" };
  const window = await readMultisigStrk20Window(session.context.rpcUrls, session.poolAddress);
  if (!strk20ProofSubmittable({ baseBlock: base, ...window })) {
    return { error: MULTISIG_STRK20_PROOF_EXPIRED };
  }
  if (!session.privacyConfig.paymaster) return { error: "strk20 private submission unavailable" };
  const aggregate = relay.messageHash === undefined ? null : relay.fragments;
  const sent = await submitStrk20PaymasterPlan({
    accountAddress: relay.accountAddress,
    call: {
      calldata: [...relay.call.calldata],
      contractAddress: relay.call.contractAddress,
      entrypoint: relay.call.entrypoint,
    },
    config: session.privacyConfig.paymaster,
    isAuthorized: session.isAuthorized,
    nowSeconds: Math.floor(deps.now() / 1000),
    plan: {
      ...(relay.authorization ? { authorization: relay.authorization } : {}),
      feeAction: relay.feeAction,
      mode: "private-relay",
      ...(relay.typedData ? { typedData: relay.typedData } : {}),
    },
    proof: relay.proof,
    signTypedData: async (value) => {
      if (!relay.messageHash || !aggregate)
        throw new WalletError("Invalid Argent multisig private proof");
      const again = canonicalFelt(
        typedData.getMessageHash(value as TypedData, relay.accountAddress),
      );
      if (!again || !sameFelt(again, relay.messageHash)) {
        throw new WalletError(
          "Argent multisig private proof does not match the signed transaction",
        );
      }
      return [
        ...multisigStrk20CallSetAggregate(aggregate, {
          signerPublicKeys: relay.signerPublicKeys,
          threshold: relay.threshold,
        }),
      ];
    },
  });
  await session.store.upsertRelay({ ...relay, state: "submitted" });
  return { ok: true, transactionHash: sent.transactionHash };
};

const HANDLERS = {
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

const isFinal = (
  value: Record<string, unknown> | { readonly final: true },
): value is { readonly final: true } => "final" in value && value.final === true;

const authorizationBody = (content: string): Record<string, unknown> | { readonly final: true } => {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed) || parsed["kind"] !== "call-set" || parsed["version"] !== 1) {
      return { final: true };
    }
    return isRecord(parsed["authorization"]) &&
      typeof parsed["authorization"]["accountId"] === "string"
      ? parsed["authorization"]
      : { final: true };
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

/**
 * Stores a co-owner's CallSet authorization. Returns null when the wrap is
 * some other application. A missing scalar is left for a later sync.
 */
export const importSharedStrk20Authorization = async (
  deps: MultisigOpsDeps,
  opened: NostrApplicationData,
  contacts: readonly AddressBookEntry[],
  records: readonly ArgentMultisigRecord[],
  passphrase: string,
): Promise<{ readonly final: boolean } | null> => {
  if (opened.identifier !== MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER) return null;
  const body = authorizationBody(opened.content);
  if (isFinal(body)) return body;
  const record = records.find((candidate) => candidate.id === body["accountId"]);
  const store = deps.strk20MultisigStore;
  const pack = deps.wallet.packageMultisigStrk20Key;
  if (!record || !store || !pack) return { final: false };
  const guids = signerGuids(body["signerPublicKeys"]);
  if (!guids) return { final: true };
  if (!isCoordinationSigner(contacts, opened.senderPublicKey, record.networkId, guids)) {
    return { final: true };
  }
  const preferences = await deps.preferencesStore.read();
  const pool = canonicalFelt(preferences.strk20Networks?.[record.networkId]?.poolAddress ?? "");
  if (!pool) return { final: false };
  const scalar = await pack({
    chainId: STARKNET_NETWORKS[record.networkId].chainId,
    multisigId: record.id,
    poolAddress: pool,
    vaultPassphrase: passphrase,
  });
  if (!scalar || !isMultisigStrk20Authorization(body, scalar)) return { final: !scalar };
  const stored = await store.upsertAuthorization(body, scalar);
  return { final: stored === "stored" || stored === "conflict" };
};
