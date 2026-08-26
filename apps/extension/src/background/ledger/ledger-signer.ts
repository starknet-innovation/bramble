/**
 * Background-side Ledger signing adapter. A keyless Ledger account cannot be
 * signed by the vault (it holds no key), so the background hands the hash to the
 * side panel that owns the browser transport, the device blind-signs it, and the
 * raw `(r, s)` comes back. This wraps that round-trip in the mandatory
 * verify-before-broadcast gate: the returned signature is checked against the
 * account's stored `publicKeyX` for the exact hash handed out, and any mismatch
 * throws so nothing is submitted. The gate is a public-key check, not signing,
 * so it does not weaken "Krusty owns wallet crypto".
 */
import { WalletError } from "@mc-wallet/core/errors";
import type { StarkHashSigner } from "@mc-wallet/starknet/provider";
import { verifyStarkSignature } from "@mc-wallet/transactions/ledger-verify";
import type { LedgerAccountRef } from "@mc-wallet/wallet-model/accounts";
import type { DeviceSignature } from "@mc-wallet/wallet-model/signing";

/**
 * A request to sign one hash on a Ledger device at a specific account and its
 * stored derivation path. Carries no secret material: `publicKeyX` is the
 * account's PUBLIC x-coordinate, threaded so the panel can reject a wrong device
 * (a mismatch against the key the device reports at `path`) up front, before the
 * on-device confirm — the background verify gate remains the fund-safety check.
 */
export type LedgerSignRequest = {
  readonly accountId: string;
  readonly messageHash: string;
  readonly path: string;
  readonly publicKeyX: string;
};

/**
 * Drives the panel/device round-trip for one hash and resolves the raw device
 * `(r, s)`. Injected so the background never touches the transport directly and
 * tests can supply a fake device signer with no hardware.
 */
export type LedgerHashSigner = (request: LedgerSignRequest) => Promise<DeviceSignature>;

/**
 * Builds a {@link StarkHashSigner} for a keyless Ledger account. It hands the
 * hash to the device via `sign`, verifies the returned `(r, s)` against the
 * account's stored `publicKeyX`, and throws `WalletError` on any mismatch before
 * returning — so every submitting path that uses this signer fails closed rather
 * than broadcasting an unverified signature.
 */
export const ledgerStarkHashSigner =
  (account: LedgerAccountRef, sign: LedgerHashSigner): StarkHashSigner =>
  async (messageHash) => {
    const signature = await sign({
      accountId: account.id,
      messageHash,
      path: account.derivation.path,
      publicKeyX: account.publicKeyX,
    });
    if (!verifyStarkSignature({ hash: messageHash, publicKeyX: account.publicKeyX, signature })) {
      throw new WalletError("Ledger signature verification failed");
    }
    return { kind: "stark", publicKey: account.publicKeyX, r: signature.r, s: signature.s };
  };
