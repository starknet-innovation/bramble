/**
 * Loopback dapp for the mainnet wallet suite. It holds no signing key. The
 * extension still has to approve every connect, sign, and invoke.
 */
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { buildErc20TransferCall } from "@bramble/starknet/rpc";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { openPendingWalletSurface } from "../../e2e/wallet-helpers";
import { mainnetSignTypedData } from "../local-mainnet-chain";
import { checkDisplayedStrkFee, MAX_TX_FEE_STRK } from "../local-mainnet-limits";

/** A running loopback dapp. */
export type WalletDapp = {
  readonly close: () => Promise<void>;
  readonly origin: string;
  readonly url: string;
};

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

const feltList = (calldata: unknown): readonly string[] => {
  if (!Array.isArray(calldata)) {
    throw new Error("Transfer calldata was not a list.");
  }
  return calldata.map((felt) => {
    if (typeof felt !== "string" && typeof felt !== "bigint" && typeof felt !== "number") {
      throw new Error("Transfer calldata was not a list of felts.");
    }
    return String(felt);
  });
};

const callJson = (token: string, recipient: string, amount: bigint): string => {
  const call = buildErc20TransferCall(token, recipient, amount);
  return JSON.stringify({
    calldata: feltList(call.calldata),
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
  });
};

const html = (token: string, recipient: string, amount: bigint): string => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Bramble mainnet wallet dapp</title></head>
  <body>
    <p data-testid="provider-status">missing</p>
    <button data-testid="connect" type="button">Connect</button>
    <button data-testid="sign" type="button">Sign</button>
    <button data-testid="invoke" type="button">Invoke</button>
    <button data-testid="multicall" type="button">Multicall</button>
    <output data-testid="connect-result"></output>
    <output data-testid="sign-result"></output>
    <output data-testid="invoke-result"></output>
    <output data-testid="multicall-result"></output>
    <script>
      const write = (id, value) => {
        document.querySelector('[data-testid="' + id + '"]').textContent = value;
      };
      const provider = () => window.starknet_bramble;
      const TYPED = ${JSON.stringify(mainnetSignTypedData)};
      const CALL = ${callJson(token, recipient, amount)};
      const refresh = () => {
        const wallet = provider();
        write("provider-status", wallet ? [wallet.id, wallet.name, wallet.version].join("|") : "missing");
      };
      window.addEventListener("starknet#initialized", refresh);
      refresh();
      const run = async (id, task) => {
        write(id, "pending");
        try {
          write(id, JSON.stringify({ result: await task(), status: "resolved" }));
        } catch (error) {
          write(id, JSON.stringify({ message: error.message, status: "rejected" }));
        }
      };
      document.querySelector('[data-testid="connect"]').addEventListener("click", () =>
        run("connect-result", () => provider().enable()),
      );
      document.querySelector('[data-testid="sign"]').addEventListener("click", () =>
        run("sign-result", () => provider().request({ params: { typed_data: TYPED }, type: "wallet_signTypedData" })),
      );
      document.querySelector('[data-testid="invoke"]').addEventListener("click", () =>
        run("invoke-result", () => provider().request({ params: { calls: [CALL] }, type: "wallet_addInvokeTransaction" })),
      );
      document.querySelector('[data-testid="multicall"]').addEventListener("click", () =>
        run("multicall-result", () => provider().request({ params: { calls: [CALL, CALL] }, type: "wallet_addInvokeTransaction" })),
      );
    </script>
  </body>
</html>`;

/**
 * Serves the dapp on a random loopback port. `amount` is the raw self-transfer.
 */
export const startWalletDapp = async (
  token: string,
  recipient: string,
  amount: bigint,
): Promise<WalletDapp> => {
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html(token, recipient, amount));
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
    throw new Error("mainnet wallet dapp did not expose a port");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return { close: () => closeServer(server, sockets), origin, url: `${origin}/` };
};

const outputText = async (page: Page, testId: string): Promise<string> => {
  await expect
    .poll(async () => page.locator(`[data-testid="${testId}"]`).textContent(), {
      timeout: 180_000,
    })
    .not.toBe("pending");
  return (await page.locator(`[data-testid="${testId}"]`).textContent()) ?? "";
};

/**
 * Reads a resolved dapp output. A rejection throws its message.
 */
export const resolvedOutput = async (page: Page, testId: string): Promise<unknown> => {
  const text = await outputText(page, testId);
  const parsed = JSON.parse(text) as { readonly message?: string; readonly status?: string };
  if (parsed.status !== "resolved") {
    throw new Error(parsed.message ?? "The dapp request was rejected.");
  }
  return JSON.parse(text) as unknown;
};

/**
 * Approves the open transaction card after its STRK fee is on screen and
 * inside the cap. The gasless choices on the same card are not clicked.
 */
export const approvePricedTransaction = async (sidepanel: Page, origin: string): Promise<void> => {
  await openPendingWalletSurface(sidepanel, 90_000);
  await expect(sidepanel.getByText("Transaction request", { exact: true }).first()).toBeVisible();
  await expect(sidepanel.getByTitle(origin).first()).toBeVisible();
  await expect(sidepanel.locator(".review-fee").first()).toContainText("Estimated fee:", {
    timeout: 90_000,
  });
  const text = (await sidepanel.locator(".review-fee").allTextContents()).join(" ");
  if (text.includes("less than this transaction needs")) {
    throw new Error(
      "The account does not have enough STRK for this transaction and its fee. Nothing was submitted.",
    );
  }
  const check = checkDisplayedStrkFee(text);
  if (check.kind !== "ok") {
    const why =
      check.kind === "over"
        ? `the displayed fee is above the ${MAX_TX_FEE_STRK} STRK cap`
        : "the card did not show a STRK fee";
    throw new Error(`Refusing to approve: ${why}. Nothing was submitted.`);
  }
  const approve = sidepanel.locator('[data-approval-action="approve"]:not([data-gasless-token])');
  await expect(approve).toBeEnabled();
  await approve.click();
};
