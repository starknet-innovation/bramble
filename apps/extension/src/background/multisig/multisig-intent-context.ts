/** Fresh-chain resolution for frozen Argent multisig signing intents. */
import type { ArgentMultisigConfig } from "@bramble/multisig/chain";
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import { activeAccountContext, networkRpcUrls } from "../runtime/runtime-state";
import { matchesArgentPublicConfig, storedArgentPublicConfig } from "./multisig-config-reconcile";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-deps";
import { recoverStaleArgentIntent } from "./multisig-operation-recovery";
import { type ArgentMultisigContext, currentChainConfigFor } from "./multisig-ops";
import { ARGENT_INTENT_ALREADY_SENT, refuseResendOfStaleIntent } from "./multisig-stale-intents";

const contextForIntent = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
): Promise<ArgentMultisigContext | { readonly error: string }> => {
  const active = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (active.error !== undefined) return active;
  const record = (await deps.multisigStore.listMultisigs()).find(
    (candidate) => candidate.id === intent.accountId,
  );
  if (!record) return { error: "Argent multisig not found" };
  if (record.networkId !== active.networkId) {
    return { error: "switch to the multisig network first" };
  }
  const preferences = await deps.preferencesStore.read();
  return {
    active,
    record,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences),
  };
};

const sameConfig = (
  left: ArgentMultisigSigningIntent["configSnapshot"],
  right: ArgentMultisigConfig,
): boolean =>
  left.classHash === right.classHash &&
  left.threshold === right.threshold &&
  left.signerGuids.length === right.signerGuids.length &&
  left.signerGuids.every((guid, index) => guid === right.signerGuids[index]);

const NONCE_NOT_CURRENT = "Argent multisig intent nonce is no longer current";

// A used nonce may have been used by this very transaction, sent by a
// co-signer holding the same signed package (Sherlock 177), so the signed hash
// is looked up before the intent is left stale.
const nonceMismatch = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  nonce: string,
  markStale: boolean,
): Promise<string> => {
  if (!markStale) return NONCE_NOT_CURRENT;
  const stale: ArgentMultisigSigningIntent = { ...intent, state: "stale" };
  await deps.multisigStore.upsertIntent(stale);
  if (BigInt(nonce) <= BigInt(intent.prepared.nonce)) return NONCE_NOT_CURRENT;
  return (await recoverStaleArgentIntent(deps, stale)).kind === "submitted"
    ? ARGENT_INTENT_ALREADY_SENT
    : NONCE_NOT_CURRENT;
};

/**
 * Re-resolves current account authority and nonce; stale intent authority is
 * refused and, for local operations, durably marked stale without signing.
 */
export const currentArgentIntentContext = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  markStale = true,
): Promise<
  | {
      readonly config: ArgentMultisigConfig;
      readonly context: ArgentMultisigContext;
      readonly publicConfig: ReturnType<typeof storedArgentPublicConfig>;
    }
  | { readonly error: string }
> => {
  const context = await contextForIntent(deps, intent);
  if ("error" in context) return context;
  try {
    const config = await currentChainConfigFor(deps, context);
    if (!sameConfig(intent.configSnapshot, config)) {
      if (markStale) await deps.multisigStore.upsertIntent({ ...intent, state: "stale" });
      return { error: "Argent multisig intent is stale after a configuration change" };
    }
    const nonce = await multisigRpc(deps).getNonce({
      address: context.record.address,
      rpcUrls: context.rpcUrls,
    });
    if (!sameFelt(nonce, intent.prepared.nonce)) {
      return { error: await nonceMismatch(deps, intent, nonce, markStale) };
    }
    // An earlier stale version of these calls may have landed since this one
    // was prepared; signing or sending this one too would pay twice.
    const resent = markStale
      ? await refuseResendOfStaleIntent(deps, intent.accountId, intent.prepared.calls)
      : null;
    if (resent) return resent;
    const stored = storedArgentPublicConfig(context.record);
    return {
      config,
      context,
      publicConfig: stored && matchesArgentPublicConfig(stored, config) ? stored : null,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Argent multisig config unavailable" };
  }
};
