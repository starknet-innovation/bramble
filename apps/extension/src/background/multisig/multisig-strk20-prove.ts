/**
 * Proves one multisig STRK20 action and freezes the second signing round.
 * Registration and deposit become an account intent. Transfer and withdraw
 * become a relay request. The CallSet aggregate is collected first.
 */

import { WalletError } from "@bramble/core/errors";
import {
  type ArgentMultisigSigningIntent,
  argentMultisigIntentId,
} from "@bramble/multisig/repository";
import type {
  MultisigStrk20ActionRequest,
  MultisigStrk20RelayRequest,
} from "@bramble/privacy/multisig-strk20";
import { multisigStrk20Summary } from "@bramble/privacy/multisig-strk20-review";
import {
  canonicalStrk20PoolFee,
  prepareStrk20AccountActions,
  prepareStrk20Registration,
  quoteStrk20Plan,
  type Strk20AccountContext,
} from "@bramble/privacy/service";
import { preparedArgentMultisigFee } from "@bramble/starknet/multisig-invoke";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action, Strk20Proof } from "@bramble/wallet-protocol/strk20";
import { type TypedData, typedData } from "starknet";
import { signerForContext } from "../accounts/wallet-ops";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { reviewArgentMultisigCalls } from "./multisig-call-review";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-deps";
import { configSnapshot } from "./multisig-ops";
import { MULTISIG_STRK20_WAITING, type MultisigStrk20Session } from "./multisig-strk20-session";

const contextWithScalar = (
  session: MultisigStrk20Session,
  scalar: () => Promise<string>,
): Strk20AccountContext => ({
  account: session.privacyAccount,
  config: session.privacyConfig,
  isAuthorized: session.isAuthorized,
  rpcUrls: session.context.rpcUrls,
  signCallSet: session.signCallSet,
  signHash: () => Promise.reject(new WalletError("Invalid Argent multisig private proof")),
  viewingKey: scalar,
});

const stringCalls = (
  calls: readonly {
    readonly calldata?: unknown;
    readonly contractAddress: string;
    readonly entrypoint: string;
  }[],
): readonly {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
}[] =>
  calls.map((call) => ({
    calldata: (Array.isArray(call.calldata) ? call.calldata : []).map((felt) => String(felt)),
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
  }));

const actionsFor = (request: MultisigStrk20ActionRequest): readonly Strk20Action[] => {
  if (request.kind === "register" || !request.token || !request.amount) return [];
  if (request.kind === "deposit") {
    return [
      {
        amount: request.amount,
        token: request.token,
        type: "deposit",
        ...(request.recipient ? { recipient: request.recipient } : {}),
      },
    ];
  }
  if (request.kind === "withdraw") {
    return [
      {
        amount: request.amount,
        recipient: request.recipient ?? "",
        token: request.token,
        type: "withdraw",
      },
    ];
  }
  return [
    {
      amount: request.amount,
      recipient: request.recipient ?? "",
      token: request.token,
      type: "transfer",
    },
  ];
};

const freezeIntent = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  request: MultisigStrk20ActionRequest,
  calls: readonly { calldata: readonly string[]; contractAddress: string; entrypoint: string }[],
  proof: Strk20Proof,
): Promise<RuntimeResponse> => {
  const normalized = calls.map((call) => ({
    calldata: call.calldata.map((felt) => canonicalFelt(String(felt)) ?? String(felt)),
    contractAddress: canonicalFelt(call.contractAddress) ?? call.contractAddress,
    entrypoint: call.entrypoint,
  }));
  const review = await reviewArgentMultisigCalls(deps, session.context, normalized, {
    signerPublicKeys: session.config.signerPublicKeys,
    threshold: session.config.threshold,
  });
  if (review && "error" in review) return review;
  const prepared = await multisigRpc(deps).prepareInvoke({
    account: session.context.record,
    calls: normalized,
    config: {
      signerPublicKeys: session.config.signerPublicKeys,
      threshold: session.config.threshold,
    },
    proof,
    rpcUrls: session.context.rpcUrls,
  });
  const id = argentMultisigIntentId(session.context.record.id, prepared.transactionHash);
  if (!id || !prepared.proofFacts) return { error: "invalid Argent multisig prepared transaction" };
  const intent: ArgentMultisigSigningIntent = {
    accountId: session.context.record.id,
    configSnapshot: configSnapshot(session.config.chain),
    id,
    prepared,
    signatures: [],
    state: "collecting",
    summary: multisigStrk20Summary(request.kind),
  };
  const stored = await deps.multisigStore.upsertIntent(intent, session.isAuthorized);
  if (stored === "unauthorized") return { error: "wallet locked" };
  if (stored !== "stored") return { error: `Argent multisig intent ${stored}` };
  const liveIntents = (await deps.multisigStore.listIntents())
    .filter(
      (candidate) =>
        candidate.state === "collecting" ||
        candidate.state === "ready" ||
        candidate.state === "submitted",
    )
    .map((candidate) => candidate.id);
  const saved = await session.store.putProof(
    {
      intentId: id,
      proof: { ...proof, proof_facts: [...prepared.proofFacts] },
      request,
    },
    liveIntents,
    session.isAuthorized,
  );
  if (saved === "unauthorized") return { error: "wallet locked" };
  if (saved !== "stored") return { error: "Invalid Argent multisig private proof" };
  return { feeReview: preparedArgentMultisigFee(prepared), intent, ok: true };
};

const signRelayFragment = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  relay: MultisigStrk20RelayRequest,
  messageHash: string | null,
): Promise<MultisigStrk20RelayRequest> => {
  if (!messageHash) return relay;
  const member = session.config.signerPublicKeys.find((key) =>
    sameFelt(key, session.context.active.account.publicKeyX),
  );
  if (!member) return relay;
  const signed = await signerForContext(deps, {
    account: session.context.active.account,
    vaultPassphrase: session.context.active.vaultPassphrase,
  })(messageHash);
  return {
    ...relay,
    fragments: [{ ...signed, publicKey: member }],
    state: session.config.threshold === 1 ? "ready" : "collecting",
  };
};

const feltOrSelf = (value: string): string => canonicalFelt(value) ?? value;

const canonicalCall = (call: {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
}): MultisigStrk20RelayRequest["call"] => ({
  calldata: call.calldata.map(feltOrSelf),
  contractAddress: feltOrSelf(call.contractAddress),
  entrypoint: call.entrypoint,
});

const canonicalWithdraw = (fee: {
  readonly amount: string;
  readonly recipient: string;
  readonly token: string;
}): MultisigStrk20RelayRequest["feeAction"] => ({
  amount: feltOrSelf(fee.amount),
  recipient: feltOrSelf(fee.recipient),
  token: feltOrSelf(fee.token),
  type: "withdraw",
});

const relayStored = (
  stored: string,
  id: string,
  state: MultisigStrk20RelayRequest["state"],
): RuntimeResponse =>
  stored === "stored"
    ? { id, ok: true, phase: state === "collecting" ? "authorization" : "relay" }
    : {
        error:
          stored === "unauthorized" ? "wallet locked" : "Invalid Argent multisig private proof",
      };

const freezeRelay = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  request: MultisigStrk20ActionRequest,
  proof: Strk20Proof,
  call: { calldata: readonly string[]; contractAddress: string; entrypoint: string },
  fee: { readonly amount: string; readonly recipient: string; readonly token: string },
  typed: TypedData | undefined,
  authorization: MultisigStrk20RelayRequest["authorization"],
): Promise<RuntimeResponse> => {
  const messageHash = typed
    ? canonicalFelt(typedData.getMessageHash(typed, session.context.record.address))
    : null;
  if (typed && !messageHash) return { error: "Invalid Argent multisig private proof" };
  const fingerprint = messageHash ?? canonicalFelt(proof.proof_facts.at(-1) ?? "");
  if (!fingerprint) return { error: "Invalid Argent multisig private proof" };
  const relay: MultisigStrk20RelayRequest = {
    accountAddress: session.context.record.address,
    accountId: session.context.record.id,
    ...(authorization ? { authorization } : {}),
    call: canonicalCall(call),
    feeAction: canonicalWithdraw(fee),
    fragments: [],
    id: `${session.context.record.id}:${fingerprint}`,
    ...(messageHash ? { messageHash } : {}),
    proof: { ...proof, proof_facts: proof.proof_facts.map(feltOrSelf) },
    request,
    signerPublicKeys: session.config.signerPublicKeys,
    state: messageHash ? "collecting" : "ready",
    summary: multisigStrk20Summary(request.kind),
    threshold: session.config.threshold,
    ...(typed ? { typedData: typed } : {}),
  };
  const locallySigned = await signRelayFragment(deps, session, relay, messageHash);
  const stored = await session.store.upsertRelay(locallySigned, session.isAuthorized);
  return relayStored(stored, relay.id, locallySigned.state);
};

const proveRelay = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  context: Strk20AccountContext,
  request: MultisigStrk20ActionRequest,
): Promise<RuntimeResponse> => {
  const plan = await quoteStrk20Plan(session.strk20, { ...context, actions: actionsFor(request) });
  if (!("feeAction" in plan)) return { error: "strk20 private submission unavailable" };
  const proved = await session.strk20.prepare({
    ...context,
    actions: [...actionsFor(request), plan.feeAction],
    simulate: false,
  });
  const typed = plan.typedData;
  const typedValue = typed && typeof typed === "object" ? (typed as TypedData) : undefined;
  return freezeRelay(
    deps,
    session,
    request,
    proved.proof,
    {
      calldata: [...proved.call.calldata],
      contractAddress: proved.call.contract_address,
      entrypoint: proved.call.entry_point,
    },
    plan.feeAction,
    typedValue,
    typedValue ? plan.authorization : undefined,
  );
};

const proveAccount = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  context: Strk20AccountContext,
  request: MultisigStrk20ActionRequest,
): Promise<RuntimeResponse> => {
  if (!session.strk20.poolFee) {
    return { error: "Private balances are not configured for this network" };
  }
  const poolFeeFri = canonicalStrk20PoolFee(await session.strk20.poolFee(context));
  const prepared =
    request.kind === "register"
      ? await prepareStrk20Registration(session.strk20, { ...context, poolFeeFri })
      : await prepareStrk20AccountActions(session.strk20, {
          ...context,
          actions: actionsFor(request),
          poolFeeFri,
        });
  return freezeIntent(deps, session, request, stringCalls(prepared.calls), prepared.proof);
};

/**
 * Proves `request` and freezes the account transaction or the relay request.
 * When the CallSet still needs co-owners, returns the authorization id instead.
 */
export const proveMultisigStrk20 = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  request: MultisigStrk20ActionRequest,
  scalar: () => Promise<string>,
): Promise<RuntimeResponse> => {
  session.prepareRequest(request);
  const context = contextWithScalar(session, scalar);
  try {
    if (request.kind === "register" || request.kind === "deposit") {
      return proveAccount(deps, session, context, request);
    }
    return proveRelay(deps, session, context, request);
  } catch (error) {
    if (error instanceof WalletError && error.message === MULTISIG_STRK20_WAITING) {
      const id = session.waitingId();
      return id ? { id, ok: true, phase: "authorization" } : { error: error.message };
    }
    throw error;
  }
};
