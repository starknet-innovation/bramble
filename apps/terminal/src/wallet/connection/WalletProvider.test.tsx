import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { CallData } from "starknet";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  waitForInjectedBramble: vi.fn(),
}));

vi.mock("./starknet-window", () => ({
  INJECTION_TIMEOUT_MS: 0,
  waitForInjectedBramble: mocks.waitForInjectedBramble,
}));

import { useWallet, WalletProvider } from "./WalletProvider";

type WalletEvent = "accountsChanged" | "networkChanged";

const makeWallet = () => {
  const listeners = new Map<WalletEvent, (...args: never[]) => void>();
  const account = { execute: vi.fn() };
  const invoke = vi.fn(async () => ({ transaction_hash: "0xabc" }));
  const request = vi.fn(async ({ type }: { readonly type: string }) => {
    if (type === "wallet_requestAccounts") {
      return ["0x1234"];
    }
    if (type === "wallet_requestChainId") {
      return "SN_MAIN";
    }
    if (type === "wallet_addDeclareTransaction") {
      return { class_hash: "0x5", transaction_hash: "0x6" };
    }
    if (type === "wallet_addInvokeTransaction") {
      return invoke();
    }
    if (type === "wallet_watchAsset") {
      return true;
    }
    return null;
  });
  return {
    account,
    id: "bramble",
    isPreauthorized: vi.fn(async () => false),
    invoke,
    name: "Bramble",
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

const DeclareProbe = (): ReactNode => {
  const wallet = useWallet();
  const [result, setResult] = useState("idle");
  return (
    <div>
      <button type="button" onClick={() => void wallet.connect()}>
        Connect
      </button>
      <button
        type="button"
        onClick={() =>
          void wallet
            .declareContract({
              classHash: "0x5",
              compiledClassHash: "0x7",
              contractClass: { sierra_program: ["0x1"] },
            })
            .then((value) => setResult(value.transactionHash))
        }
      >
        Declare
      </button>
      <span data-testid="declare-result">{result}</span>
    </div>
  );
};

const TransactionProbe = ({
  reviewMode,
}: { readonly reviewMode?: "wallet" } = {}): ReactNode => {
  const wallet = useWallet();
  const [result, setResult] = useState("idle");
  return (
    <div>
      <button type="button" onClick={() => void wallet.connect()}>
        Connect
      </button>
      <button
        type="button"
        onClick={() =>
          void wallet
            .requestTransaction({
              calls: [
                {
                  contractAddress: "0x1",
                  entrypoint: "transfer",
                  calldata: CallData.compile(["0x2"]),
                },
              ],
              description: "Move one test asset.",
              details: [{ label: "Recipient", value: "0x2" }],
              ...(reviewMode === undefined ? {} : { reviewMode }),
              title: "Send test asset",
            })
            .then(
              (value) => setResult(value.transaction_hash),
              (cause: Error) => setResult(`rejected: ${cause.message}`),
            )
        }
      >
        {reviewMode === "wallet" ? "Fast send" : "Send"}
      </button>
      <span data-testid="transaction-address">{wallet.address ?? "disconnected"}</span>
      <span data-testid="transaction-result">{result}</span>
    </div>
  );
};

const WatchAssetProbe = (): ReactNode => {
  const wallet = useWallet();
  const [result, setResult] = useState("idle");
  return (
    <div>
      <button type="button" onClick={() => void wallet.connect()}>Connect</button>
      <button
        type="button"
        onClick={() =>
          void wallet
            .watchAsset({ address: "0x387e8", symbol: "vUSDC" })
            .then(() => setResult("tracked"))
        }
      >
        Track receipt
      </button>
      <span data-testid="watch-result">{result}</span>
    </div>
  );
};

describe("WalletProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("requests accounts and reacts to wallet account and network events", async () => {
    const wallet = makeWallet();
    mocks.waitForInjectedBramble.mockResolvedValue(wallet);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByTestId("address").textContent).toBe("0x1234"));
    expect(wallet.request).toHaveBeenCalledWith({ type: "wallet_requestAccounts" });
    expect(screen.getByTestId("chain").textContent).toBe("SN_MAIN");
    await waitFor(() => expect(wallet.listeners.has("accountsChanged")).toBe(true));

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
    mocks.waitForInjectedBramble.mockResolvedValue(wallet);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Connection rejected"));
    expect(screen.getByTestId("address").textContent).toBe("disconnected");
  });

  test("silently reconnects without opening a prompting wallet fallback", async () => {
    const wallet = makeWallet();
    const enable = vi.fn();
    Object.assign(wallet, { enable });
    wallet.isPreauthorized = vi.fn().mockResolvedValue(true);
    wallet.request.mockResolvedValueOnce([]);
    mocks.waitForInjectedBramble.mockResolvedValue(wallet);
    renderProvider();

    await waitFor(() =>
      expect(wallet.request).toHaveBeenCalledWith({
        params: { silent_mode: true },
        type: "wallet_requestAccounts",
      }),
    );
    expect(enable).not.toHaveBeenCalled();
    expect(screen.getByTestId("address").textContent).toBe("disconnected");
  });

  test("wraps Sierra declarations in the wallet RPC declare_transaction shape", async () => {
    const wallet = makeWallet();
    mocks.waitForInjectedBramble.mockResolvedValue(wallet);
    render(
      <WalletProvider>
        <DeclareProbe />
      </WalletProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(wallet.request).toHaveBeenCalledWith({ type: "wallet_requestAccounts" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Declare" }));
    expect(
      await screen.findByRole("heading", { name: "Declare Punk collection" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue in wallet" }));
    await waitFor(() => expect(screen.getByTestId("declare-result").textContent).toBe("0x6"));
    expect(wallet.request).toHaveBeenLastCalledWith({
      type: "wallet_addDeclareTransaction",
      params: {
        declare_transaction: {
          class_hash: "0x5",
          compiled_class_hash: "0x7",
          contract_class: { sierra_program: ["0x1"] },
        },
      },
    });
  });

  test("requests wallet-approved ERC20 tracking with metadata revalidated by the wallet", async () => {
    const wallet = makeWallet();
    mocks.waitForInjectedBramble.mockResolvedValue(wallet);
    render(
      <WalletProvider>
        <WatchAssetProbe />
      </WalletProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(wallet.request).toHaveBeenCalledWith({ type: "wallet_requestAccounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Track receipt" }));
    await waitFor(() => expect(screen.getByTestId("watch-result").textContent).toBe("tracked"));
    expect(wallet.request).toHaveBeenLastCalledWith({
      params: { options: { address: "0x387e8", symbol: "vUSDC" }, type: "ERC20" },
      type: "wallet_watchAsset",
    });
  });

  test("reviews calls before execute and supports a safe retry after rejection", async () => {
    const wallet = makeWallet();
    wallet.invoke
      .mockRejectedValueOnce(Object.assign(new Error("User rejected"), { code: 113 }))
      .mockResolvedValueOnce({ transaction_hash: "0xabc" });
    mocks.waitForInjectedBramble.mockResolvedValue(wallet);
    render(
      <WalletProvider>
        <TransactionProbe />
      </WalletProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(screen.getByTestId("transaction-address").textContent).toBe("0x1234"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("heading", { name: "Send test asset" })).toBeTruthy();
    expect(wallet.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue in wallet" }));
    expect(
      await screen.findByText("The request was declined in the wallet. Nothing was submitted."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(screen.getByTestId("transaction-result").textContent).toBe("0xabc"),
    );
    expect(wallet.invoke).toHaveBeenCalledTimes(2);
    expect(wallet.request).toHaveBeenLastCalledWith({
      type: "wallet_addInvokeTransaction",
      params: {
        invoke_transaction: [
          {
            calldata: ["2"],
            contract_address: "0x1",
            entry_point: "transfer",
          },
        ],
      },
    });
    const request = wallet.request.mock.calls.at(-1)?.[0] as {
      readonly params: { readonly invoke_transaction: readonly { readonly calldata: unknown }[] };
    };
    expect(Reflect.ownKeys(request.params.invoke_transaction[0]?.calldata ?? [])).toEqual([
      "0",
      "length",
    ]);
  });

  test("hands an already-reviewed request to the wallet without a duplicate confirmation", async () => {
    const wallet = makeWallet();
    let release!: () => void;
    wallet.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ transaction_hash: "0xabc" });
        }),
    );
    mocks.waitForInjectedBramble.mockResolvedValue(wallet);
    render(
      <WalletProvider>
        <TransactionProbe reviewMode="wallet" />
      </WalletProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(screen.getByTestId("transaction-address").textContent).toBe("0x1234"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Fast send" }));
    await waitFor(() => expect(wallet.invoke).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Continue in wallet" })).toBeNull();
    expect(screen.getByText("Request sent to Bramble")).toBeTruthy();
    await act(async () => release());
    await waitFor(() =>
      expect(screen.getByTestId("transaction-result").textContent).toBe("0xabc"),
    );
  });

  describe("a wallet account or network change (Sherlock 222)", () => {
    const CHANGED = "rejected: Wallet account or network changed before approval.";

    const connectTransaction = async (
      wallet: ReturnType<typeof makeWallet>,
      reviewMode?: "wallet",
    ): Promise<void> => {
      mocks.waitForInjectedBramble.mockResolvedValue(wallet);
      render(
        <WalletProvider>
          <TransactionProbe {...(reviewMode === undefined ? {} : { reviewMode })} />
        </WalletProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      await waitFor(() =>
        expect(screen.getByTestId("transaction-address").textContent).toBe("0x1234"),
      );
      await waitFor(() => expect(wallet.listeners.has("accountsChanged")).toBe(true));
    };

    test("drops a request under review instead of sending it for the new account", async () => {
      const wallet = makeWallet();
      await connectTransaction(wallet);
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(await screen.findByRole("heading", { name: "Send test asset" })).toBeTruthy();

      await act(async () => {
        wallet.listeners.get("accountsChanged")?.(["0xabcd"] as never);
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(screen.getByTestId("transaction-result").textContent).toBe(CHANGED),
      );
      expect(screen.queryByRole("button", { name: "Continue in wallet" })).toBeNull();
      expect(wallet.invoke).not.toHaveBeenCalled();
    });

    test("drops a request under review when only the network changes", async () => {
      const wallet = makeWallet();
      await connectTransaction(wallet);
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(await screen.findByRole("heading", { name: "Send test asset" })).toBeTruthy();

      await act(async () => {
        wallet.listeners.get("networkChanged")?.("SN_SEPOLIA" as never);
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(screen.getByTestId("transaction-result").textContent).toBe(CHANGED),
      );
      expect(wallet.invoke).not.toHaveBeenCalled();
    });

    test("leaves a request the wallet is handling to the wallet, but never retries it", async () => {
      const wallet = makeWallet();
      let decline!: () => void;
      wallet.invoke.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            decline = () => reject(Object.assign(new Error("User rejected"), { code: 113 }));
          }),
      );
      await connectTransaction(wallet, "wallet");
      fireEvent.click(screen.getByRole("button", { name: "Fast send" }));
      await waitFor(() => expect(wallet.invoke).toHaveBeenCalledTimes(1));

      await act(async () => {
        wallet.listeners.get("accountsChanged")?.(["0xabcd"] as never);
        await Promise.resolve();
      });
      expect(screen.getByText("Request sent to Bramble")).toBeTruthy();

      await act(async () => decline());
      fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

      await waitFor(() =>
        expect(screen.getByTestId("transaction-result").textContent).toBe(CHANGED),
      );
      expect(wallet.invoke).toHaveBeenCalledTimes(1);
    });
  });
});
