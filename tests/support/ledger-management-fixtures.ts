/**
 * Real-shaped Ledger management replies shared by transport tests. The Nano X
 * OS envelope mirrors Ledger's official Device SDK fixture: target id, secure
 * element version, flags, MCU-SEPH version, MCU bootloader version, hardware
 * revision, language, recovery state, and the final status word.
 */

/**
 * Encodes Ledger's GetAppAndVersion response envelope.
 */
export const ledgerAppStateResponse = (name: string, version = "2.4.0"): Uint8Array => {
  const nameBytes = new TextEncoder().encode(name);
  const versionBytes = new TextEncoder().encode(version);
  return Uint8Array.from([
    1,
    nameBytes.length,
    ...nameBytes,
    versionBytes.length,
    ...versionBytes,
    0,
    0x90,
    0x00,
  ]);
};

/**
 * Returns Ledger's complete Nano X GetOsVersion fixture, including the MCU and
 * all optional length-prefixed fields that precede the status word.
 */
export const ledgerNanoXOsResponse = (): Uint8Array =>
  Uint8Array.from([
    0x33,
    0x00,
    0x00,
    0x04,
    0x05,
    ...new TextEncoder().encode("2.2.3"),
    0x04,
    0xe6,
    0x00,
    0x00,
    0x00,
    0x04,
    ...new TextEncoder().encode("2.30"),
    0x04,
    ...new TextEncoder().encode("1.16"),
    0x01,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x90,
    0x00,
  ]);
