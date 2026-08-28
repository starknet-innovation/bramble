/** Local activity association for the account's signed public privacy score. */
import type { PrivacyScoreState } from "@mc-wallet/privacy/score-types";
import type { ActivePrivacyContext, Strk20WalletOpsDeps } from "./strk20-op-context";

/**
 * Reads public transaction hashes from this account's local activity only.
 * The scoring service then downloads the same static artifact as every other
 * wallet; no account identifier, address, hash, or viewing key is transmitted.
 */
export const privacyScoreForState = async (
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
