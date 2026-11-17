/**
 * Pins the Speculos bridge's canned dashboard replies (issue 861, review
 * point 6). They must not drift into a fiction that always passes:
 * - the OS reply is the testkit's capture of Ledger's official Nano X fixture
 *   with only the target id and SE version swapped;
 * - the app-state reply is the testkit's own builder output;
 * - both go through the wallet's real firmware gate and model check, so a
 *   stand-in the wallet would reject (or read as the wrong model) fails here.
 */
import { describe, expect, test } from "bun:test";
import {
  assertLedgerFirmwareReady,
  type LedgerDeviceClient,
} from "@bramble/ledger-protocol/client";
import {
  type LedgerTransitionPort,
  readLedgerOsAndRestoreStarknet,
} from "@bramble/ledger-protocol/device-transition";
import { ledgerAppStateResponse, ledgerNanoXOsResponse } from "@bramble/testkit/ledger-management";
import {
  createDashboardStandIn,
  DASHBOARD_FIRMWARE,
  dashboardOsResponse,
  type LedgerModel,
  OS_VERSION_LV_OFFSET,
} from "./dashboard";

const MODELS: readonly LedgerModel[] = ["nanosp", "flex", "stax"];
const EXPECTED_MODEL = { flex: "flex", nanosp: "nano-s-plus", stax: "stax" } as const;
const apdu = (cla: number, ins: number, data: readonly number[] = []): Uint8Array =>
  Uint8Array.from([cla, ins, 0, 0, data.length, ...data]);
const STARKNET = [...new TextEncoder().encode("Starknet")];

/** Puts the capture's target id and SE version back into a stand-in reply. */
const withCaptureFields = (reply: Uint8Array): Uint8Array => {
  const capture = ledgerNanoXOsResponse();
  const captureVersion = capture.slice(OS_VERSION_LV_OFFSET, OS_VERSION_LV_OFFSET + 6);
  const replyVersionLength = reply[OS_VERSION_LV_OFFSET] ?? 0;
  return Uint8Array.from([
    ...capture.slice(0, OS_VERSION_LV_OFFSET),
    ...captureVersion,
    ...reply.slice(OS_VERSION_LV_OFFSET + 1 + replyVersionLength),
  ]);
};

/** A transition port wired to the stand-in, with the app answering B0 01. */
const standInPort = (
  model: LedgerModel,
): { readonly port: LedgerTransitionPort; readonly reconnects: () => number } => {
  const standIn = createDashboardStandIn(model);
  let reconnects = 0;
  let awaitingReconnect = false;
  return {
    port: {
      reconnect: async () => {
        reconnects += 1;
        awaitingReconnect = false;
      },
      send: async (cla, ins, p1, p2, data) => {
        if (awaitingReconnect) {
          throw new Error("APDU sent to a disconnected device");
        }
        const step = standIn.handle(Uint8Array.from([cla, ins, p1, p2, data.length, ...data]));
        if (step.kind === "forward") {
          // The emulated app's own B0 01 answer (the SDK replies with name/version).
          expect([cla, ins]).toEqual([0xb0, 0x01]);
          return ledgerAppStateResponse("Starknet", "2.4.3");
        }
        awaitingReconnect = step.disconnect;
        return step.response;
      },
    },
    reconnects: () => reconnects,
  };
};

describe("dashboard stand-in replies", () => {
  test("the Nano X capture is still the testkit's (template unchanged)", () => {
    const capture = ledgerNanoXOsResponse();
    expect(capture[OS_VERSION_LV_OFFSET]).toBe(5);
    expect(new TextDecoder().decode(capture.slice(5, 10))).toBe("2.2.3");
  });

  for (const model of MODELS) {
    test(`${model}: OS reply differs from the capture only in target id and version`, () => {
      const reply = dashboardOsResponse(model);
      expect(withCaptureFields(reply)).toEqual(ledgerNanoXOsResponse());
      const { targetId, version } = DASHBOARD_FIRMWARE[model];
      expect(new DataView(reply.buffer).getUint32(0)).toBe(targetId);
      expect(new TextDecoder().decode(reply.slice(5, 5 + version.length))).toBe(version);
    });

    test(`${model}: the wallet's firmware gate accepts it as the right model`, async () => {
      const { port, reconnects } = standInPort(model);
      const client = { getOsVersion: () => readLedgerOsAndRestoreStarknet(port) };
      const firmware = await assertLedgerFirmwareReady(client as unknown as LedgerDeviceClient);
      expect(firmware.model).toBe(EXPECTED_MODEL[model]);
      // Quit and reopen each dropped the device and needed a reconnect.
      expect(reconnects()).toBe(2);
    });
  }
});

describe("dashboard stand-in state machine", () => {
  test("never forwards B0 A7, which would end the emulator", () => {
    const standIn = createDashboardStandIn("nanosp");
    const step = standIn.handle(apdu(0xb0, 0xa7));
    expect(step).toEqual({ disconnect: true, kind: "reply", response: Uint8Array.of(0x90, 0) });
    expect(standIn.location()).toBe("dashboard");
    expect(standIn.handle(apdu(0xb0, 0xa7))).toEqual({
      disconnect: false,
      kind: "reply",
      response: Uint8Array.of(0x90, 0),
    });
  });

  test("forwards app APDUs only while the app is open", () => {
    const standIn = createDashboardStandIn("flex");
    expect(standIn.handle(apdu(0x5a, 0x01))).toEqual({ kind: "forward" });
    standIn.handle(apdu(0xb0, 0xa7));
    expect(standIn.handle(apdu(0x5a, 0x01))).toEqual({
      disconnect: false,
      kind: "reply",
      response: Uint8Array.of(0x6e, 0x00),
    });
  });

  test("answers B0 01 as the dashboard with the OS version", () => {
    const standIn = createDashboardStandIn("stax");
    standIn.handle(apdu(0xb0, 0xa7));
    const step = standIn.handle(apdu(0xb0, 0x01));
    expect(step).toEqual({
      disconnect: false,
      kind: "reply",
      response: ledgerAppStateResponse("BOLOS", DASHBOARD_FIRMWARE.stax.version),
    });
  });

  test("reopens only Starknet, then hands APDUs back to the app", () => {
    const standIn = createDashboardStandIn("nanosp");
    standIn.handle(apdu(0xb0, 0xa7));
    expect(standIn.handle(apdu(0xe0, 0xd8, [...new TextEncoder().encode("Bitcoin")]))).toEqual({
      disconnect: false,
      kind: "reply",
      response: Uint8Array.of(0x68, 0x07),
    });
    expect(standIn.location()).toBe("dashboard");
    expect(standIn.handle(apdu(0xe0, 0xd8, STARKNET))).toEqual({
      disconnect: true,
      kind: "reply",
      response: Uint8Array.of(0x90, 0x00),
    });
    expect(standIn.location()).toBe("app");
    expect(standIn.handle(apdu(0xb0, 0x01))).toEqual({ kind: "forward" });
  });
});
