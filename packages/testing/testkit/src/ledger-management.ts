/**
 * Real-shaped Ledger management replies shared by transport tests. The Nano X
 * OS envelope mirrors Ledger's official Device SDK fixture: target id, secure
 * element version, flags, MCU-SEPH version, MCU bootloader version, hardware
 * revision, language, recovery state, and the final status word.
 */

/**
 * Encodes Ledger's GetAppAndVersion response envelope: format byte, app name,
 * app version, then a flags field.
 *
 * `trailingFields` appends further length-prefixed fields after flags, the way
 * firmware newer than a given build may. Only the leading name/version are
 * load-bearing, so a parser must tolerate them — a fixture that could only emit
 * the minimal envelope is what let an exact-end-of-envelope check ship and fail
 * on hardware while every test passed.
 */
export const ledgerAppStateResponse = (
  name: string,
  version = "2.4.0",
  trailingFields: readonly (readonly number[])[] = [],
): Uint8Array => {
  const nameBytes = new TextEncoder().encode(name);
  const versionBytes = new TextEncoder().encode(version);
  return Uint8Array.from([
    1,
    nameBytes.length,
    ...nameBytes,
    versionBytes.length,
    ...versionBytes,
    0,
    ...trailingFields.flatMap((field) => [field.length, ...field]),
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
