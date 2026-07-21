/**
 * Thin logic layer over the `@ledgerhq/hw-app-starknet` `StarknetClient`. The
 * device client is injected (a structural interface), so this module holds no
 * transport and is exercised without hardware: it enforces the pinned minimum
 * app version, reads a public key silently for enumeration, drives a blind-sign,
 * and maps every device return code and thrown transport error to the typed
 * {@link LedgerRejection} catalog. Fails closed — an unrecognized status becomes
 * `unexpected-device-error`, never a raw error.
 */
import type { DeviceSignature } from "../../starknet/ledger-verify";
import { LedgerRejection, type LedgerRejectionCode } from "./errors";

// Minimal structural mirrors of the `@ledgerhq/hw-app-starknet` `Response*`
// shapes this flow actually reads. Declared locally on purpose: importing the
// package's types would pull its `@ledgerhq/hw-transport` declaration into the
// type-checked program, and that vendored `.d.ts` does not compile under this
// repo's pinned `skipLibCheck: false` / `types: ["bun-types"]` toolchain. The
// concrete `StarknetClient` is confined to the runtime-only WebHID boundary
// (`webhid-impl.js`); every typed field below matches the real response, so the
// real client is structurally assignable to {@link LedgerDeviceClient}.
type DeviceResponseBase = { readonly errorMessage: string; readonly returnCode: number };
type DeviceVersionResponse = DeviceResponseBase & {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};
type DevicePublicKeyResponse = DeviceResponseBase & { readonly publicKey: Uint8Array };
type DeviceHashSignResponse = DeviceResponseBase & {
  readonly r: Uint8Array;
  readonly s: Uint8Array;
};

/**
 * The subset of the Ledger `StarknetClient` this wallet uses. Structural so a
 * test can supply a fake with no transport, and so v1 (blind-sign via
 * `signHash`) does not depend on the clear-sign surface.
 */
export type LedgerDeviceClient = {
  getAppVersion(): Promise<DeviceVersionResponse>;
  getPubKey(path: string, show?: boolean): Promise<DevicePublicKeyResponse>;
  signHash(path: string, hash: string): Promise<DeviceHashSignResponse>;
};

/**
 * A three-part device app version.
 */
export type LedgerAppVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

/**
 * Pinned MINIMUM Starknet app version mc-wallet has verified signs correctly.
 * "Current" means at or above this floor, never "exactly the latest" (an
 * extension cannot see Ledger's release catalog). Bump only after verifying a
 * newer app. NOTE: the exact floor still needs hardware verification and the
 * owner's sign-off (v4 open decision) — this is a conservative placeholder.
 */
export const MC_LEDGER_STARKNET_APP_MIN: LedgerAppVersion = { major: 2, minor: 0, patch: 0 };

// APDU status words from the Ledger Starknet app (@ledgerhq/hw-app-starknet
// LedgerError). Kept as local constants so this module needs no runtime import
// from the ledger package (type-only imports above keep tests light).
const STATUS_OK = 0x9000;
const STATUS_USER_REJECTED = 0x6e04;

const toHex = (bytes: Uint8Array): string => {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
};

// Canonicalizes raw big-endian bytes to a `0x` felt with no leading zeros, the
// same form Krusty and starknet.js produce, so a stored key compares cleanly.
const feltFromBytes = (bytes: Uint8Array): string =>
  `0x${BigInt(`0x${toHex(bytes)}`).toString(16)}`;

// The device returns a 65-byte uncompressed public key (0x04 ‖ X ‖ Y); the OZ
// account address is derived from X, so only X is kept.
const publicKeyXOf = (publicKey: Uint8Array): string => feltFromBytes(publicKey.slice(1, 33));

// Best-effort classification of a non-OK device return code. Blind-signing being
// disabled is reported by the app when a signHash is refused by that setting;
// its exact status word varies by app build, so the error message is also
// checked. UNVERIFIED against hardware (v4 wired-but-untested).
const classifyDeviceStatus = (returnCode: number, errorMessage: string): LedgerRejection => {
  if (returnCode === STATUS_USER_REJECTED) {
    return new LedgerRejection("rejected-on-device", returnCode);
  }
  if (/blind/i.test(errorMessage)) {
    return new LedgerRejection("blind-signing-disabled", returnCode);
  }
  return new LedgerRejection("unexpected-device-error", returnCode);
};

// Maps a thrown transport error to a rejection by its class name/message
// signature (DisconnectedDevice, LockedDeviceError, a claimed device, …).
// UNVERIFIED against hardware; the default is unexpected-device-error.
const THROWN_SIGNATURES: readonly (readonly [RegExp, LedgerRejectionCode])[] = [
  [/locked/i, "device-locked"],
  [/disconnect/i, "disconnected-mid-sign"],
  [/already open|in use|claimed|busy/i, "device-busy"],
];

const mapThrown = (error: unknown): LedgerRejection => {
  if (error instanceof LedgerRejection) {
    return error;
  }
  const text = error instanceof Error ? `${error.name} ${error.message}` : "";
  const match = THROWN_SIGNATURES.find(([pattern]) => pattern.test(text));
  return new LedgerRejection(match ? match[1] : "unexpected-device-error");
};

const runDevice = async <T>(op: () => Promise<T>): Promise<T> => {
  try {
    return await op();
  } catch (error) {
    throw mapThrown(error);
  }
};

const requireOk = (response: {
  readonly errorMessage: string;
  readonly returnCode: number;
}): void => {
  if (response.returnCode !== STATUS_OK) {
    throw classifyDeviceStatus(response.returnCode, response.errorMessage);
  }
};

const meetsMinimum = (version: LedgerAppVersion, min: LedgerAppVersion): boolean =>
  version.major !== min.major
    ? version.major > min.major
    : version.minor !== min.minor
      ? version.minor > min.minor
      : version.patch >= min.patch;

/**
 * Reads the device Starknet app version, mapping device/transport failures.
 */
export const ledgerAppVersion = async (client: LedgerDeviceClient): Promise<LedgerAppVersion> => {
  const response = await runDevice(() => client.getAppVersion());
  requireOk(response);
  return { major: response.major, minor: response.minor, patch: response.patch };
};

/**
 * Reads the app version and rejects with `app-below-minimum` when the device is
 * below {@link MC_LEDGER_STARKNET_APP_MIN}. Returns the version on success.
 */
export const assertLedgerAppReady = async (
  client: LedgerDeviceClient,
): Promise<LedgerAppVersion> => {
  const version = await ledgerAppVersion(client);
  if (!meetsMinimum(version, MC_LEDGER_STARKNET_APP_MIN)) {
    throw new LedgerRejection("app-below-minimum");
  }
  return version;
};

/**
 * Reads the public-key x-coordinate at a derivation path SILENTLY (no on-device
 * button press), for multi-index enumeration. Returns a canonical `0x` felt.
 */
export const ledgerPublicKeyX = async (
  client: LedgerDeviceClient,
  path: string,
): Promise<string> => {
  const response = await runDevice(() => client.getPubKey(path, false));
  requireOk(response);
  return publicKeyXOf(response.publicKey);
};

/**
 * Blind-signs a hash on the device at a path and returns the raw `(r, s)`.
 * Maps a blind-signing-disabled refusal, a user rejection, and transport
 * failures to typed rejections; the caller verifies `(r, s)` host-side.
 */
export const ledgerSignHashOnDevice = async (
  client: LedgerDeviceClient,
  path: string,
  hash: string,
): Promise<DeviceSignature> => {
  const response = await runDevice(() => client.signHash(path, hash));
  requireOk(response);
  return { r: feltFromBytes(response.r), s: feltFromBytes(response.s) };
};
