// @vitest-environment node

import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { parseBridgeStatus } from "./bridge-protocol";
import { attachExtendedWebSocketBridge } from "./dev-bridge";

const listen = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }
  return address.port;
};

describe("Extended development WebSocket bridge", () => {
  it("keeps the browser socket open and resumes forwarding after an upstream reset", async () => {
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => upstream.once("listening", resolve));
    const upstreamAddress = upstream.address();
    if (typeof upstreamAddress === "string") {
      throw new Error("Upstream test server did not bind to a TCP port");
    }

    const upstreamSockets: WebSocket[] = [];
    upstream.on("connection", (socket) => {
      upstreamSockets.push(socket);
      socket.send(`payload-${upstreamSockets.length}`);
    });

    const localServer = createServer();
    const bridge = attachExtendedWebSocketBridge({
      backoffMs: 5,
      maxBackoffMs: 10,
      prefix: "/proxy/extended-ws",
      server: localServer,
      target: `ws://127.0.0.1:${upstreamAddress.port}`,
      userAgent: "bridge-test",
    });
    const localPort = await listen(localServer);
    const browser = new WebSocket(
      `ws://127.0.0.1:${localPort}/proxy/extended-ws/stream.extended.exchange/v1/orderbooks/BTC-USD`,
    );
    const messages: string[] = [];
    let browserCloses = 0;
    browser.on("message", (data) => messages.push(data.toString()));
    browser.on("close", () => {
      browserCloses += 1;
    });

    try {
      await vi.waitFor(() => {
        expect(upstreamSockets).toHaveLength(1);
        expect(messages).toContain("payload-1");
      });
      upstreamSockets[0]!.terminate();
      await vi.waitFor(() => {
        expect(upstreamSockets).toHaveLength(2);
        expect(messages).toContain("payload-2");
      });

      const statuses = messages.map(parseBridgeStatus).filter((status) => status !== null);
      expect(statuses.filter((status) => status === "open")).toHaveLength(2);
      expect(statuses).toContain("closed");
      expect(browserCloses).toBe(0);
      expect(browser.readyState).toBe(WebSocket.OPEN);
    } finally {
      browser.terminate();
      bridge.close();
      for (const socket of upstreamSockets) {
        socket.terminate();
      }
      await Promise.all([
        new Promise<void>((resolve) => localServer.close(() => resolve())),
        new Promise<void>((resolve) => upstream.close(() => resolve())),
      ]);
    }
  });
});
