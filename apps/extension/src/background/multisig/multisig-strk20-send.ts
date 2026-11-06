/**
 * Refresh and Send for multisig STRK20 rounds. A proof is repeated only for
 * an action that cannot have gone out, and a relay is sent only once.
 */

import { WalletError } from "@bramble/core/errors";
import {
  type ArgentMultisigIntentState,
  type ArgentMultisigSigningIntent,
  staleArgentMultisigIntent,
} from "@bramble/multisig/repository";
import {
  strk20ProofBaseBlock,
  strk20ProofSubmittable,
} from "@bramble/privacy/multisig-proof-window";
import {
  type MultisigStrk20ActionRequest,
  multisigStrk20CallSetAggregate,
} from "@bramble/privacy/multisig-strk20";
import { submitStrk20PaymasterPlan } from "@bramble/privacy/paymaster";
import { relayClaimSlots } from "@bramble/privacy/relay-claim-slots";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";
import { type TypedData, typedData } from "starknet";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { MultisigOpsDeps } from "./multisig-deps";
import { ARGENT_INTENT_ALREADY_SENT } from "./multisig-stale-intents";
import { proveMultisigStrk20 } from "./multisig-strk20-prove";
import {
  MULTISIG_STRK20_PROOF_EXPIRED,
  type MultisigStrk20Session,
  openMultisigStrk20Session,
  readMultisigStrk20Window,
} from "./multisig-strk20-session";

// States in which the transaction cannot have been broadcast.
const REFRESHABLE: ReadonlySet<ArgentMultisigIntentState> = new Set([
  "collecting",
  "ready",
  "stale",
]);

// Marks the intent stale before its proof is dropped; a refused mark stops the refresh.
const retireIntent = async (
  deps: MultisigOpsDeps,
  session: MultisigStrk20Session,
  intent: ArgentMultisigSigningIntent,
): Promise<RuntimeResponse | null> => {
  const marked = await deps.multisigStore.upsertIntent(
    staleArgentMultisigIntent(intent, "proof"),
    session.isAuthorized,
  );
  if (marked === "unauthorized") return { error: "wallet locked" };
  if (marked !== "stored") return { error: ARGENT_INTENT_ALREADY_SENT };
  await session.store.dropProof(intent.id);
  return null;
};

const MISSING = { error: "Argent multisig private proof is missing" } as const;

// The stored proof's base block and request, refused when the intent or relay
// may already have been sent.
const heldProof = async (
  session: MultisigStrk20Session,
  intent: ArgentMultisigSigningIntent | null,
  id: string,
): Promise<
  | { readonly base: bigint; readonly request: MultisigStrk20ActionRequest }
  | { readonly error: string }
> => {
  if (intent && !REFRESHABLE.has(intent.state)) return { error: ARGENT_INTENT_ALREADY_SENT };
  const proof = intent ? await session.store.getProof(intent.id) : null;
  const relay = proof ? null : await session.store.getRelay(id);
  if (relay?.state === "submitted") return { error: ARGENT_INTENT_ALREADY_SENT };
  const held = proof ?? relay;
  const base = held ? strk20ProofBaseBlock(held.proof.proof_facts) : null;
  return held && base !== null ? { base, request: held.request } : MISSING;
};

/**
 * Re-proves an expired multisig STRK20 action, or reports it still fresh.
 * Refused for an intent or relay that may already have been sent: expiry
 * alone never repeats a private action. Messages carry ids, never proofs.
 */
export const refreshMultisigStrk20 = async (
  deps: MultisigOpsDeps,
  id: string,
): Promise<RuntimeResponse> => {
  const intent = await deps.multisigStore.getIntent(id);
  const accountId = intent?.accountId ?? id.slice(0, id.lastIndexOf(":"));
  const session = await openMultisigStrk20Session(deps, accountId);
  if ("error" in session) return session;
  const held = await heldProof(session, intent, id);
  if ("error" in held) return held;
  const window = await readMultisigStrk20Window(session.context.rpcUrls, session.poolAddress);
  if (strk20ProofSubmittable({ baseBlock: held.base, ...window })) {
    return { id, ok: true, phase: "fresh" };
  }
  const request = held.request;
  const retired = intent ? await retireIntent(deps, session, intent) : null;
  if (retired) return retired;
  return proveMultisigStrk20(deps, session, request, session.readScalar);
};

/**
 * Sends a ready relay through the paymaster under the relay maturity claim.
 * Only a `ready` relay is sent; a submitted one is refused before any
 * paymaster call, so a stale panel cannot repeat it.
 */
export const submitMultisigStrk20Relay = async (
  deps: MultisigOpsDeps,
  id: string,
): Promise<RuntimeResponse> => {
  const session = await openMultisigStrk20Session(deps, id.slice(0, id.lastIndexOf(":")));
  if ("error" in session) return session;
  const relay = await session.store.getRelay(id);
  if (!relay) return { error: "Argent multisig intent not found" };
  if (relay.state === "submitted") return { error: ARGENT_INTENT_ALREADY_SENT };
  if (relay.state !== "ready") return { error: "Argent multisig intent is not ready" };
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
