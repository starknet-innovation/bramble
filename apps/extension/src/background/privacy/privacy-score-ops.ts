/** Local activity association for the account's signed public privacy score. */
import type { PrivacyScoreState } from "@mc-wallet/privacy/score-types";
import { readTypeOnlyInput } from "../routing/message-inputs";
import { observedAccountContext } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import {
  type ActivePrivacyContext,
  resolvePrivacyContext,
  type Strk20WalletOpsDeps,
} from "./strk20-op-context";

/**
 * Reads public transaction hashes from this account's local activity only.
 * The scoring service then downloads the same static artifact as every other
 * wallet; no account identifier, address, hash, or viewing key is transmitted.
 */
const privacyScoreForState = async (
  deps: Strk20WalletOpsDeps,
  context: ActivePrivacyContext,
): Promise<PrivacyScoreState> => {
  if (!deps.privacyScores) {
    return { status: "unavailable" };
  }
  try {
    const account = context.accountContext.account;
    const entries = await deps.activity.list();
    const transactions = entries.flatMap((entry) => {
      if (
        entry.accountId !== account.id ||
        entry.networkId !== account.networkId ||
        entry.status === "rejected" ||
        entry.status === "reverted" ||
        (entry.privacyWithdrawal !== true && !entry.summary.startsWith("Unshield "))
      ) {
        return [];
      }
      return [
        {
          hash: entry.hash,
        },
      ];
    });
    return deps.privacyScores.score({
      accountId: account.id,
      networkId: account.networkId,
      poolAddress: context.accountContext.config?.poolAddress ?? "0x0",
      transactions,
    });
  } catch {
    return { status: "unavailable" };
  }
};

/**
 * Handles the optional score request separately from private balances. The
 * account/network scope is returned with the score so a late response cannot
 * be painted after the user switches accounts.
 */
export const handlePrivacyScoreOps = async (
  deps: Strk20WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType !== "wallet.strk20PrivacyScore") {
    return null;
  }
  if (!readTypeOnlyInput(message, messageType)) {
    return { error: "Invalid privacy score request" };
  }
  const context = await resolvePrivacyContext(deps, {
    active: await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore),
  });
  if ("error" in context) {
    return { error: context.error };
  }
  return {
    ok: true,
    strk20PrivacyScore: {
      accountId: context.accountContext.account.id,
      networkId: context.accountContext.account.networkId,
      score: await privacyScoreForState(deps, context),
    },
  };
};
