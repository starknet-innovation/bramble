/**
 * Ledger device-client logic checks with an injected fake StarknetClient (no
 * hardware): the version gate rejects below the pinned minimum, public-key
 * enumeration is silent and returns a canonical felt x-coordinate, blind-sign
 * returns raw (r, s), and every device return code and thrown transport error
 * maps to the typed rejection catalog.
 */
import { describe, expect, test } from "bun:test";
import {
  assertLedgerAppReady,
  type LedgerDeviceClient,
  ledgerAppVersion,
  ledgerPublicKeyX,
  ledgerSignHashOnDevice,
  MC_LEDGER_STARKNET_APP_MIN,
} from "../src/sidepanel/ledger/client";
import { LedgerRejection } from "../src/sidepanel/ledger/errors";

const OK = { errorMessage: "No errors", returnCode: 0x9000 };

const bytes = (values: readonly number[]): Uint8Array => Uint8Array.from(values);

// A 65-byte uncompressed key: 0x04 ‖ X(32) ‖ Y(32). X here is 0x…0102 padded.
const publicKey = bytes([0x04, ...Array(31).fill(0), 0x02, ...Array(32).fill(0xff)]);

const fakeClient = (overrides: Partial<LedgerDeviceClient> = {}): LedgerDeviceClient => ({
  async getAppVersion() {
    return { ...OK, major: 2, minor: 1, patch: 0 };
  },
  async getPubKey() {
    return { ...OK, publicKey };
  },
  async signHash() {
    return { ...OK, r: bytes([0x0a]), s: bytes([0x0b]), v: 0 };
  },
  ...overrides,
});

describe("ledgerAppVersion / assertLedgerAppReady", () => {
  test("reads the version and passes at or above the minimum", async () => {
    expect(await ledgerAppVersion(fakeClient())).toEqual({ major: 2, minor: 1, patch: 0 });
    expect(await assertLedgerAppReady(fakeClient())).toEqual({ major: 2, minor: 1, patch: 0 });
  });

  test("rejects an app below the pinned minimum", async () => {
    const belowPatch = { ...MC_LEDGER_STARKNET_APP_MIN, patch: 0 };
    const client = fakeClient({
      async getAppVersion() {
        return { ...OK, major: belowPatch.major - 1, minor: 9, patch: 9 };
      },
    });
    await expect(assertLedgerAppReady(client)).rejects.toMatchObject({ code: "app-below-minimum" });
  });

  test("maps a device error return code on the version read", async () => {
    const client = fakeClient({
      async getAppVersion() {
        return { errorMessage: "boom", major: 0, minor: 0, patch: 0, returnCode: 0x6f00 };
      },
    });
    await expect(ledgerAppVersion(client)).rejects.toMatchObject({
      code: "unexpected-device-error",
    });
  });
});

describe("ledgerPublicKeyX", () => {
  test("enumerates silently and returns a canonical felt x-coordinate", async () => {
    const seen: { path: string; show: boolean | undefined }[] = [];
    const client = fakeClient({
      async getPubKey(path, show) {
        seen.push({ path, show });
        return { ...OK, publicKey };
      },
    });
    const x = await ledgerPublicKeyX(client, "m/2645'/0'/0'/0'/0'/0");
    expect(seen).toEqual([{ path: "m/2645'/0'/0'/0'/0'/0", show: false }]);
    expect(x).toBe("0x2");
  });
});

describe("ledgerSignHashOnDevice", () => {
  test("returns the raw (r, s) as canonical felts", async () => {
    const signature = await ledgerSignHashOnDevice(fakeClient(), "m/2645'/0'/0'/0'/0'/0", "0x1");
    expect(signature).toEqual({ r: "0xa", s: "0xb" });
  });

  test("maps a user rejection to rejected-on-device", async () => {
    const client = fakeClient({
      async signHash() {
        return { errorMessage: "Rejected", r: bytes([]), s: bytes([]), returnCode: 0x6e04, v: 0 };
      },
    });
    await expect(ledgerSignHashOnDevice(client, "m", "0x1")).rejects.toMatchObject({
      code: "rejected-on-device",
    });
  });

  test("detects a blind-signing-disabled refusal from the error message", async () => {
    const client = fakeClient({
      async signHash() {
        return {
          errorMessage: "Blind signing must be enabled",
          r: bytes([]),
          s: bytes([]),
          returnCode: 0x6985,
          v: 0,
        };
      },
    });
    await expect(ledgerSignHashOnDevice(client, "m", "0x1")).rejects.toMatchObject({
      code: "blind-signing-disabled",
    });
  });

  test("maps a thrown transport error by its signature", async () => {
    const client = fakeClient({
      async signHash() {
        throw new Error("LockedDeviceError: device is locked");
      },
    });
    await expect(ledgerSignHashOnDevice(client, "m", "0x1")).rejects.toMatchObject({
      code: "device-locked",
    });
  });

  test("wraps an unrecognized thrown value as unexpected-device-error", async () => {
    const client = fakeClient({
      async signHash() {
        throw "weird";
      },
    });
    await expect(ledgerSignHashOnDevice(client, "m", "0x1")).rejects.toBeInstanceOf(
      LedgerRejection,
    );
  });
});
