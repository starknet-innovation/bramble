/**
 * Local loopback dapp used by extension E2E tests to exercise the injected
 * provider from a real page origin.
 */
import { createServer } from "node:http";
import type { Socket } from "node:net";

/**
 * Running test dapp server metadata.
 */
export type TestDappServer = {
  readonly close: () => Promise<void>;
  readonly origin: string;
  readonly url: string;
};

const dappHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>MC Wallet E2E Dapp</title>
  </head>
  <body>
    <p data-testid="provider-status">missing</p>
    <button data-testid="detect" type="button">Detect</button>
    <button data-testid="connect" type="button">Connect</button>
    <button data-testid="preauth" type="button">Preauthorized</button>
    <output data-testid="connect-result"></output>
    <output data-testid="preauth-result"></output>
    <script>
      const write = (testId, value) => {
        document.querySelector('[data-testid="' + testId + '"]').textContent = value;
      };
      const provider = () => window.starknet_mcWallet;
      const refreshProvider = () => {
        const wallet = provider();
        write(
          "provider-status",
          wallet ? [wallet.id, wallet.name, wallet.version].join("|") : "missing",
        );
      };
      window.addEventListener("starknet#initialized", refreshProvider);
      refreshProvider();
      document.querySelector('[data-testid="detect"]').addEventListener("click", refreshProvider);
      document.querySelector('[data-testid="connect"]').addEventListener("click", async () => {
        write("connect-result", "pending");
        try {
          const accounts = await provider().enable();
          write("connect-result", JSON.stringify({ status: "resolved", accounts }));
        } catch (error) {
          write("connect-result", JSON.stringify({ status: "rejected", message: error.message }));
        }
      });
      document.querySelector('[data-testid="preauth"]').addEventListener("click", async () => {
        write("preauth-result", String(await provider().isPreauthorized()));
      });
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
 * Starts the local dapp server on a random loopback port.
 */
export const startTestDapp = async (): Promise<TestDappServer> => {
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
    });
    response.end(dappHtml);
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
    throw new Error("test dapp server did not expose a port");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    close: () => closeServer(server, sockets),
    origin,
    url: `${origin}/`,
  };
};
