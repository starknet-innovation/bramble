import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  getAvailableWallets: vi.fn(),
  getPreAuthorizedWallets: vi.fn(),
  waitForInjectedMcWallet: vi.fn(),
}));

vi.mock("get-starknet-core", () => ({
  getStarknet: () => ({
    disconnect: mocks.disconnect,
    getAvailableWallets: mocks.getAvailableWallets,
    getPreAuthorizedWallets: mocks.getPreAuthorizedWallets,
  }),
}));

vi.mock("./starknet-window", () => ({
  INJECTION_TIMEOUT_MS: 0,
  pickMcWallet: (wallets: readonly unknown[]) => wallets[0] ?? null,
  waitForInjectedMcWallet: mocks.waitForInjectedMcWallet,
}));

import { useWallet, WalletProvider } from "./WalletProvider";

type WalletEvent = "accountsChanged" | "networkChanged";

const makeWallet = () => {
  const listeners = new Map<WalletEvent, (...args: never[]) => void>();
  const account = { execute: vi.fn() };
  const request = vi.fn(async ({ type }: { readonly type: string }) => {
    if (type === "wallet_requestAccounts") {
      return ["0x1234"];
    }
    if (type === "wallet_requestChainId") {
      return "SN_MAIN";
    }
    return null;
  });
  return {
    account,
    id: "mc-wallet",
    isPreauthorized: vi.fn(async () => false),
    name: "MC Wallet",
    on: vi.fn((event: WalletEvent, listener: (...args: never[]) => void) => {
      listeners.set(event, listener);
    }),
    off: vi.fn((event: WalletEvent) => {
      listeners.delete(event);
    }),
    request,
    listeners,
    version: "1.0.0",
  };
};

const Probe = (): ReactNode => {
  const wallet = useWallet();
  return (
    <div>
      <button type="button" onClick={() => void wallet.connect()}>
        Connect
      </button>
      <span data-testid="address">{wallet.address ?? "disconnected"}</span>
      <span data-testid="chain">{wallet.chainId ?? "no-chain"}</span>
      <span role="alert">{wallet.error}</span>
    </div>
  );
};

const renderProvider = (): void => {
  render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  );
};

describe("WalletProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAvailableWallets.mockResolvedValue([]);
    mocks.getPreAuthorizedWallets.mockResolvedValue([]);
  });

  test("requests accounts and reacts to wallet account and network events", async () => {
    const wallet = makeWallet();
    mocks.waitForInjectedMcWallet.mockResolvedValue(wallet);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByTestId("address").textContent).toBe("0x1234"));
    expect(wallet.request).toHaveBeenCalledWith({ type: "wallet_requestAccounts" });
    expect(screen.getByTestId("chain").textContent).toBe("SN_MAIN");

    await act(async () => {
      wallet.listeners.get("accountsChanged")?.(["0xabcd"] as never);
      wallet.listeners.get("networkChanged")?.("SN_SEPOLIA" as never);
      await Promise.resolve();
    });
    expect(screen.getByTestId("address").textContent).toBe("0xabcd");
    expect(screen.getByTestId("chain").textContent).toBe("SN_SEPOLIA");
  });

  test("surfaces a rejected approval instead of falling back silently", async () => {
    const wallet = makeWallet();
    wallet.request.mockRejectedValueOnce(Object.assign(new Error("Connection rejected"), { code: 113 }));
    mocks.waitForInjectedMcWallet.mockResolvedValue(wallet);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Connection rejected"));
    expect(screen.getByTestId("address").textContent).toBe("disconnected");
  });
});
