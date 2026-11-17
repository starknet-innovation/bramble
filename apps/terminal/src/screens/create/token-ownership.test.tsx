import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const SEPOLIA = "0x534e5f5345504f4c4941";
const CONTRACT = "0x5ac53c4a815b3e2d614b1ad31bf8c80ea841cdcc4499976cfc5e95534612027";
const ME = "0x77dfdc45ba4695eac4c961f3d9bf820ed7e925a44d9963de7b7a0daf8768af0";
const NEW_OWNER = "0x57c50f71ba754809e76b2024ac6983130c50e08d237a3d0f1af5d227f11a767";

const wallet = vi.hoisted(() => ({
  requestTransaction: vi.fn(),
  value: {
    address: "" as string | null,
    chainId: "" as string | null,
    isConnected: true,
    requestTransaction: vi.fn(),
  },
}));

const runtime = vi.hoisted(() => ({
  assertOwnerIsAccount: vi.fn(),
  confirmOwnershipChange: vi.fn(),
  readContractOwnership: vi.fn(),
}));

vi.mock("../../wallet/connection/WalletProvider", () => ({ useWallet: () => wallet.value }));
vi.mock("../../create/ownership-runtime", () => runtime);

import TokenOwnership from "./TokenOwnership";

const owned = (owner: string) => ({ contract: CONTRACT, owner, standard: "erc721" as const });

const check = async (): Promise<void> => {
  fireEvent.change(screen.getByLabelText("Contract"), { target: { value: CONTRACT } });
  fireEvent.click(screen.getByRole("button", { name: "Check owner" }));
  await screen.findByText("ERC721Upgradeable");
};

const lastRequest = () => wallet.requestTransaction.mock.calls.at(-1)?.[0];

describe("Ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(wallet.value, {
      address: ME,
      chainId: SEPOLIA,
      isConnected: true,
      requestTransaction: wallet.requestTransaction,
    });
    wallet.requestTransaction.mockResolvedValue({ transaction_hash: "0xabc" });
    runtime.readContractOwnership.mockResolvedValue(owned(ME));
    runtime.assertOwnerIsAccount.mockResolvedValue(undefined);
    runtime.confirmOwnershipChange.mockResolvedValue(undefined);
  });

  test("transfer sends exactly transfer_ownership(new owner) and reports it only after the chain shows it", async () => {
    let settle: () => void = () => undefined;
    runtime.confirmOwnershipChange.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));
    render(<TokenOwnership createdAddress={null} />);
    await check();
    expect(runtime.readContractOwnership).toHaveBeenCalledWith(SEPOLIA, CONTRACT);
    expect(screen.getByText(`${ME} (you)`)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("New owner"), { target: { value: NEW_OWNER } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Waiting for Starknet"));
    expect(runtime.assertOwnerIsAccount).toHaveBeenCalledWith(SEPOLIA, NEW_OWNER);
    expect(wallet.requestTransaction).toHaveBeenCalledTimes(1);
    const request = lastRequest();
    expect(request.calls).toEqual([
      { calldata: [NEW_OWNER], contractAddress: CONTRACT, entrypoint: "transfer_ownership" },
    ]);
    expect(request.title).toBe("Transfer contract ownership");
    expect(request.reviewMode).toBe("terminal");
    expect(request.warning).toBeUndefined();
    expect(request.details).toEqual([
      { label: "Contract", value: CONTRACT },
      { label: "Current owner", value: ME },
      { label: "New owner", value: NEW_OWNER },
      { label: "Call", value: `transfer_ownership(${NEW_OWNER})` },
    ]);
    expect(screen.queryByText(/Ownership moved/)).toBeNull();

    settle();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Ownership moved to"));
    expect(runtime.confirmOwnershipChange).toHaveBeenCalledWith(SEPOLIA, "0xabc", CONTRACT, NEW_OWNER);
    // The connected account no longer owns it, so the actions are gone.
    expect(screen.queryByRole("button", { name: "Transfer ownership" })).toBeNull();
    expect(screen.getByText(NEW_OWNER)).toBeTruthy();
  });

  test("renounce takes a second, explicit confirm before the wallet sees anything", async () => {
    render(<TokenOwnership createdAddress={null} />);
    await check();
    fireEvent.click(screen.getByRole("button", { name: "Renounce ownership" }));
    expect(wallet.requestTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Confirm renounce" }).textContent).toContain("cannot be undone");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm renounce" })).toBeNull();
    expect(wallet.requestTransaction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Renounce ownership" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm renounce" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Ownership renounced."));
    const request = lastRequest();
    expect(request.calls).toEqual([{ calldata: [], contractAddress: CONTRACT, entrypoint: "renounce_ownership" }]);
    expect(request.title).toBe("Renounce contract ownership");
    expect(request.warning).toBe("This cannot be undone.");
    expect(request.details).toContainEqual({ label: "New owner", value: "None" });
    expect(runtime.assertOwnerIsAccount).not.toHaveBeenCalled();
    expect(runtime.confirmOwnershipChange).toHaveBeenCalledWith(SEPOLIA, "0xabc", CONTRACT, "0x0");
    expect(screen.getByText("None — renounced")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Renounce/ })).toBeNull();
  });

  test("the wallet hand-off re-reads the owner and stops if it changed", async () => {
    render(<TokenOwnership createdAddress={null} />);
    await check();
    fireEvent.change(screen.getByLabelText("New owner"), { target: { value: NEW_OWNER } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
    await waitFor(() => expect(wallet.requestTransaction).toHaveBeenCalled());
    const { handoffCheck } = lastRequest();
    await expect(handoffCheck()).resolves.toBeUndefined();
    runtime.readContractOwnership.mockResolvedValue(owned(NEW_OWNER));
    await expect(handoffCheck()).rejects.toThrow("Your account no longer owns this contract.");
  });

  test("a contract owned by someone else offers no actions", async () => {
    runtime.readContractOwnership.mockResolvedValue(owned(NEW_OWNER));
    render(<TokenOwnership createdAddress={null} />);
    await check();
    expect(screen.getByText("Connect the owner account to change ownership.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Transfer ownership" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Renounce ownership" })).toBeNull();
  });

  test("an empty new-owner address is refused before the wallet", async () => {
    runtime.assertOwnerIsAccount.mockRejectedValue(new Error("No account is deployed at the new owner address."));
    render(<TokenOwnership createdAddress={null} />);
    await check();
    fireEvent.change(screen.getByLabelText("New owner"), { target: { value: NEW_OWNER } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("No account is deployed"));
    expect(wallet.requestTransaction).not.toHaveBeenCalled();
  });

  test("the current owner and the contract itself are refused as new owners", async () => {
    render(<TokenOwnership createdAddress={null} />);
    await check();
    for (const [value, message] of [
      [ME, "That account already owns this contract."],
      [CONTRACT, "The contract can't own itself."],
    ] as const) {
      fireEvent.change(screen.getByLabelText("New owner"), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain(message));
    }
    expect(wallet.requestTransaction).not.toHaveBeenCalled();
  });

  test("an unconfirmed change is an error with the transaction link, never success", async () => {
    runtime.confirmOwnershipChange.mockRejectedValue(
      new Error("The contract doesn't show the expected owner after this transaction."),
    );
    render(<TokenOwnership createdAddress={null} />);
    await check();
    fireEvent.click(screen.getByRole("button", { name: "Renounce ownership" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm renounce" }));
    await waitFor(() => expect(screen.getByRole("status").className).toContain("studio-status--error"));
    expect(screen.getByRole("status").textContent).toContain(
      "Couldn't confirm the change. Check the transaction. (The contract doesn't show the expected owner after this transaction.)",
    );
    expect(screen.getByRole("link", { name: /View transaction/ }).getAttribute("href")).toContain("sepolia.");
    expect(screen.getByText(`${ME} (you)`)).toBeTruthy();
  });

  test("a lost reply after submission says the result is unconfirmed, not failed", async () => {
    runtime.confirmOwnershipChange.mockRejectedValue(new TypeError("fetch failed"));
    render(<TokenOwnership createdAddress={null} />);
    await check();
    fireEvent.click(screen.getByRole("button", { name: "Renounce ownership" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm renounce" }));
    await waitFor(() => expect(screen.getByRole("status").className).toContain("studio-status--error"));
    expect(screen.getByRole("status").textContent).toContain(
      "Couldn't confirm the change. Check the transaction. (fetch failed)",
    );
    expect(screen.getByRole("status").textContent).not.toMatch(/failed to|not sent/i);
    expect(screen.getByRole("link", { name: /View transaction/ })).toBeTruthy();
  });

  test("the hand-off refuses a request built before the wallet switched", async () => {
    let settle: () => void = () => undefined;
    runtime.assertOwnerIsAccount.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));
    const view = render(<TokenOwnership createdAddress={null} />);
    await check();
    fireEvent.change(screen.getByLabelText("New owner"), { target: { value: NEW_OWNER } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
    // The wallet moves to Mainnet while the new owner is still being checked.
    wallet.value.chainId = "0x534e5f4d41494e";
    view.rerender(<TokenOwnership createdAddress={null} />);
    settle();
    await waitFor(() => expect(wallet.requestTransaction).toHaveBeenCalled());
    await expect(lastRequest().handoffCheck()).rejects.toThrow("Wallet account or network changed before approval.");
    expect(runtime.readContractOwnership).toHaveBeenCalledTimes(1);
  });

  test("the hand-off refuses a switch during its own owner read", async () => {
    const view = render(<TokenOwnership createdAddress={null} />);
    await check();
    fireEvent.click(screen.getByRole("button", { name: "Renounce ownership" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm renounce" }));
    await waitFor(() => expect(wallet.requestTransaction).toHaveBeenCalled());
    const { handoffCheck } = lastRequest();
    runtime.readContractOwnership.mockImplementation(async () => {
      wallet.value.address = NEW_OWNER;
      view.rerender(<TokenOwnership createdAddress={null} />);
      return owned(ME);
    });
    await expect(handoffCheck()).rejects.toThrow("Wallet account or network changed before approval.");
  });

  test("a wallet switch drops the owner read for the old account or network", async () => {
    const view = render(<TokenOwnership createdAddress={null} />);
    await check();
    wallet.value.address = NEW_OWNER;
    view.rerender(<TokenOwnership createdAddress={null} />);
    expect(screen.queryByText("ERC721Upgradeable")).toBeNull();
    expect(screen.queryByRole("button", { name: "Transfer ownership" })).toBeNull();
  });

  test("Mainnet is refused before any read while Create is Sepolia only", async () => {
    wallet.value.chainId = "0x534e5f4d41494e";
    render(<TokenOwnership createdAddress={null} />);
    fireEvent.change(screen.getByLabelText("Contract"), { target: { value: CONTRACT } });
    fireEvent.click(screen.getByRole("button", { name: "Check owner" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Switch your wallet to Starknet Sepolia."),
    );
    expect(runtime.readContractOwnership).not.toHaveBeenCalled();
  });

  test("the contract just created fills the contract field", async () => {
    render(<TokenOwnership createdAddress={CONTRACT} />);
    expect((screen.getByLabelText("Contract") as HTMLInputElement).value).toBe(CONTRACT);
    fireEvent.click(screen.getByRole("button", { name: "Check owner" }));
    await screen.findByText("ERC721Upgradeable");
  });
});
