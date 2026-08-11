/**
 * Connected-sites permission operations dispatched from the background message
 * handler: listing the origins with persisted grants and revoking one. Both
 * are privileged and require an unlocked session.
 */
import { connectedSitesFromVault } from "@mc-wallet/vault/origin-grants";
import { readRevokeOriginInput, readTypeOnlyInput } from "../routing/message-inputs";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { UnlockSession } from "../runtime/session";
import type { WalletStatusReader } from "../accounts/wallet-reader";

/**
 * Dependencies shared by the connected-sites handlers.
 */
export type OriginOpsDeps = {
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

/**
 * Handles connected-sites messages; returns null for other message types so
 * the dispatcher can keep trying later handlers.
 */
export const handleOriginOps = async (
  deps: OriginOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.connectedSites") {
    if (!readTypeOnlyInput(message, "wallet.connectedSites")) {
      return { error: "invalid connected sites request" };
    }
    // Peek, never renew: the panel re-reads this list on its ambient cadence.
    const passphrase = deps.session.peekPassphrase();
    if (!passphrase) {
      return { error: "wallet locked" };
    }
    const vault = await deps.wallet.readVault(passphrase);
    return { ok: true, sites: connectedSitesFromVault(vault) };
  }

  if (messageType === "wallet.revokeOrigin") {
    const input = readRevokeOriginInput(message);
    if (!input) {
      return { error: "invalid revoke origin request" };
    }
    const passphrase = deps.session.getPassphrase();
    if (!passphrase) {
      return { error: "wallet locked" };
    }
    if (!deps.wallet.revokeOrigin) {
      return { error: "wallet unavailable" };
    }
    const sites = await deps.wallet.revokeOrigin({
      origin: input.origin,
      vaultPassphrase: passphrase,
    });
    return { ok: true, sites };
  }

  return null;
};
