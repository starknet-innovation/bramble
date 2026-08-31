/**
 * The set of external-device sign queues the background may hold, and the two
 * operations that must cover every one of them. Both exist so adding a device
 * kind is a single edit here rather than a hunt through the approval and lock
 * paths: a queue missed at {@link rejectAllDeviceSigns} would let a request
 * parked before an explicit lock settle and broadcast after it, and a queue
 * missed at {@link deviceSignQueues} would make that device's accounts fail
 * closed in one submitting path while working in another.
 */
import type { MlDsaCalldata } from "@mc-wallet/starknet/provider";
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import type { MobilePqEnrollment } from "./mobile-pq-enrollment";
import type { MlDsaVerifier, MobilePqSignQueue } from "./mobile-pq-signer";

/**
 * Device queues, each optional so partial test stubs and deployments without a
 * given device stay valid. An account whose queue is absent fails closed at the
 * signer seam rather than falling through to the vault.
 */
export type DeviceSignQueues = {
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly mobilePqSignQueue?: MobilePqSignQueue;
};

/**
 * Device collaborators beyond the sign queues. Enrollment is separate because it
 * runs once per device rather than once per signature, and it holds a challenge
 * rather than a parked request.
 */
export type DeviceEnrollment = {
  readonly mobilePqEnrollment?: MobilePqEnrollment;
  /**
   * ML-DSA verification and calldata, from Krusty KMS. Optional like the queues
   * above and for the same reason: a build or a test that never reaches a paired
   * phone should not have to supply it, and the paths that need it refuse rather
   * than fall back — an ML-DSA account cannot be signed for or priced without it.
   */
  readonly mlDsa?: MlDsaDeviceCrypto;
};

/**
 * The ML-DSA operations the background needs. `KmsPort` satisfies this shape, so
 * the wallet's one crypto boundary is what gets passed in.
 */
export type MlDsaDeviceCrypto = MlDsaCalldata & {
  readonly mlDsaVerify: MlDsaVerifier;
};

/**
 * Projects whichever device queues a caller holds, omitting absent ones so the
 * result stays assignable under `exactOptionalPropertyTypes`. Carries no secret
 * material: a queue is a coordination handle, not a key.
 */
export const deviceSignQueues = (source: DeviceSignQueues): DeviceSignQueues => ({
  ...(source.ledgerSignQueue ? { ledgerSignQueue: source.ledgerSignQueue } : {}),
  ...(source.mobilePqSignQueue ? { mobilePqSignQueue: source.mobilePqSignQueue } : {}),
});

/**
 * Rejects every parked device sign across every queue and returns how many were
 * rejected. Used on an explicit `wallet.lock` so no device round-trip that
 * started before the lock can complete after it. Fails closed.
 */
export const rejectAllDeviceSigns = (source: DeviceSignQueues, reason: string): number =>
  (source.ledgerSignQueue?.rejectAll(reason) ?? 0) +
  (source.mobilePqSignQueue?.rejectAll(reason) ?? 0);
