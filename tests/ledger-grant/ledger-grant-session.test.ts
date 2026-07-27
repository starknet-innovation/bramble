/**
 * The grant popup must verify the Starknet app and release its transport before
 * returning control to the side panel. Probe failures remain actionable even
 * when teardown also fails; a teardown failure after a good probe is surfaced.
 */
import { describe, expect, test } from "bun:test";
import { verifyLedgerGrantSession } from "../../src/ledger-grant/grant-session";
import type { LedgerDeviceClient } from "../../src/sidepanel/ledger/client";
import { LedgerRejection } from "../../src/sidepanel/ledger/errors";
import { ledgerAccountPath } from "../../src/starknet/ledger-path";

const unusedBytes = new Uint8Array(64);

const client = (getAppVersion: LedgerDeviceClient["getAppVersion"]): LedgerDeviceClient => ({
  getAppVersion,
  getPubKey: () =>
    Promise.resolve({ errorMessage: "", publicKey: unusedBytes, returnCode: 0x9000 }),
  signHash: () =>
    Promise.resolve({
      errorMessage: "",
      r: unusedBytes.slice(0, 32),
      returnCode: 0x9000,
      s: unusedBytes.slice(0, 32),
    }),
});

describe("verifyLedgerGrantSession", () => {
  test("returns the verified app version and closes the transport", async () => {
    let closed = 0;
    const keyReads: { path: string; show: boolean | undefined }[] = [];
    const version = await verifyLedgerGrantSession({
      client: {
        ...client(() =>
          Promise.resolve({
            errorMessage: "",
            major: 2,
            minor: 3,
            patch: 1,
            returnCode: 0x9000,
          }),
        ),
        getPubKey: (path, show) => {
          keyReads.push({ path, show });
          return Promise.resolve({
            errorMessage: "",
            publicKey: unusedBytes,
            returnCode: 0x9000,
          });
        },
      },
      close: () => {
        closed += 1;
        return Promise.resolve();
      },
    });

    expect(version).toEqual({ major: 2, minor: 3, patch: 1 });
    expect(keyReads).toEqual([{ path: ledgerAccountPath(0), show: false }]);
    expect(closed).toBe(1);
  });

  test("preserves an app-probe rejection when closing also fails", async () => {
    const session = {
      client: client(() =>
        Promise.resolve({
          errorMessage: "Bad INS",
          major: 0,
          minor: 0,
          patch: 0,
          returnCode: 0x6e01,
        }),
      ),
      close: () => Promise.reject(new Error("close failed")),
    };

    await expect(verifyLedgerGrantSession(session)).rejects.toMatchObject({
      code: "no-app-open",
    });
  });

  test("surfaces a close failure after a successful probe", async () => {
    const session = {
      client: client(() =>
        Promise.resolve({
          errorMessage: "",
          major: 2,
          minor: 0,
          patch: 0,
          returnCode: 0x9000,
        }),
      ),
      close: () => Promise.reject(new LedgerRejection("device-busy")),
    };

    await expect(verifyLedgerGrantSession(session)).rejects.toMatchObject({
      code: "device-busy",
    });
  });

  test("closes when the public-key handshake is malformed", async () => {
    let closed = 0;
    const base = client(() =>
      Promise.resolve({
        errorMessage: "",
        major: 2,
        minor: 0,
        patch: 0,
        returnCode: 0x9000,
      }),
    );
    const session = {
      client: {
        ...base,
        getPubKey: () =>
          Promise.resolve({
            errorMessage: "",
            publicKey: new Uint8Array(1),
            returnCode: 0x9000,
          }),
      },
      close: () => {
        closed += 1;
        return Promise.resolve();
      },
    };

    await expect(verifyLedgerGrantSession(session)).rejects.toMatchObject({
      code: "unexpected-device-error",
    });
    expect(closed).toBe(1);
  });
});
