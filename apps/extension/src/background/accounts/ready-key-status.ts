/**
 * The Home notice's verdict on whether the active Ready account holds a key
 * from Krusty's pre-3.0 Argent legacy derivation. Same privileged boundary and
 * passive session reads as the signability flag.
 */
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { readTypeOnlyInput } from "../routing/message-inputs";
import { observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { UnlockSession } from "../runtime/session";
import type { WalletStatusReader } from "./wallet-reader";

type ReadyKeyStatusDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Answers `{ accountId, ok, preFixKey }` for the active account; never a key.
 * Advisory: a non-Ready account, a missing vault method, or a Krusty failure
 * answers `preFixKey: false` rather than alarming, since the vault keeps
 * signing with the stored key either way. Reads the passphrase through the
 * non-renewing session, so panel polling cannot hold the wallet unlocked.
 */
export const handleReadyKeyStatus = async (
  deps: ReadyKeyStatusDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  if (!readTypeOnlyInput(message, "wallet.readyKeyStatus")) {
    return { error: "invalid Ready key status request" };
  }
  const context = await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const { account, vaultPassphrase } = context;
  if (account.derivation.kind !== "argentx-bip44" || deps.wallet.hasPreFixReadyKey === undefined) {
    return { accountId: account.id, ok: true, preFixKey: false };
  }
  const preFixKey = await deps.wallet
    .hasPreFixReadyKey({ accountId: account.id, vaultPassphrase })
    .catch(() => false);
  return { accountId: account.id, ok: true, preFixKey };
};
