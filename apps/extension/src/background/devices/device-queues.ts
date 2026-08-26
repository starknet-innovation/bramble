/**
 * The set of external-device sign queues the background may hold, and the two
 * operations that must cover every one of them. Both exist so adding a device
 * kind is a single edit here rather than a hunt through the approval and lock
 * paths: a queue missed at {@link rejectAllDeviceSigns} would let a request
 * parked before an explicit lock settle and broadcast after it, and a queue
 * missed at {@link deviceSignQueues} would make that device's accounts fail
 * closed in one submitting path while working in another.
 */
import type { LedgerSignQueue } from "../ledger/ledger-sign-queue";
import type { MobilePqSignQueue } from "./mobile-pq-signer";

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
