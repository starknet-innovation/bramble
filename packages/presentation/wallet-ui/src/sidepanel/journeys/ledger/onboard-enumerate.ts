/**
 * Silent public-key enumeration for Ledger onboarding, split from
 * onboard-session.ts on the size budget. Reads only public keys the device
 * already holds, at a path rebuilt from its index and scheme (one source of
 * truth with sign-time); no secrets, no key derivation.
 */

import {
  assertLedgerDeviceReady,
  type LedgerDeviceClient,
  ledgerPublicKeyX,
} from "@bramble/ledger-protocol/client";
import type { LedgerDeviceSession } from "@bramble/ledger-protocol/session";
import type { LedgerPubKeyEntry } from "@bramble/wallet-model/accounts";
import {
  LEDGER_EIP2645_APPLICATION,
  type LedgerEip2645Application,
  ledgerAccountPath,
  MAX_LEDGER_ACCOUNT_BATCH,
} from "@bramble/wallet-model/ledger-path";

/**
 * Number of account indices read per enumeration page (a page is `start` …
 * `start + LEDGER_PAGE_SIZE - 1`). The device app only needs to be open and
 * unlocked; every read is silent (no per-index on-device button press).
 */
export const LEDGER_PAGE_SIZE = MAX_LEDGER_ACCOUNT_BATCH;

/**
 * Checks the pinned device OS and Starknet app releases unless this exact live
 * session was already verified by the grant broker, then reads the public-key
 * x-coordinate for one page of account indices — `startIndex … startIndex +
 * count - 1` — SILENTLY and one round-trip at a time (the browser transport is
 * a serial pipe), at the given EIP-2645 path scheme (Bramble's `LedgerW` unless
 * told otherwise; Ready's `argentx` yields a different key per index). Returns
 * the enumerated `(index, publicKeyX)` pairs for the onboarding controller
 * to derive into candidates. Any device/transport failure propagates as a typed
 * {@link LedgerRejection} so the caller aborts cleanly.
 */
export const enumerateLedgerPubKeys = async (
  client: LedgerDeviceClient,
  startIndex = 0,
  count: number = LEDGER_PAGE_SIZE,
  readiness?: LedgerDeviceSession["readiness"],
  application: LedgerEip2645Application = LEDGER_EIP2645_APPLICATION,
): Promise<readonly LedgerPubKeyEntry[]> => {
  if (readiness !== "verified") {
    await assertLedgerDeviceReady(client);
  }
  const entries: LedgerPubKeyEntry[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const accountIndex = startIndex + offset;
    const publicKeyX = await ledgerPublicKeyX(client, ledgerAccountPath(accountIndex, application));
    entries.push({ accountIndex, publicKeyX });
  }
  return entries;
};
