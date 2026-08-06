/**
 * Thin logic layer over the `@ledgerhq/hw-app-starknet` `StarknetClient`. The
 * device client is injected (a structural interface), so this module holds no
 * transport and is exercised without hardware: it enforces the pinned minimum
 * app version, reads a public key silently for enumeration, drives a blind-sign,
 * and maps every device return code and thrown transport error to the typed
 * {@link LedgerRejection} catalog. Fails closed — an unrecognized status becomes
 * `unexpected-device-error`, never a raw error.
 *
 * Classification is grounded in how the real `@ledgerhq/hw-app-starknet` behaves,
 * not in assumptions: `getAppVersion` lets a thrown transport error propagate
 * (so a locked/disconnected/busy device is caught via {@link mapThrown} on the
 * version read), while `getPubKey`/`signHash` catch every thrown transport error
 * internally and report it as an `ExecutionError` (0x6f00) return code — and
 * their `sendApdu` only passes NoError/BadCla/BadIns/InvalidP1P2/UserRejected, so
 * any other status word (e.g. the conditions-not-satisfied the Starknet app
 * returns when blind signing is disabled) also surfaces as `ExecutionError`.
 * Sign-path classification therefore keys off that return code, not a message.
 */
import type { DeviceSignature } from "../../starknet/ledger-verify";
import { LedgerRejection, type LedgerRejectionCode } from "./errors";

// Minimal structural mirrors of the `@ledgerhq/hw-app-starknet` `Response*`
// shapes this flow actually reads. Declared locally on purpose: importing the
// package's types would pull its `@ledgerhq/hw-transport` declaration into the
// type-checked program, and that vendored `.d.ts` does not compile under this
// repo's pinned `skipLibCheck: false` / `types: ["bun-types"]` toolchain. The
// concrete `StarknetClient` is confined to the runtime-only browser transport boundary
// (`webhid-impl.js`); every typed field below matches the real response, so the
// real client is structurally assignable to {@link LedgerDeviceClient}.
type DeviceResponseBase = { readonly errorMessage: string; readonly returnCode: number };
type DeviceVersionResponse = DeviceResponseBase & {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};
type DeviceOsVersionResponse = {
  readonly targetId: number;
  readonly version: string;
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
  /**
   * Reads the device OS version through Ledger's built-in management APDU. The
   * runtime transport parses the raw reply before it reaches this typed
   * boundary; callers must still treat the model and version as untrusted.
   */
  getOsVersion(): Promise<DeviceOsVersionResponse>;
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
 * Ledger models whose current firmware line mc-wallet supports. The model is
 * resolved from Ledger's device target id, never from a browser-provided label.
 */
export type LedgerDeviceModel = "nano-x" | "nano-s-plus" | "stax" | "flex" | "nano-gen5";

/**
 * A supported Ledger model and its parsed device OS version.
 */
export type LedgerFirmwareVersion = {
  readonly model: LedgerDeviceModel;
  readonly version: LedgerAppVersion;
};

/**
 * Pinned current Starknet app release accepted by mc-wallet. This is an
 * at-or-above compatibility floor, so a future app release does not block the
 * user. Updated from Ledger Manager's release catalogue on 2026-08-06. This is
 * a compatibility gate, not a signing trust decision: the background still
 * verifies every returned signature.
 */
export const MC_LEDGER_STARKNET_APP_MIN: LedgerAppVersion = { major: 2, minor: 4, patch: 0 };

/**
 * Pinned current Ledger OS releases accepted by mc-wallet, by target-id model.
 * These at-or-above floors were read from Ledger Manager's stable catalogue on
 * 2026-08-06. Unknown models fail closed rather than receiving a firmware rule
 * intended for a different secure element.
 */
export const MC_LEDGER_OS_MIN: Readonly<Record<LedgerDeviceModel, LedgerAppVersion>> = {
  flex: { major: 1, minor: 6, patch: 1 },
  "nano-gen5": { major: 1, minor: 1, patch: 1 },
  "nano-s-plus": { major: 1, minor: 6, patch: 1 },
  "nano-x": { major: 2, minor: 7, patch: 1 },
  stax: { major: 1, minor: 10, patch: 1 },
};

// APDU status words from the Ledger Starknet app (@ledgerhq/hw-app-starknet
// LedgerError). Kept as local constants so this module needs no runtime import
// from the ledger package (type-only imports above keep tests light).
const STATUS_OK = 0x9000;
const STATUS_BAD_CLA = 0x6e00;
const STATUS_BAD_INS = 0x6e01;
const STATUS_USER_REJECTED = 0x6e04;
// The catch-all the library reports for every thrown transport error and for any
// status word its `sendApdu` does not explicitly accept (see the module header).
const STATUS_EXECUTION_ERROR = 0x6f00;
const PUBLIC_KEY_BYTES = 64;
const FELT_BYTES = 32;
const MAX_VERSION_PART = 0xffff;

// Target ids returned by Ledger's Get OS Version APDU. The lower word is the
// product id; checking the complete target instead of a user-visible product
// label avoids accidentally applying a firmware floor to another device line.
const NANO_X_TARGET_ID = 0x33000004;
const NANO_S_PLUS_TARGET_ID = 0x33100004;
const STAX_TARGET_ID = 0x33200004;
const FLEX_TARGET_ID = 0x33300004;
const NANO_GEN5_TARGET_ID = 0x33400004;
const LEDGER_MODELS_BY_TARGET_ID: Readonly<Record<number, LedgerDeviceModel>> = {
  [NANO_X_TARGET_ID]: "nano-x",
  [NANO_S_PLUS_TARGET_ID]: "nano-s-plus",
  [STAX_TARGET_ID]: "stax",
  [FLEX_TARGET_ID]: "flex",
  [NANO_GEN5_TARGET_ID]: "nano-gen5",
};

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

// `@ledgerhq/hw-app-starknet` `getPubKey` already strips the SEC1 format byte and
// returns 64 bytes `X ‖ Y` (its `getStarkKey` reads the Stark key back as
// `publicKey.slice(0, 32)`). X is therefore the first 32 bytes, not bytes [1,33).
// The OZ account address is derived from X, so only X is kept.
const publicKeyXOf = (publicKey: Uint8Array): string => feltFromBytes(publicKey.slice(0, 32));

// Classifies a non-OK return code from a SILENT op (version / public-key read).
// The library hands back UserRejected verbatim; every other non-accepted status
// (and every swallowed transport error) is collapsed to ExecutionError, which is
// not actionable here, so it fails closed to `unexpected-device-error`.
const classifyDeviceStatus = (returnCode: number): LedgerRejection =>
  returnCode === STATUS_USER_REJECTED
    ? new LedgerRejection("rejected-on-device", returnCode)
    : returnCode === STATUS_BAD_CLA || returnCode === STATUS_BAD_INS
      ? new LedgerRejection("no-app-open", returnCode)
      : new LedgerRejection("unexpected-device-error", returnCode);

// Classifies a non-OK return code from `signHash`. The library reports a user
// rejection as UserRejected, but folds every other on-device refusal — including
// the conditions-not-satisfied the Starknet app returns when blind signing is
// disabled — into ExecutionError. Blind signing being off is the one recoverable,
// actionable sign-time failure (the user enables it and retries), and the shared
// pre-check has already ruled out a locked/disconnected/wrong/too-old device
// before this runs, so ExecutionError here is surfaced as that unblock prompt.
const classifySignStatus = (returnCode: number): LedgerRejection => {
  if (returnCode === STATUS_USER_REJECTED) {
    return new LedgerRejection("rejected-on-device", returnCode);
  }
  if (returnCode === STATUS_EXECUTION_ERROR) {
    return new LedgerRejection("blind-signing-disabled", returnCode);
  }
  return new LedgerRejection("unexpected-device-error", returnCode);
};

// Maps a thrown transport error to a rejection by its class name/message
// signature (DisconnectedDevice, LockedDeviceError, a claimed device, …). This
// is reachable because `getAppVersion` lets transport throws propagate (unlike
// `getPubKey`/`signHash`, which swallow them into ExecutionError), so the shared
// pre-check's version read is where a locked/disconnected/busy device surfaces.
// The default is unexpected-device-error.
const THROWN_SIGNATURES: readonly (readonly [RegExp, LedgerRejectionCode])[] = [
  [/\b(?:0x6d00|0x6e00|0x6e01|INS_NOT_SUPPORTED|CLA_NOT_SUPPORTED)\b/i, "no-app-open"],
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

/**
 * Reduces an untrusted browser-transport throw to the fixed Ledger rejection
 * catalog. The retained hardware-tab broker uses this before an error crosses
 * its extension-origin channel, so raw device/library messages never leave the
 * transport-owning context.
 */
export const ledgerTransportRejection = (error: unknown): LedgerRejection => mapThrown(error);

const runDevice = async <T>(op: () => Promise<T>): Promise<T> => {
  try {
    return await op();
  } catch (error) {
    throw mapThrown(error);
  }
};

const requireOk = (response: { readonly returnCode: number }): void => {
  if (response.returnCode !== STATUS_OK) {
    throw classifyDeviceStatus(response.returnCode);
  }
};

const requireDeviceBytes = (value: unknown, length: number): Uint8Array => {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new LedgerRejection("unexpected-device-error");
  }
  return value;
};

const isVersionPart = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_VERSION_PART;

const versionFromString = (value: unknown): LedgerAppVersion | null => {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) {
    return null;
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  if (!isVersionPart(major) || !isVersionPart(minor) || !isVersionPart(patch)) {
    return null;
  }
  return { major, minor, patch };
};

const meetsMinimum = (version: LedgerAppVersion, min: LedgerAppVersion): boolean =>
  version.major !== min.major
    ? version.major > min.major
    : version.minor !== min.minor
      ? version.minor > min.minor
      : version.patch >= min.patch;

const ledgerModelFromTargetId = (targetId: unknown): LedgerDeviceModel | null => {
  if (
    typeof targetId !== "number" ||
    !Number.isSafeInteger(targetId) ||
    targetId < 0 ||
    targetId > 0xffffffff
  ) {
    return null;
  }
  return LEDGER_MODELS_BY_TARGET_ID[targetId] ?? null;
};

/**
 * Reads and validates the device OS version. Only the known Ledger target ids
 * in {@link MC_LEDGER_OS_MIN} are accepted; unknown models fail closed with an
 * upgrade-compatible recovery message rather than borrowing another model's
 * release line.
 */
export const ledgerFirmwareVersion = async (
  client: LedgerDeviceClient,
): Promise<LedgerFirmwareVersion> => {
  const response = await runDevice(() => client.getOsVersion());
  const model = ledgerModelFromTargetId(response.targetId);
  const version = versionFromString(response.version);
  if (!model) {
    throw new LedgerRejection("unsupported-ledger-device");
  }
  if (!version) {
    throw new LedgerRejection("unexpected-device-error");
  }
  return { model, version };
};

/**
 * Reads the Ledger OS and rejects with `firmware-below-minimum` when it is
 * below this model's pinned current release. Returns the validated device
 * model/version so callers can avoid another firmware APDU in the same flow.
 */
export const assertLedgerFirmwareReady = async (
  client: LedgerDeviceClient,
): Promise<LedgerFirmwareVersion> => {
  const firmware = await ledgerFirmwareVersion(client);
  if (!meetsMinimum(firmware.version, MC_LEDGER_OS_MIN[firmware.model])) {
    throw new LedgerRejection("firmware-below-minimum");
  }
  return firmware;
};

/**
 * Reads the device Starknet app version, mapping device/transport failures.
 */
export const ledgerAppVersion = async (client: LedgerDeviceClient): Promise<LedgerAppVersion> => {
  const response = await runDevice(() => client.getAppVersion());
  requireOk(response);
  if (
    !isVersionPart(response.major) ||
    !isVersionPart(response.minor) ||
    !isVersionPart(response.patch)
  ) {
    throw new LedgerRejection("unexpected-device-error");
  }
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
 * Runs the two pinned compatibility gates in safe order: the device OS first,
 * then the open Starknet app. This does not establish signing authority; the
 * caller must still verify the public key and the background must verify every
 * signature before broadcast.
 */
export const assertLedgerDeviceReady = async (
  client: LedgerDeviceClient,
): Promise<LedgerAppVersion> => {
  await assertLedgerFirmwareReady(client);
  return assertLedgerAppReady(client);
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
  return publicKeyXOf(requireDeviceBytes(response.publicKey, PUBLIC_KEY_BYTES));
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
  if (response.returnCode !== STATUS_OK) {
    throw classifySignStatus(response.returnCode);
  }
  return {
    r: feltFromBytes(requireDeviceBytes(response.r, FELT_BYTES)),
    s: feltFromBytes(requireDeviceBytes(response.s, FELT_BYTES)),
  };
};
