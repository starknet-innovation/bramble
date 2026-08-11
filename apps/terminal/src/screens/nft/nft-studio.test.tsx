import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PUNK_MAINNET_CONTRACT } from "../../nft/punk-contract";

const wallet = vi.hoisted(() => ({
  requestTransaction: vi.fn(),
  value: {
    account: null,
    address: "0x1234",
    chainId: "SN_MAIN",
    walletName: "MC Wallet",
    isConnected: true,
    isConnecting: false,
    error: null,
    clearError: vi.fn(),
    connect: vi.fn(),
    declareContract: vi.fn(),
    requestTransaction: vi.fn(),
    disconnect: vi.fn(),
  },
}));

const runtime = vi.hoisted(() => ({
  waitForPunkTransaction: vi.fn(),
}));

vi.mock("../../wallet/connection/WalletProvider", () => ({
  useWallet: () => wallet.value,
}));

vi.mock("../../nft/punk-runtime", async () => {
  const actual = await vi.importActual<typeof import("../../nft/punk-runtime")>(
    "../../nft/punk-runtime",
  );
  return {
    ...actual,
    waitForPunkTransaction: runtime.waitForPunkTransaction,
  };
});

import NftStudio from "./NftStudio";

const transaction = (hash: string) => ({ transaction_hash: hash });

describe("NFT Studio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wallet.value.address = "0x1234";
    wallet.value.chainId = "SN_MAIN";
    wallet.value.isConnected = true;
    wallet.value.requestTransaction = wallet.requestTransaction;
    wallet.requestTransaction.mockResolvedValue(transaction("0xaaa"));
    runtime.waitForPunkTransaction.mockResolvedValue(undefined);
  });

  const renderStudio = (): void => {
    render(<NftStudio onNavigate={vi.fn()} />);
  };

  test("renders a mint-only Mainnet surface pinned to the deployed collection", () => {
    renderStudio();

    expect(screen.getByRole("heading", { name: "Choose a Punk. Mint it on Mainnet." })).toBeTruthy();
    expect((screen.getByLabelText("Deployed collection") as HTMLInputElement).value).toBe(
      "0xda8b762dcb301e6b144e521ede1e2870ce9c723e5b4e6856c870ad341098a9",
    );
    expect(screen.getByAltText("CryptoPunk catalog artwork #0")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Send" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Launch" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Launch collection/ })).toBeNull();
  });

  test("mints selected metadata from the deployed contract", async () => {
    renderStudio();
    fireEvent.change(screen.getByLabelText("Punk id"), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText("Mint to"), { target: { value: "0x5678" } });
    fireEvent.click(screen.getByRole("button", { name: "Mint Punk #42" }));

    await waitFor(() => expect(wallet.requestTransaction).toHaveBeenCalledTimes(1));
    expect(wallet.requestTransaction.mock.calls[0]?.[0]?.calls?.[0]).toMatchObject({
      contractAddress: PUNK_MAINNET_CONTRACT,
      entrypoint: "mint",
    });
    await screen.findByText("Punk #42 minted to 0x5678.");
    expect(runtime.waitForPunkTransaction).toHaveBeenCalledWith("SN_MAIN", "0xaaa");
  });

  test("blocks minting while the connected wallet is off Mainnet", () => {
    wallet.value.chainId = "SN_SEPOLIA";
    renderStudio();

    const button = screen.getByRole("button", { name: "Switch to Mainnet" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(
        "Switch your wallet to Starknet Mainnet to mint from this deployed collection.",
      ),
    ).toBeTruthy();
    expect(wallet.requestTransaction).not.toHaveBeenCalled();
  });
});
