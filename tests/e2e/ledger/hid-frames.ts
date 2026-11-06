/**
 * Device-side HID framing for the Playwright-only Ledger bridge.
 *
 * Uses the exact framing module the shipped WebHID transport uses
 * (`@ledgerhq/hw-transport-webhid` 6.36.0, pinned in the root manifest and
 * lockfile), so the bridge cannot drift from the wire format the wallet speaks.
 * The format is symmetric: the host frames an APDU with `makeBlocks` and the
 * device reassembles it with `reduceResponse`; replies go the other way.
 *
 * Test-only. Nothing in `apps/` or `packages/` may import this file
 * (`scripts/check-test-bridge-boundary.ts`).
 */
import { createRequire } from "node:module";
import type { ResponseAcc } from "@ledgerhq/hw-transport-webhid/hid-framing";

// The CommonJS build: the ES build imports `@ledgerhq/errors` by extensionless
// paths that Node's ESM loader (Playwright's runner) cannot resolve. Same code.
const require = createRequire(import.meta.url);
const createHIDframing: typeof import("@ledgerhq/hw-transport-webhid/hid-framing").default =
  require("@ledgerhq/hw-transport-webhid/hid-framing").default;

/** Ledger HID report size in bytes, as used by the WebHID transport. */
export const LEDGER_HID_PACKET_SIZE = 64;

/** Reads the 16-bit channel id the host stamped on a HID packet. */
const channelOf = (packet: Uint8Array): number => {
  if (packet.length !== LEDGER_HID_PACKET_SIZE) {
    throw new Error(`HID packet must be ${LEDGER_HID_PACKET_SIZE} bytes, got ${packet.length}`);
  }
  return ((packet[0] ?? 0) << 8) | (packet[1] ?? 0);
};

/**
 * Reassembles host-to-device HID packets into whole APDUs, one channel at a
 * time. A packet on a new channel restarts assembly, mirroring a device that
 * only ever serves the latest host session.
 */
export class HidApduAssembler {
  private acc: ResponseAcc;
  private channel: number | null = null;

  /** Feeds one packet; returns the complete APDU once its last packet arrives. */
  push(packet: Uint8Array): { readonly apdu: Uint8Array; readonly channel: number } | null {
    const channel = channelOf(packet);
    if (channel !== this.channel) {
      this.channel = channel;
      this.acc = undefined;
    }
    const framing = createHIDframing(channel, LEDGER_HID_PACKET_SIZE);
    this.acc = framing.reduceResponse(this.acc, Buffer.from(packet));
    const apdu = framing.getReducedResult(this.acc);
    if (!apdu) {
      return null;
    }
    this.acc = undefined;
    return { apdu: Uint8Array.from(apdu), channel };
  }
}

/** Frames a device reply (data plus status word) into HID packets for `channel`. */
export const framesFor = (channel: number, response: Uint8Array): readonly Uint8Array[] =>
  createHIDframing(channel, LEDGER_HID_PACKET_SIZE).makeBlocks(Buffer.from(response));
