/**
 * Ledger management APDUs change the browser-visible device connection. These
 * tests model that lifecycle explicitly: dashboard starts skip CloseApp, app
 * starts reconnect after CloseApp, OpenApp disconnects are accepted only after
 * a reconnect and state confirmation, and a sibling device never substitutes
 * for the one the user selected.
 */
import { describe, expect, test } from "bun:test";
import {
  exactLedgerDevice,
  type LedgerTransitionPhase,
  type LedgerTransitionPort,
  readLedgerOsAndRestoreStarknet,
} from "../../src/sidepanel/ledger/device-transition";

type ApduCall = { readonly cla: number; readonly data: readonly number[]; readonly ins: number };
type Response = Uint8Array | Error;

const ok = (): Uint8Array => Uint8Array.from([0x90, 0x00]);

const appState = (name: string, version = "2.4.0"): Uint8Array => {
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

const osVersion = (): Uint8Array =>
  Uint8Array.from([
    0x33,
    0x00,
    0x00,
    0x04,
    0x05,
    ...new TextEncoder().encode("2.6.1"),
    0,
    0x90,
    0x00,
  ]);

const transitionHarness = (
  connections: readonly (readonly Response[])[],
  reconnect?: (nextConnection: number) => Promise<void>,
): {
  readonly calls: ApduCall[];
  readonly phases: LedgerTransitionPhase[];
  readonly port: LedgerTransitionPort;
  readonly reconnects: () => number;
} => {
  const remaining = connections.map((responses) => [...responses]);
  const calls: ApduCall[] = [];
  const phases: LedgerTransitionPhase[] = [];
  let connection = 0;
  let reconnectCount = 0;
  return {
    calls,
    phases,
    port: {
      reconnect: async () => {
        reconnectCount += 1;
        await reconnect?.(connection + 1);
        connection += 1;
        if (!remaining[connection]) {
          throw new Error("unexpected reconnect");
        }
      },
      send: async (cla, ins, _p1, _p2, data) => {
        calls.push({ cla, data: [...data], ins });
        const response = remaining[connection]?.shift();
        if (!response) {
          throw new Error("unexpected APDU");
        }
        if (response instanceof Error) {
          throw response;
        }
        return response;
      },
    },
    reconnects: () => reconnectCount,
  };
};

describe("Ledger dashboard and app transition", () => {
  test("dashboard starts skip CloseApp and confirm Starknet after reopening", async () => {
    const harness = transitionHarness([
      [appState("BOLOS"), osVersion(), ok()],
      [appState("Starknet")],
    ]);

    await expect(
      readLedgerOsAndRestoreStarknet(harness.port, (phase) => harness.phases.push(phase)),
    ).resolves.toEqual({ targetId: 0x33000004, version: "2.6.1" });

    expect(harness.reconnects()).toBe(1);
    expect(harness.calls.map(({ cla, ins }) => [cla, ins])).toEqual([
      [0xb0, 0x01],
      [0xe0, 0x01],
      [0xe0, 0xd8],
      [0xb0, 0x01],
    ]);
    expect(harness.phases).toEqual([
      "checking-device",
      "checking-firmware",
      "opening-starknet",
      "reconnecting-starknet",
      "confirming-starknet",
    ]);
  });

  test("app starts reconnect after both disconnecting transitions", async () => {
    const disconnected = new DOMException("device disconnected during operation", "NetworkError");
    const harness = transitionHarness([
      [appState("Starknet"), disconnected],
      [appState("BOLOS"), osVersion(), disconnected],
      [appState("Starknet")],
    ]);

    await expect(readLedgerOsAndRestoreStarknet(harness.port)).resolves.toEqual({
      targetId: 0x33000004,
      version: "2.6.1",
    });

    expect(harness.reconnects()).toBe(2);
    expect(harness.calls.map(({ cla, ins }) => [cla, ins])).toEqual([
      [0xb0, 0x01],
      [0xb0, 0xa7],
      [0xb0, 0x01],
      [0xe0, 0x01],
      [0xe0, 0xd8],
      [0xb0, 0x01],
    ]);
  });

  test("an acknowledged CloseApp still requires a dashboard reconnect", async () => {
    const harness = transitionHarness([
      [appState("Starknet"), ok()],
      [appState("BOLOS"), osVersion(), ok()],
      [appState("Starknet")],
    ]);

    await expect(readLedgerOsAndRestoreStarknet(harness.port)).resolves.toEqual({
      targetId: 0x33000004,
      version: "2.6.1",
    });
    expect(harness.reconnects()).toBe(2);
  });

  test("OpenApp disconnect is accepted only after Starknet is confirmed", async () => {
    const disconnected = new Error("DisconnectedDeviceDuringOperation");
    const harness = transitionHarness([
      [appState("BOLOS"), osVersion(), disconnected],
      [appState("Ethereum")],
    ]);

    await expect(readLedgerOsAndRestoreStarknet(harness.port)).rejects.toThrow(
      "Ledger did not open Starknet",
    );
    expect(harness.reconnects()).toBe(1);
  });

  test("restores Starknet before surfacing a malformed firmware response", async () => {
    const malformedOs = Uint8Array.from([
      0x33,
      0x00,
      0x00,
      0x04,
      0x05,
      ...new TextEncoder().encode("2.6.1"),
      0x90,
      0x00,
    ]);
    const harness = transitionHarness([
      [appState("BOLOS"), malformedOs, ok()],
      [appState("Starknet")],
    ]);

    await expect(readLedgerOsAndRestoreStarknet(harness.port)).rejects.toThrow(
      "Malformed Ledger management response",
    );
    expect(harness.calls.at(-1)).toMatchObject({ cla: 0xb0, ins: 0x01 });
  });

  test("a reconnect that cannot bind the selected device fails closed", async () => {
    const selected = { id: "selected", productName: "Ledger" };
    const wrong = { id: "other", productName: "Ledger" };
    const harness = transitionHarness([[appState("BOLOS"), osVersion(), ok()]], async () => {
      if (!exactLedgerDevice(selected, [wrong])) {
        throw new Error("Ledger exact device unavailable");
      }
    });

    await expect(readLedgerOsAndRestoreStarknet(harness.port)).rejects.toThrow(
      "Ledger exact device unavailable",
    );
    expect(harness.calls).toHaveLength(3);
  });

  test("a non-disconnect OpenApp failure is not reclassified as success", async () => {
    const rejected = new Error("User rejected opening the app");
    const harness = transitionHarness([[appState("BOLOS"), osVersion(), rejected]]);

    await expect(readLedgerOsAndRestoreStarknet(harness.port)).rejects.toBe(rejected);
    expect(harness.reconnects()).toBe(0);
  });
});

describe("exact Ledger device identity", () => {
  test("prefers browser object identity regardless of list order", () => {
    const selected = { productName: "Ledger" };
    const sibling = { productName: "Ledger" };
    expect(exactLedgerDevice(selected, [sibling, selected])).toBe(selected);
  });

  test("rejects another identically labelled device", () => {
    const selected = { productName: "Ledger" };
    const sibling = { productName: "Ledger" };
    expect(exactLedgerDevice(selected, [sibling])).toBeNull();
  });

  test("accepts one re-enumerated WebUSB serial but rejects ambiguity", () => {
    const selected = { serialNumber: "origin-only-serial", vendorId: 0x2c97 };
    const reenumerated = { serialNumber: "origin-only-serial", vendorId: 0x2c97 };
    expect(exactLedgerDevice(selected, [reenumerated])).toBe(reenumerated);
    expect(exactLedgerDevice(selected, [reenumerated, { ...reenumerated }])).toBeNull();
  });
});
