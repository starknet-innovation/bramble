/**
 * Grants the multisig the user is presenting, when the connect card named it.
 * Returns null when a single-signer account is the one being shared.
 */

import type { WalletPreferences } from "@bramble/settings/preferences";
import { toDappMultisigAccount } from "../provider/dapp-account";
import type { ApplyResult } from "./approval-applier";
import { reject } from "./approval-applier";
import type { ApprovalDecisionDeps } from "./approval-decision-deps";

const ACCOUNT_CHANGED = "the account changed since this request was reviewed";

const presentedId = (preferences: WalletPreferences): string | null =>
  preferences.selectedMultisigId?.startsWith(`${preferences.activeNetworkId}:`)
    ? preferences.selectedMultisigId
    : null;

/**
 * Grants `origin` the presented multisig. Null when no multisig is presented.
 * A card that named a different account is refused.
 */
export const grantPresentedMultisig = async (
  deps: Pick<ApprovalDecisionDeps, "multisigGrants" | "multisigStore" | "preferencesStore">,
  origin: string,
  reviewedAccountId: string | undefined,
  credential: string,
  isAuthorized: () => boolean,
): Promise<ApplyResult | null> => {
  const selectedId = presentedId(await deps.preferencesStore.read());
  if (!selectedId) return null;
  if (!isAuthorized()) return reject({ error: "wallet locked" });
  if (reviewedAccountId !== selectedId) return reject({ error: ACCOUNT_CHANGED });
  const record = (await deps.multisigStore?.listMultisigs())?.find(
    (item) => item.id === selectedId,
  );
  if (!record || !deps.multisigGrants) return reject({ error: "Argent multisig not found" });
  await deps.multisigGrants.grant({
    credential,
    isAuthorized,
    multisigId: record.id,
    origin,
  });
  const accounts = [toDappMultisigAccount(record)];
  return {
    respond: () => ({ accounts, ok: true }),
    settle: { accounts, ok: true },
    status: "settle",
  };
};
