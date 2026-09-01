/**
 * Loopback dapp for the opt-in mainnet suite. It exposes no signing material;
 * tests drive only the injected provider and keep every wallet decision in the
 * extension approval surface.
 */
import { createServer } from "node:http";
import type { Socket } from "node:net";

/**
 * Running live-test dapp server metadata.
 */
export type LiveDappServer = {
  readonly close: () => Promise<void>;
  readonly origin: string;
  readonly url: string;
};

const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>MC Wallet STRK20 mainnet E2E</title></head>
  <body><p data-testid="provider-status">missing</p>
    <script>
      const refresh = () => {
        const wallet = window.starknet_bramble;
        document.querySelector('[data-testid="provider-status"]').textContent =
          wallet ? [wallet.id, wallet.name, wallet.version].join("|") : "missing";
      };
      window.addEventListener("starknet#initialized", refresh);
      refresh();
    </script>
  </body>
</html>`;

const closeServer = (
  server: ReturnType<typeof createServer>,
  sockets: ReadonlySet<Socket>,
): Promise<void> =>
  new Promise((resolveClose, rejectClose) => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });

/**
 * Starts the isolated dapp on a random loopback port.
 */
export const startLiveDapp = async (): Promise<LiveDappServer> => {
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server, sockets);
    throw new Error("live test dapp did not expose a port");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return { close: () => closeServer(server, sockets), origin, url: `${origin}/` };
};
