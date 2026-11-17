/**
 * Unit tests for the Node half of the Speculos Ledger bridge: HID framing in
 * both directions (with the transport's own framing as the host), message
 * validation, grant and disconnect state, and the Speculos socket and
 * endpoint handling.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:net";
import { LedgerHidBridge, parseBridgeRequest } from "./hid-bridge";
import { framesFor, HidApduAssembler, LEDGER_HID_PACKET_SIZE } from "./hid-frames";
import { SpeculosApdu, speculosEndpointsFromEnv } from "./speculos";

const require = createRequire(import.meta.url);
const hostFraming: typeof import("@ledgerhq/hw-transport-webhid/hid-framing").default =
  require("@ledgerhq/hw-transport-webhid/hid-framing").default;

const CHANNEL = 0x3b1f;
const hostPackets = (apdu: Uint8Array): number[][] =>
  hostFraming(CHANNEL, LEDGER_HID_PACKET_SIZE)
    .makeBlocks(Buffer.from(apdu))
    .map((block) => Array.from(block));
const hostRead = (packets: readonly (readonly number[])[]): Uint8Array => {
  const framing = hostFraming(CHANNEL, LEDGER_HID_PACKET_SIZE);
  let acc: Parameters<typeof framing.reduceResponse>[0];
  for (const packet of packets) {
    acc = framing.reduceResponse(acc, Buffer.from(packet));
  }
  return Uint8Array.from(framing.getReducedResult(acc) ?? []);
};

describe("HID framing", () => {
  test("reassembles a multi-packet host APDU and frames the reply back", () => {
    const apdu = Uint8Array.from({ length: 150 }, (_, index) => index & 0xff);
    const packets = hostPackets(apdu);
    expect(packets.length).toBeGreaterThan(2);
    const assembler = new HidApduAssembler();
    const results = packets.map((packet) => assembler.push(Uint8Array.from(packet)));
    expect(results.slice(0, -1).every((result) => result === null)).toBe(true);
    expect(results.at(-1)).toEqual({ apdu, channel: CHANNEL });
    const reply = Uint8Array.from([...apdu.slice(0, 90), 0x90, 0x00]);
    expect(hostRead(framesFor(CHANNEL, reply).map((frame) => Array.from(frame)))).toEqual(reply);
  });

  test("rejects packets that are not 64 bytes", () => {
    expect(() => new HidApduAssembler().push(new Uint8Array(10))).toThrow("64 bytes");
  });
});

describe("bridge message validation", () => {
  test("accepts only the three known shapes", () => {
    expect(parseBridgeRequest({ op: "getDevices" })).toEqual({ op: "getDevices" });
    expect(() => parseBridgeRequest({ op: "report", packet: [1, 2] })).toThrow();
    expect(() => parseBridgeRequest({ op: "report", packet: new Array(64).fill(256) })).toThrow();
    expect(() => parseBridgeRequest({ op: "requestDevice", vendorIds: ["x"] })).toThrow();
    expect(() => parseBridgeRequest("getDevices")).toThrow();
    expect(() => parseBridgeRequest({ op: "eval" })).toThrow();
  });
});

describe("LedgerHidBridge", () => {
  const forwarded: Uint8Array[] = [];
  const backend = {
    exchange: async (apdu: Uint8Array): Promise<Uint8Array> => {
      forwarded.push(apdu);
      return Uint8Array.of(0x01, 0x02, 0x90, 0x00);
    },
  };
  afterEach(() => {
    forwarded.length = 0;
  });

  const send = async (bridge: LedgerHidBridge, apdu: Uint8Array) => {
    let reply = {};
    for (const packet of hostPackets(apdu)) {
      reply = await bridge.handle({ op: "report", packet });
    }
    return reply as { disconnect?: boolean; packets?: number[][] };
  };

  test("lists the device only after a grant for Ledger's vendor id", async () => {
    const bridge = new LedgerHidBridge({ backend, model: "nanosp" });
    expect(await bridge.handle({ op: "getDevices" })).toEqual({ present: false });
    expect(await bridge.handle({ op: "requestDevice", vendorIds: [0x1234] })).toEqual({
      present: false,
    });
    expect(bridge.isGranted).toBe(false);
    expect(await bridge.handle({ op: "requestDevice", vendorIds: [0x2c97] })).toEqual({
      present: true,
    });
    expect(await bridge.handle({ op: "getDevices" })).toEqual({ present: true });
  });

  test("forwards app APDUs to the backend and logs who answered", async () => {
    const bridge = new LedgerHidBridge({ backend, granted: true, model: "flex" });
    const reply = await send(bridge, Uint8Array.of(0x5a, 0x01, 0x00, 0x00, 0x00));
    expect(forwarded).toEqual([Uint8Array.of(0x5a, 0x01, 0x00, 0x00, 0x00)]);
    expect(hostRead(reply.packets ?? [])).toEqual(Uint8Array.of(0x01, 0x02, 0x90, 0x00));
    expect(bridge.log).toEqual([{ answeredBy: "device", cla: 0x5a, ins: 0x01, status: 0x9000 }]);
  });

  test("B0 A7 drops the device until it reconnects, without reaching the backend", async () => {
    const bridge = new LedgerHidBridge({
      backend,
      granted: true,
      model: "nanosp",
      reconnectMs: 20,
    });
    const reply = await send(bridge, Uint8Array.of(0xb0, 0xa7, 0x00, 0x00, 0x00));
    expect(reply.disconnect).toBe(true);
    expect(forwarded).toEqual([]);
    expect(await bridge.handle({ op: "getDevices" })).toEqual({ present: false });
    await expect(send(bridge, Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))).rejects.toThrow(
      "disconnected",
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(await bridge.handle({ op: "getDevices" })).toEqual({ present: true });
    expect(bridge.location()).toBe("dashboard");
  });
});

describe("Speculos endpoints and socket", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
  });

  test("reads only loopback endpoints and known models", () => {
    expect(speculosEndpointsFromEnv({})).toBeNull();
    expect(speculosEndpointsFromEnv({ BRAMBLE_SPECULOS_MODEL: "flex" })).toEqual({
      apduPort: 9999,
      apiUrl: "http://127.0.0.1:5000",
      host: "127.0.0.1",
      model: "flex",
    });
    expect(() => speculosEndpointsFromEnv({ BRAMBLE_SPECULOS_MODEL: "nanos" })).toThrow();
    expect(() =>
      speculosEndpointsFromEnv({
        BRAMBLE_SPECULOS_HOST: "10.0.0.2",
        BRAMBLE_SPECULOS_MODEL: "flex",
      }),
    ).toThrow("loopback");
    expect(() =>
      speculosEndpointsFromEnv({ BRAMBLE_SPECULOS_APDU_PORT: "0", BRAMBLE_SPECULOS_MODEL: "flex" }),
    ).toThrow("TCP port");
  });

  test("speaks Speculos's length-prefixed APDU framing", async () => {
    const received: Buffer[] = [];
    server = createServer((socket) => {
      socket.on("data", (chunk: Buffer) => {
        received.push(chunk);
        // Reply: length excludes the status word; split across two writes.
        socket.write(Buffer.from([0, 0, 0, 3, 0xaa]));
        socket.write(Buffer.from([0xbb, 0xcc, 0x90, 0x00]));
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const client = new SpeculosApdu({
      apduPort: port,
      apiUrl: "http://127.0.0.1:1",
      host: "127.0.0.1",
      model: "nanosp",
    });
    const reply = await client.exchange(Uint8Array.of(0x5a, 0x00, 0x00, 0x00, 0x00));
    client.close();
    expect(Buffer.concat(received)).toEqual(Buffer.from([0, 0, 0, 5, 0x5a, 0, 0, 0, 0]));
    expect(reply).toEqual(Uint8Array.of(0xaa, 0xbb, 0xcc, 0x90, 0x00));
  });

  test("a connection that drops mid-reply rejects instead of hanging", async () => {
    server = createServer((socket) => {
      socket.on("data", () => {
        socket.end(Buffer.from([0, 0, 0, 9, 0xaa]));
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const client = new SpeculosApdu({
      apduPort: typeof address === "object" && address ? address.port : 0,
      apiUrl: "http://127.0.0.1:1",
      host: "127.0.0.1",
      model: "flex",
    });
    await expect(client.exchange(Uint8Array.of(0x5a, 0, 0, 0, 0))).rejects.toThrow("closed");
    client.close();
  });
});
