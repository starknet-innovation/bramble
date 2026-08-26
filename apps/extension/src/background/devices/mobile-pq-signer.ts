/**
 * Background-side adapter for a paired post-quantum phone. The account holds no
 * vault key (the ML-DSA key is generated inside device hardware and never
 * leaves), so the background hands the hash to the side panel that owns the
 * transport, the phone authenticates the user and signs, and the encoded
 * signature comes back. This wraps that round-trip in the mandatory
 * verify-before-broadcast gate: the returned signature is checked against the
 * account's enrolled public key for the exact hash handed out, and any mismatch
 * throws so nothing is submitted. The gate is a public-key check, not signing,
 * so it does not weaken "Krusty owns wallet crypto".
 *
 * The phone blind-signs at this milestone: it is handed a hash and cannot yet
 * recompute it, so it cannot tell the user what they are approving. Handing it
 * the full transaction instead requires the transaction-hash functions in the
 * krusty-kms C ABI, and the trusted display arrives with them.
 */
import { WalletError } from "@mc-wallet/core/errors";
import { verifyMlDsa65Signature } from "@mc-wallet/starknet/ml-dsa-verify";
import type { StarkHashSigner } from "@mc-wallet/starknet/provider";
import type { MobilePqAccountRef } from "@mc-wallet/wallet-model/accounts";
import {
  createDeviceSignQueue,
  type DeviceSignQueue,
  type DeviceSignQueueTimeout,
} from "./device-sign-queue";

/**
 * A request to sign one hash on a paired phone. Carries no secret material:
 * `publicKey` is the account's enrolled ML-DSA public key, threaded so the panel
 * can reject a wrong or re-installed device (a mismatch against the key the app
 * reports for `deviceId`) before the biometric prompt — the background verify
 * gate remains the fund-safety check.
 */
export type MobilePqSignRequest = {
  readonly accountId: string;
  readonly deviceId: string;
  readonly messageHash: string;
  readonly publicKey: string;
};

/**
 * The encoded ML-DSA-65 signature a phone returns, as lowercase hex. Untrusted
 * until the verify gate below accepts it.
 */
export type MobilePqDeviceSignature = {
  readonly signature: string;
};

/**
 * Injected bounded timeout for a parked phone request.
 */
export type MobilePqSignQueueTimeout = DeviceSignQueueTimeout;

/**
 * Coordinates background sign requests with the panel that reaches the phone.
 */
export type MobilePqSignQueue = DeviceSignQueue<MobilePqSignRequest, MobilePqDeviceSignature>;

/**
 * Drives the panel/phone round-trip for one hash and resolves the encoded
 * signature. Injected so the background never touches the transport directly and
 * tests can supply a fake device signer with no phone.
 */
export type MobilePqHashSigner = (request: MobilePqSignRequest) => Promise<MobilePqDeviceSignature>;

/**
 * Creates the phone sign queue. Arguments carry the meanings documented on
 * {@link createDeviceSignQueue}.
 */
export const createMobilePqSignQueue = (
  onRequest?: () => void,
  timeout?: MobilePqSignQueueTimeout,
  currentGeneration?: () => number | null,
): MobilePqSignQueue =>
  createDeviceSignQueue<MobilePqSignRequest, MobilePqDeviceSignature>(
    "mobile-pq-sign",
    onRequest,
    timeout,
    currentGeneration,
  );

/**
 * Builds a {@link StarkHashSigner} for a paired-phone account. It hands the hash
 * to the phone via `sign`, verifies the returned signature against the account's
 * enrolled public key, and throws `WalletError` on any mismatch before
 * returning — so every submitting path that uses this signer fails closed rather
 * than broadcasting an unverified signature.
 */
export const mobilePqHashSigner =
  (account: MobilePqAccountRef, sign: MobilePqHashSigner): StarkHashSigner =>
  async (messageHash) => {
    const { signature } = await sign({
      accountId: account.id,
      deviceId: account.derivation.deviceId,
      messageHash,
      publicKey: account.publicKey,
    });
    if (!verifyMlDsa65Signature({ hash: messageHash, publicKey: account.publicKey, signature })) {
      throw new WalletError("Mobile signature verification failed");
    }
    return { kind: "ml-dsa-65", publicKey: account.publicKey, signature };
  };
