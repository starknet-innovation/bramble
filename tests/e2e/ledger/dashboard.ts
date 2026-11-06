/**
 * Dashboard stand-in for the Speculos Ledger bridge.
 *
 * Speculos emulates one app, never the Ledger dashboard, but Bramble's firmware
 * gate (`readLedgerOsAndRestoreStarknet`) quits the app (`B0 A7`), reads the OS
 * on the dashboard (`E0 01`), and reopens Starknet (`E0 D8`), reconnecting after
 * each transition. This module answers exactly those steps and forwards every
 * other APDU to the emulated app. `B0 A7` is never forwarded: inside Speculos it
 * would exit the only app and end the emulator.
 *
 * Replies are not hand-typed. The OS reply is the testkit's capture of Ledger's
 * official Nano X fixture with only the target id and SE version swapped for the
 * emulated model, and the app-state reply comes from the testkit's builder;
 * `tests/e2e/ledger/dashboard.test.ts` pins both against those captures and runs
 * them through the wallet's real parser.
 *
 * Test-only. Nothing in `apps/` or `packages/` may import this file.
 */
import { ledgerAppStateResponse, ledgerNanoXOsResponse } from "@bramble/testkit/ledger-management";

/** Speculos model names this suite runs on (`speculos --model`). */
export type LedgerModel = "nanosp" | "flex" | "stax";

/**
 * Per-model dashboard facts: the Ledger target id (masked by the official
 * device catalogue) and an OS release the pinned app 2.4.3 was tagged for.
 */
export const DASHBOARD_FIRMWARE: Readonly<
  Record<LedgerModel, { readonly targetId: number; readonly version: string }>
> = {
  flex: { targetId: 0x33300004, version: "1.6.1" },
  nanosp: { targetId: 0x33100004, version: "1.6.1" },
  stax: { targetId: 0x33200004, version: "1.10.1" },
};

/** Offset of the SE-version length byte in a GetOsVersion reply (after the target id). */
export const OS_VERSION_LV_OFFSET = 4;

const STATUS_OK = Uint8Array.of(0x90, 0x00);
const STATUS_CLA_NOT_SUPPORTED = Uint8Array.of(0x6e, 0x00);
const STATUS_APP_NOT_FOUND = Uint8Array.of(0x68, 0x07);
const STARKNET_APP_NAME = "Starknet";
const DASHBOARD_APP_NAME = "BOLOS";

/**
 * Builds the dashboard GetOsVersion reply for `model` from the testkit's Nano X
 * capture: same envelope, same MCU and trailing fields, with the target id and
 * SE version replaced.
 */
export const dashboardOsResponse = (model: LedgerModel): Uint8Array => {
  const capture = ledgerNanoXOsResponse();
  const { targetId, version } = DASHBOARD_FIRMWARE[model];
  const capturedVersionLength = capture[OS_VERSION_LV_OFFSET] ?? 0;
  const rest = capture.slice(OS_VERSION_LV_OFFSET + 1 + capturedVersionLength);
  const versionBytes = new TextEncoder().encode(version);
  return Uint8Array.from([
    (targetId >>> 24) & 0xff,
    (targetId >>> 16) & 0xff,
    (targetId >>> 8) & 0xff,
    targetId & 0xff,
    versionBytes.length,
    ...versionBytes,
    ...rest,
  ]);
};

/** What the bridge does with one APDU. */
type DashboardStep =
  | { readonly kind: "forward" }
  | {
      readonly kind: "reply";
      /** Reply bytes including the status word. */
      readonly response: Uint8Array;
      /** True when the device drops off the bus right after replying. */
      readonly disconnect: boolean;
    };

/** Stateful stand-in: which screen the emulated device is on, and its answers. */
export type DashboardStandIn = {
  readonly handle: (apdu: Uint8Array) => DashboardStep;
  readonly location: () => "app" | "dashboard";
};

const reply = (response: Uint8Array, disconnect = false): DashboardStep => ({
  disconnect,
  kind: "reply",
  response,
});

const apduData = (apdu: Uint8Array): Uint8Array => {
  const length = apdu[4] ?? 0;
  return apdu.slice(5, 5 + length);
};

/**
 * Creates a stand-in that starts inside the Starknet app, the state the wallet
 * asks the user to be in. In the app every APDU but `B0 A7` is forwarded; on
 * the dashboard only `B0 01`, `E0 01`, `E0 D8` and a no-op `B0 A7` answer, and
 * anything else gets the dashboard's CLA-not-supported refusal.
 */
export const createDashboardStandIn = (model: LedgerModel): DashboardStandIn => {
  let location: "app" | "dashboard" = "app";
  const handle = (apdu: Uint8Array): DashboardStep => {
    const cla = apdu[0];
    const ins = apdu[1];
    if (cla === 0xb0 && ins === 0xa7) {
      if (location === "dashboard") {
        return reply(STATUS_OK);
      }
      location = "dashboard";
      return reply(STATUS_OK, true);
    }
    if (location === "app") {
      return { kind: "forward" };
    }
    if (cla === 0xb0 && ins === 0x01) {
      return reply(ledgerAppStateResponse(DASHBOARD_APP_NAME, DASHBOARD_FIRMWARE[model].version));
    }
    if (cla === 0xe0 && ins === 0x01) {
      return reply(dashboardOsResponse(model));
    }
    if (cla === 0xe0 && ins === 0xd8) {
      if (new TextDecoder().decode(apduData(apdu)) !== STARKNET_APP_NAME) {
        return reply(STATUS_APP_NOT_FOUND);
      }
      location = "app";
      return reply(STATUS_OK, true);
    }
    return reply(STATUS_CLA_NOT_SUPPORTED);
  };
  return { handle, location: () => location };
};
