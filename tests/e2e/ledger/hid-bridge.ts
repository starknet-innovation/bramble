/**
 * Node half of the Playwright-only Ledger bridge. It installs the fake
 * `navigator.hid` (`hid-shim.ts`) into every page of a browser context, takes
 * each output report through `exposeBinding`, reassembles APDUs with the
 * WebHID transport's own framing, lets the dashboard stand-in answer the
 * firmware-gate steps, and forwards everything else to an APDU backend
 * (Speculos on TCP 9999 in the E2E suite).
 *
 * Every page message is untrusted input and validated before use. The bridge
 * keeps an APDU log (CLA/INS and who answered) so a test can prove the device
 * — not the stand-in — produced keys and signatures.
 *
 * Test-only. Nothing in `apps/` or `packages/` may import this file
 * (`scripts/check-test-bridge-boundary.ts`).
 */
import type { BrowserContext } from "@playwright/test";
import { createDashboardStandIn, type DashboardStandIn, type LedgerModel } from "./dashboard";
import { framesFor, HidApduAssembler, LEDGER_HID_PACKET_SIZE } from "./hid-frames";
import {
  type FakeLedgerHidConfig,
  type HidBridgeReply,
  type HidBridgeRequest,
  installFakeLedgerHid,
} from "./hid-shim";

/** Anything that answers a raw APDU with reply bytes plus status word. */
export type ApduBackend = {
  readonly exchange: (apdu: Uint8Array) => Promise<Uint8Array>;
};

/** One APDU the bridge served, for assertions. */
export type BridgeLogEntry = {
  readonly answeredBy: "device" | "dashboard";
  readonly cla: number;
  readonly ins: number;
  readonly status: number;
};

/** Ledger's USB vendor id (`LEDGER_USB_VENDOR_ID` in `@ledgerhq/devices`). */
export const LEDGER_USB_VENDOR_ID = 0x2c97;

/** Ledger's vendor-defined APDU HID usage page. */
export const LEDGER_APDU_USAGE_PAGE = 0xffa0;

const BINDING = "__brambleLedgerHidBridge";
const DEFAULT_RECONNECT_MS = 300;

const PRODUCT: Readonly<Record<LedgerModel, { readonly id: number; readonly name: string }>> = {
  flex: { id: 0x7011, name: "Ledger Flex" },
  nanosp: { id: 0x5011, name: "Nano S Plus" },
  stax: { id: 0x6011, name: "Ledger Stax" },
};

const isByte = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xff;

/**
 * Validates one page message. Anything else is rejected, never coerced.
 */
export const parseBridgeRequest = (value: unknown): HidBridgeRequest => {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  if (record["op"] === "getDevices") {
    return { op: "getDevices" };
  }
  if (record["op"] === "requestDevice") {
    const ids = record["vendorIds"];
    if (Array.isArray(ids) && ids.every((id) => typeof id === "number")) {
      return { op: "requestDevice", vendorIds: ids as number[] };
    }
  }
  if (record["op"] === "report") {
    const packet = record["packet"];
    if (Array.isArray(packet) && packet.length === LEDGER_HID_PACKET_SIZE && packet.every(isByte)) {
      return { op: "report", packet: packet as number[] };
    }
  }
  throw new Error("Malformed Ledger bridge request");
};

/** Construction options for {@link LedgerHidBridge}. */
export type LedgerHidBridgeOptions = {
  readonly backend: ApduBackend;
  readonly model: LedgerModel;
  /** Already granted at start (silent reconnect) rather than via the grant tab. */
  readonly granted?: boolean;
  readonly reconnectMs?: number;
};

/** Fake-HID bridge for one emulated Ledger. */
export class LedgerHidBridge {
  /** Every APDU served, in order. */
  readonly log: BridgeLogEntry[] = [];
  private readonly assembler = new HidApduAssembler();
  private readonly backend: ApduBackend;
  private readonly dashboard: DashboardStandIn;
  private granted: boolean;
  private present = true;
  private readonly reconnectMs: number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: LedgerHidBridgeOptions) {
    this.backend = options.backend;
    this.dashboard = createDashboardStandIn(options.model);
    this.granted = options.granted ?? false;
    this.reconnectMs = options.reconnectMs ?? DEFAULT_RECONNECT_MS;
  }

  /** True once a page's `requestDevice` granted the device. */
  get isGranted(): boolean {
    return this.granted;
  }

  /** Where the stand-in believes the device is. */
  location(): "app" | "dashboard" {
    return this.dashboard.location();
  }

  /**
   * Installs the fake HID into every current and future page of `context`.
   * Call before opening any wallet page.
   */
  async install(context: BrowserContext): Promise<void> {
    const product = PRODUCT[this.options.model];
    const config: FakeLedgerHidConfig = {
      binding: BINDING,
      productId: product.id,
      productName: product.name,
      reconnectMs: this.reconnectMs,
      usagePage: LEDGER_APDU_USAGE_PAGE,
      vendorId: LEDGER_USB_VENDOR_ID,
    };
    await context.exposeBinding(BINDING, (_source, request: unknown) => this.handle(request));
    await context.addInitScript(installFakeLedgerHid, config);
  }

  /** Answers one validated page message. Exposed for unit tests. */
  handle(raw: unknown): Promise<HidBridgeReply> {
    const request = parseBridgeRequest(raw);
    if (request.op === "getDevices") {
      return Promise.resolve({ present: this.granted && this.present });
    }
    if (request.op === "requestDevice") {
      if (request.vendorIds.length > 0 && !request.vendorIds.includes(LEDGER_USB_VENDOR_ID)) {
        return Promise.resolve({ present: false });
      }
      this.granted = true;
      return Promise.resolve({ present: this.present });
    }
    // One APDU at a time, like the device itself.
    const next = this.queue.then(() => this.report(Uint8Array.from(request.packet)));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async report(packet: Uint8Array): Promise<HidBridgeReply> {
    if (!this.present) {
      throw new Error("Ledger is disconnected");
    }
    const assembled = this.assembler.push(packet);
    if (!assembled) {
      return {};
    }
    const { apdu, channel } = assembled;
    const step = this.dashboard.handle(apdu);
    const response = step.kind === "forward" ? await this.backend.exchange(apdu) : step.response;
    const status = ((response.at(-2) ?? 0) << 8) | (response.at(-1) ?? 0);
    this.log.push({
      answeredBy: step.kind === "forward" ? "device" : "dashboard",
      cla: apdu[0] ?? 0,
      ins: apdu[1] ?? 0,
      status,
    });
    const disconnect = step.kind === "reply" && step.disconnect;
    if (disconnect) {
      this.present = false;
      setTimeout(() => {
        this.present = true;
      }, this.reconnectMs);
    }
    return {
      disconnect,
      packets: framesFor(channel, response).map((frame) => Array.from(frame)),
    };
  }
}
