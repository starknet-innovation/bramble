import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { type RawData, WebSocketServer } from "ws";
import { encodeBridgeStatus } from "./bridge-protocol";

/** Configuration for the Vite-only Extended WebSocket bridge. */
export type ExtendedBridgeOptions = {
  readonly backoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly prefix: string;
  readonly server: HttpServer;
  readonly target: string;
  readonly userAgent: string;
};

/** Handle used by Vite shutdown/restart to release bridge sockets and listeners. */
export type ExtendedBridgeHandle = {
  readonly close: () => void;
};

const send = (socket: WebSocket, data: RawData | string, binary = false): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(data, { binary });
  }
};

/**
 * Attaches a managed WebSocket bridge to Vite's HTTP server. Browser sockets
 * remain open while the bridge reconnects Extended upstream with sanitized
 * server-side headers, preventing transient upstream resets from surfacing as
 * failed browser handshakes.
 */
export const attachExtendedWebSocketBridge = (
  options: ExtendedBridgeOptions,
): ExtendedBridgeHandle => {
  const sockets = new Set<WebSocket>();
  const webSocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const baseBackoff = options.backoffMs ?? 500;
  const maxBackoff = options.maxBackoffMs ?? 15_000;
  let disposed = false;

  const bridge = (browser: WebSocket, upstreamUrl: string): void => {
    sockets.add(browser);
    let upstream: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let browserClosed = false;

    const report = (status: "connecting" | "open" | "closed"): void =>
      send(browser, encodeBridgeStatus(status));

    const scheduleReconnect = (): void => {
      if (disposed || browserClosed || reconnectTimer !== undefined) {
        return;
      }
      report("closed");
      const delay = Math.min(maxBackoff, baseBackoff * 2 ** attempt);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connectUpstream();
      }, delay);
    };

    const connectUpstream = (): void => {
      if (disposed || browserClosed) {
        return;
      }
      report("connecting");
      const socket = new WebSocket(upstreamUrl, {
        headers: { "User-Agent": options.userAgent },
        perMessageDeflate: false,
      });
      upstream = socket;
      socket.on("open", () => {
        if (upstream !== socket || browserClosed) {
          socket.close();
          return;
        }
        attempt = 0;
        report("open");
      });
      socket.on("message", (data, binary) => send(browser, data, binary));
      socket.on("error", () => {
        if (upstream === socket) {
          socket.terminate();
        }
      });
      socket.on("close", () => {
        if (upstream === socket) {
          upstream = null;
          scheduleReconnect();
        }
      });
    };

    browser.on("message", (data, binary) => {
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary });
      }
    });
    browser.on("close", () => {
      browserClosed = true;
      sockets.delete(browser);
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
      }
      upstream?.terminate();
      upstream = null;
    });
    browser.on("error", () => browser.close());
    connectUpstream();
  };

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const path = request.url ?? "";
    if (!path.startsWith(`${options.prefix}/`)) {
      return;
    }
    const upstreamPath = path.slice(options.prefix.length);
    if (!upstreamPath.startsWith("/stream.extended.exchange/v1/")) {
      socket.destroy();
      return;
    }
    const upstreamUrl = new URL(upstreamPath, options.target).toString();
    webSocketServer.handleUpgrade(request, socket, head, (browser) =>
      bridge(browser, upstreamUrl),
    );
  };

  options.server.prependListener("upgrade", onUpgrade);

  return {
    close: (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      options.server.removeListener("upgrade", onUpgrade);
      for (const socket of sockets) {
        socket.terminate();
      }
      sockets.clear();
      webSocketServer.close();
    },
  };
};
