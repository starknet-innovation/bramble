/**
 * Submits a frozen multisig intent, attaching the local proof when the hash
 * commits to proof facts. An expired proof is marked stale and not sent.
 */

import { WalletError } from "@bramble/core/errors";
import {
  type ArgentMultisigSigningIntent,
  staleArgentMultisigIntent,
} from "@bramble/multisig/repository";
import {
  strk20ProofBaseBlock,
  strk20ProofSubmittable,
} from "@bramble/privacy/multisig-proof-window";
import { canonicalFelt, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { Strk20Proof } from "@bramble/wallet-protocol/strk20";
import type { MultisigOpsDeps } from "./multisig-deps";
import { MULTISIG_STRK20_PROOF_EXPIRED, readMultisigStrk20Window } from "./multisig-strk20-session";

const freshProof = async (
  deps: MultisigOpsDeps,
  input: {
    readonly intent: ArgentMultisigSigningIntent;
    readonly isAuthorized: () => boolean;
    readonly networkId: StarknetNetworkId;
    readonly rpcUrls: readonly string[];
  },
) => {
  const facts = input.intent.prepared.proofFacts;
  if (!facts || facts.length === 0) return null;
  const proofRecord = await deps.strk20MultisigStore?.getProof(input.intent.id);
  if (!proofRecord) throw new WalletError("Argent multisig private proof is missing");
  const preferences = await deps.preferencesStore.read();
  const pool = canonicalFelt(preferences.strk20Networks?.[input.networkId]?.poolAddress ?? "");
  const base = strk20ProofBaseBlock(proofRecord.proof.proof_facts);
  if (!pool || base === null) throw new WalletError("Invalid Argent multisig private proof");
  const window = await readMultisigStrk20Window(input.rpcUrls, pool);
  if (!strk20ProofSubmittable({ baseBlock: base, ...window })) {
    await deps.multisigStore.upsertIntent(
      staleArgentMultisigIntent(input.intent, "proof"),
      input.isAuthorized,
    );
    throw new WalletError(MULTISIG_STRK20_PROOF_EXPIRED);
  }
  return proofRecord;
};

/**
 * Proof bytes for a ready intent, or undefined when the intent is public.
 * Missing or expired bytes throw. The caller broadcasts and records allowances.
 */
export const multisigStrk20SubmitProof = async (
  deps: MultisigOpsDeps,
  input: {
    readonly intent: ArgentMultisigSigningIntent;
    readonly isAuthorized: () => boolean;
    readonly networkId: StarknetNetworkId;
    readonly rpcUrls: readonly string[];
  },
): Promise<Strk20Proof | undefined> => {
  const record = await freshProof(deps, input);
  return record?.proof;
};
