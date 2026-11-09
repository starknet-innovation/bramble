/**
 * Coverage for the silent PAGINATED multi-index Ledger enumeration: the
 * version gate runs before any key read, and each page reads exactly its
 * slice of indices via serial getPubKey calls against an injected fake device
 * client. Controller coverage lives in `sidepanel-ledger-onboard.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import { ledgerAccountPath, READY_EIP2645_APPLICATION } from "@bramble/wallet-model/ledger-path";
import { enumerateLedgerPubKeys } from "../../../../src/sidepanel/journeys/ledger/onboard-session";

const version = (major: number) => ({
  errorMessage: "No errors",
  major,
  minor: major === 2 ? 4 : 0,
  patch: 0,
  returnCode: 0x9000,
});

// A device whose pubkey per index is deterministic (0x1, 0x2, …), so the test
// can assert the enumerated entries and that paths track their index.
const enumerateClient = (appMajor: number): LedgerDeviceClient => ({
  getOsVersion: () => Promise.resolve({ targetId: 0x33000004, version: "2.7.1" }),
  getAppVersion: () => Promise.resolve(version(appMajor)),
  getPubKey: (path: string) => {
    const index = Number(path.split("/").at(-1)?.replace(/'.*$/, "") ?? "0");
    return Promise.resolve({
      errorMessage: "No errors",
      publicKey: new Uint8Array([...new Array(31).fill(0), index + 1, ...new Array(32).fill(0)]),
      returnCode: 0x9000,
    });
  },
  signHash: () => Promise.reject(new Error("unused")),
});

describe("enumerateLedgerPubKeys", () => {
  test("reads a page of indices silently after the version gate", async () => {
    const entries = await enumerateLedgerPubKeys(enumerateClient(2), 0, 3);
    expect(entries.map((entry) => entry.accountIndex)).toEqual([0, 1, 2]);
    // Each pubkey X is a non-zero felt derived from the device bytes.
    expect(entries.every((entry) => entry.publicKeyX.startsWith("0x"))).toBe(true);
  });

  test("a later page reads the next slice of indices (5-9)", async () => {
    const entries = await enumerateLedgerPubKeys(enumerateClient(2), 5, 5);
    expect(entries.map((entry) => entry.accountIndex)).toEqual([5, 6, 7, 8, 9]);
  });

  test("asks the device for Bramble's path by default and Ready's when restoring", async () => {
    const paths: string[] = [];
    const base = enumerateClient(2);
    const client: LedgerDeviceClient = {
      ...base,
      getPubKey: (path: string, show?: boolean) => {
        paths.push(path);
        return base.getPubKey(path, show);
      },
    };
    await enumerateLedgerPubKeys(client, 10, 2, "verified");
    expect(paths).toEqual([ledgerAccountPath(10), ledgerAccountPath(11)]);
    paths.length = 0;
    await enumerateLedgerPubKeys(client, 10, 2, "verified", READY_EIP2645_APPLICATION);
    // Ready's scheme: application sha256("argentx"), plain (non-hardened) leaf index.
    expect(paths).toEqual([
      "m/2645'/1195502025'/1148870696'/0'/0'/10",
      "m/2645'/1195502025'/1148870696'/0'/0'/11",
    ]);
  });

  test("rejects a below-minimum app before reading any key", async () => {
    let reads = 0;
    const client: LedgerDeviceClient = {
      getOsVersion: () => Promise.resolve({ targetId: 0x33000004, version: "2.7.1" }),
      getAppVersion: () => Promise.resolve(version(1)),
      getPubKey: () => {
        reads += 1;
        return Promise.reject(new Error("unused"));
      },
      signHash: () => Promise.reject(new Error("unused")),
    };
    await expect(enumerateLedgerPubKeys(client, 0, 3)).rejects.toMatchObject({
      code: "app-below-minimum",
    });
    expect(reads).toBe(0);
  });
});
