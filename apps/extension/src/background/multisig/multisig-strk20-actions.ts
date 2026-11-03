/**
 * Multisig STRK20 actions: register, deposit, transfer, and withdraw.
 * Messages report ids and phases, never the shared scalar or proof bytes.
 */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { staleArgentMultisigIntent } from "@bramble/multisig/repository";
import {
  strk20ProofBaseBlock,
  strk20ProofSubmittable,
} from "@bramble/privacy/multisig-proof-window";
import {
  MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER,
  type MultisigStrk20ActionRequest,
  multisigStrk20CallSetAggregate,
  withMultisigStrk20Fragment,
} from "@bramble/privacy/multisig-strk20";
import { resolveMultisigStrk20Amount } from "@bramble/privacy/multisig-strk20-token";
import { submitStrk20PaymasterPlan } from "@bramble/privacy/paymaster";
import { relayClaimSlots } from "@bramble/privacy/relay-claim-slots";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { isAccountId } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { type TypedData, typedData } from "starknet";
import { signerForContext } from "../accounts/wallet-ops";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { MultisigOpsDeps } from "./multisig-deps";
import {
  coordinationRecipients,
  coordinationRelayUrls,
  publishForRecipients,
} from "./multisig-nostr-publish";
import { proveMultisigStrk20 } from "./multisig-strk20-prove";
import {
  multisigStrk20PanelCards,
  shareCollectedStrk20Relay,
  signCollectedStrk20Relay,
} from "./multisig-strk20-relay";
import {
  MULTISIG_STRK20_PROOF_EXPIRED,
  type MultisigStrk20Session,
  openMultisigStrk20Session,
  readMultisigStrk20Window,
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

const prepare = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const parsed = requestFrom(message);
  if (!parsed) return { error: "invalid multisig private action" };
  if ("error" in parsed) return parsed;
  const session = await openMultisigStrk20Session(deps, parsed.id);
  if ("error" in session) return session;
  if ("request" in parsed) {
    return proveMultisigStrk20(deps, session, parsed.request, session.readScalar);
  }
  const action = await actionFor(deps, session, parsed.draft);
  if ("error" in action) return action;
  return proveMultisigStrk20(deps, session, action.request, session.readScalar);
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
    return {
      error: relay ? "Argent multisig intent is not ready" : "Argent multisig intent not found",
    };
  }
  const base = strk20ProofBaseBlock(relay.proof.proof_facts);
  if (base === null) return { error: "Invalid Argent multisig private proof" };
  const window = await readMultisigStrk20Window(session.context.rpcUrls, session.poolAddress);
  if (!strk20ProofSubmittable({ baseBlock: base, ...window })) {
    return { error: MULTISIG_STRK20_PROOF_EXPIRED };
  }
  const paymaster = session.privacyConfig.paymaster;
  if (!paymaster || !session.strk20.submitAcceptedRelay) {
    return { error: "strk20 private submission unavailable" };
  }
  const relaySlots = relayClaimSlots([...relay.call.calldata]);
  if (!relaySlots) return { error: "Invalid Argent multisig private proof" };
  const aggregate = relay.messageHash === undefined ? null : relay.fragments;
  const sent = await session.strk20.submitAcceptedRelay({
    ...session.readContext(),
    broadcast: () =>
      submitStrk20PaymasterPlan({
        accountAddress: relay.accountAddress,
        call: {
          calldata: [...relay.call.calldata],
          contractAddress: relay.call.contractAddress,
          entrypoint: relay.call.entrypoint,
        },
        config: paymaster,
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
      }),
    relaySlots: [...relaySlots],
  });
  // The paymaster already accepted this write. Keep the mark if the session
  // lapses afterwards; rolling it back would offer Send again.
  await session.store.upsertRelay({ ...relay, state: "submitted" }, () => true);
  return { ok: true, transactionHash: sent.transactionHash };
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
    preferences.tokens,
    session.context.active.account.publicKeyX,
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
