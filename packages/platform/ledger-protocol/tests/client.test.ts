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
  assertLedgerDeviceReady,
  assertLedgerFirmwareReady,
  type LedgerDeviceClient,
  ledgerAppVersion,
  ledgerFirmwareVersion,
  ledgerPublicKeyX,
  ledgerSignHashOnDevice,
  MC_LEDGER_OS_MIN,
  MC_LEDGER_STARKNET_APP_MIN,
} from "@bramble/ledger-protocol/client";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";

const OK = { errorMessage: "No errors", returnCode: 0x9000 };

const bytes = (values: readonly number[]): Uint8Array => Uint8Array.from(values);

// The real `@ledgerhq/hw-app-starknet` getPubKey returns 64 bytes X(32) ‖ Y(32)
// with the SEC1 format byte already stripped (its getStarkKey reads X back as
// publicKey.slice(0, 32)). X here is 0x…02; Y is all 0xff. A prefixed 65-byte
// fake would let the old slice(1, 33) "recover" X by luck and hide the bug.
const publicKey = bytes([...Array(31).fill(0), 0x02, ...Array(32).fill(0xff)]);

const fakeClient = (overrides: Partial<LedgerDeviceClient> = {}): LedgerDeviceClient => ({
  async getOsVersion() {
    return { targetId: 0x33000004, version: "2.6.1" };
  },
  async getAppVersion() {
    return { ...OK, major: 2, minor: 4, patch: 0 };
  },
  async getPubKey() {
    return { ...OK, publicKey };
  },
  async signHash() {
    return {
      ...OK,
      r: bytes([...Array(31).fill(0), 0x0a]),
      s: bytes([...Array(31).fill(0), 0x0b]),
      v: 0,
    };
  },
  ...overrides,
});

describe("ledgerAppVersion / assertLedgerAppReady", () => {
  test("reads the version and passes at or above the minimum", async () => {
    expect(await ledgerAppVersion(fakeClient())).toEqual({ major: 2, minor: 4, patch: 0 });
    expect(await assertLedgerAppReady(fakeClient())).toEqual({ major: 2, minor: 4, patch: 0 });
  });

  test("rejects an app below the pinned minimum", async () => {
    const client = fakeClient({
      async getAppVersion() {
        return {
          ...OK,
          major: MC_LEDGER_STARKNET_APP_MIN.major,
          minor: MC_LEDGER_STARKNET_APP_MIN.minor - 1,
          patch: 9,
        };
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

  test("maps wrong-app APDU status to the open-Starknet recovery", async () => {
    for (const returnCode of [0x6e00, 0x6e01]) {
      const wrongApp = fakeClient({
        async getAppVersion() {
          return { errorMessage: "wrong app", major: 0, minor: 0, patch: 0, returnCode };
        },
      });
      await expect(ledgerAppVersion(wrongApp)).rejects.toMatchObject({
        code: "no-app-open",
        statusWord: returnCode,
      });
    }
  });

  test("rejects malformed version bytes on an otherwise successful response", async () => {
    const client = fakeClient({
      async getAppVersion() {
        return { ...OK, major: -1, minor: 1, patch: 0 };
      },
    });
    await expect(ledgerAppVersion(client)).rejects.toMatchObject({
      code: "unexpected-device-error",
    });

    const impossibleByte = fakeClient({
      async getAppVersion() {
        return { ...OK, major: 256, minor: 1, patch: 0 };
      },
    });
    await expect(ledgerAppVersion(impossibleByte)).rejects.toMatchObject({
      code: "unexpected-device-error",
    });
  });
});

describe("ledgerFirmwareVersion / assertLedgerFirmwareReady", () => {
  test("reads a known device OS and passes at the model's compatibility floor", async () => {
    expect(await ledgerFirmwareVersion(fakeClient())).toEqual({
      model: "nano-x",
      version: MC_LEDGER_OS_MIN["nano-x"],
    });
    await expect(assertLedgerFirmwareReady(fakeClient())).resolves.toEqual({
      model: "nano-x",
      version: MC_LEDGER_OS_MIN["nano-x"],
    });
  });

  test("rejects an OS below its model's compatibility floor", async () => {
    const client = fakeClient({
      async getOsVersion() {
        return { targetId: 0x33000004, version: "2.6.0" };
      },
    });
    await expect(assertLedgerFirmwareReady(client)).rejects.toMatchObject({
      code: "firmware-below-minimum",
    });
  });

  test("uses Ledger's target masks across every supported model and hardware revision", async () => {
    const cases = [
      { model: "nano-x", targetId: 0x33001234 },
      { model: "nano-s-plus", targetId: 0x3310abcd },
      { model: "stax", targetId: 0x33200042 },
      { model: "flex", targetId: 0x3330ffff },
      { model: "nano-gen5", targetId: 0x33400099 },
    ] as const;
    for (const { model, targetId } of cases) {
      const minimum = MC_LEDGER_OS_MIN[model];
      const client = fakeClient({
        async getOsVersion() {
          return {
            targetId,
            version: `${minimum.major}.${minimum.minor}.${minimum.patch}`,
          };
        },
      });
      await expect(ledgerFirmwareVersion(client)).resolves.toEqual({
        model,
        version: minimum,
      });
    }
  });

  test("fails closed for an unknown device target or malformed OS version", async () => {
    const unknownDevice = fakeClient({
      async getOsVersion() {
        return { targetId: 0x31100004, version: "2.7.1" };
      },
    });
    await expect(ledgerFirmwareVersion(unknownDevice)).rejects.toMatchObject({
      code: "unsupported-ledger-device",
    });

    const malformedVersion = fakeClient({
      async getOsVersion() {
        return { targetId: 0x33000004, version: "2.7" };
      },
    });
    await expect(ledgerFirmwareVersion(malformedVersion)).rejects.toMatchObject({
      code: "unexpected-device-error",
    });
  });
});

describe("assertLedgerDeviceReady", () => {
  test("checks the OS before the Starknet app and returns the app version", async () => {
    const calls: string[] = [];
    const client = fakeClient({
      async getAppVersion() {
        calls.push("app");
        return { ...OK, major: 2, minor: 4, patch: 0 };
      },
      async getOsVersion() {
        calls.push("os");
        return { targetId: 0x33000004, version: "2.6.1" };
      },
    });
    await expect(assertLedgerDeviceReady(client)).resolves.toEqual({
      major: 2,
      minor: 4,
      patch: 0,
    });
    expect(calls).toEqual(["os", "app"]);
  });

  test("does not query the app when the OS needs an update", async () => {
    let appReads = 0;
    const client = fakeClient({
      async getAppVersion() {
        appReads += 1;
        return { ...OK, major: 2, minor: 4, patch: 0 };
      },
      async getOsVersion() {
        return { targetId: 0x33000004, version: "2.6.0" };
      },
    });
    await expect(assertLedgerDeviceReady(client)).rejects.toMatchObject({
      code: "firmware-below-minimum",
    });
    expect(appReads).toBe(0);
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

  test("rejects a truncated or oversized public key", async () => {
    for (const malformed of [publicKey.slice(0, 63), bytes([...publicKey, 0])]) {
      const client = fakeClient({
        async getPubKey() {
          return { ...OK, publicKey: malformed };
        },
      });
      await expect(ledgerPublicKeyX(client, "m")).rejects.toMatchObject({
        code: "unexpected-device-error",
      });
    }
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

  test("maps an ExecutionError from signHash to blind-signing-disabled", async () => {
    // The real signHash swallows every thrown transport error and folds any
    // non-accepted status word (e.g. the conditions-not-satisfied returned when
    // blind signing is off) into ExecutionError (0x6f00) — never a distinct word.
    const client = fakeClient({
      async signHash() {
        return {
          errorMessage: "Execution Error",
          r: bytes([]),
          s: bytes([]),
          returnCode: 0x6f00,
          v: 0,
        };
      },
    });
    await expect(ledgerSignHashOnDevice(client, "m", "0x1")).rejects.toMatchObject({
      code: "blind-signing-disabled",
    });
  });

  test("maps an unexpected sign status word to unexpected-device-error", async () => {
    const client = fakeClient({
      async signHash() {
        return { errorMessage: "Bad INS", r: bytes([]), s: bytes([]), returnCode: 0x6e01, v: 0 };
      },
    });
    await expect(ledgerSignHashOnDevice(client, "m", "0x1")).rejects.toMatchObject({
      code: "unexpected-device-error",
    });
  });

  test("rejects malformed signature component lengths before verification", async () => {
    const client = fakeClient({
      async signHash() {
        return { ...OK, r: bytes([1]), s: bytes(Array(32).fill(2)), v: 0 };
      },
    });
    await expect(ledgerSignHashOnDevice(client, "m", "0x1")).rejects.toMatchObject({
      code: "unexpected-device-error",
    });
  });
});

describe("thrown transport errors on the version read", () => {
  // getAppVersion (unlike getPubKey/signHash) lets a thrown transport error
  // propagate, so mapThrown classifies a locked/disconnected/busy device there.
  test("maps a thrown LockedDeviceError to device-locked", async () => {
    const client = fakeClient({
      async getAppVersion() {
        throw new Error("LockedDeviceError: device is locked");
      },
    });
    await expect(ledgerAppVersion(client)).rejects.toMatchObject({ code: "device-locked" });
  });

  test("maps a thrown wrong-app transport status to no-app-open", async () => {
    const client = fakeClient({
      async getAppVersion() {
        throw new Error("TransportStatusError: Ledger device: INS_NOT_SUPPORTED (0x6d00)");
      },
    });
    await expect(ledgerAppVersion(client)).rejects.toMatchObject({ code: "no-app-open" });
  });

  test("wraps an unrecognized thrown value as an unexpected-device-error rejection", async () => {
    const client = fakeClient({
      async getAppVersion() {
        throw "weird";
      },
    });
    await expect(ledgerAppVersion(client)).rejects.toBeInstanceOf(LedgerRejection);
  });
});
