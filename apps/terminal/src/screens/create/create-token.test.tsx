import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { constants } from "starknet";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TOKEN_PRESETS } from "../../create/token-presets";

const wallet = vi.hoisted(() => ({
  requestTransaction: vi.fn(),
  value: {
    account: null,
    address: "0x1234" as string | null,
    chainId: "0x534e5f5345504f4c4941" as string | null,
    walletName: "Bramble",
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

const runtime = vi.hoisted(() => ({ assertErc1155Recipient: vi.fn(), confirmTokenDeployment: vi.fn() }));

vi.mock("../../wallet/connection/WalletProvider", () => ({
  useWallet: () => wallet.value,
}));

vi.mock("../../create/create-runtime", async () => {
  const actual = await vi.importActual<typeof import("../../create/create-runtime")>(
    "../../create/create-runtime",
  );
  return { ...actual, confirmTokenDeployment: runtime.confirmTokenDeployment };
});

vi.mock("../../create/recipient-check", () => ({ assertErc1155Recipient: runtime.assertErc1155Recipient }));

import CreateToken from "./CreateToken";

const salts = ["0x51", "0x52", "0x53"];

const renderCreate = (): void => {
  let next = 0;
  render(<CreateToken makeSalt={() => salts[next++] ?? "0x99"} onNavigate={vi.fn()} />);
};

const fill = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

describe("Create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wallet.value.address = "0x1234";
    wallet.value.chainId = "0x534e5f5345504f4c4941";
    wallet.value.isConnected = true;
    wallet.value.requestTransaction = wallet.requestTransaction;
    wallet.requestTransaction.mockResolvedValue({ transaction_hash: "0xabc" });
    runtime.confirmTokenDeployment.mockResolvedValue(undefined);
    runtime.assertErc1155Recipient.mockResolvedValue(undefined);
  });

  test("an ERC-20 create sends one UDC call and reports success only after the class check", async () => {
    renderCreate();
    fill("Name", "Bramble Test");
    fill("Symbol", "BRT");
    fill("Supply", "1000");
    const address = await waitFor(() => {
      const element = document.querySelector(".create-review__address");
      if (element === null) throw new Error("no address yet");
      return element;
    });
    const predicted = address.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Review create" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Created at"));
    expect(address.textContent).toBe(predicted);
    expect(wallet.requestTransaction).toHaveBeenCalledTimes(1);
    const request = wallet.requestTransaction.mock.calls[0]?.[0];
    expect(request.calls).toHaveLength(1);
    expect(request.calls[0].contractAddress).toBe(constants.UDC.ADDRESS);
    expect(request.calls[0].calldata[0]).toBe(BigInt(TOKEN_PRESETS.erc20.classHash).toString());
    expect(request.details[0]).toEqual({ label: "Contract address", value: address.textContent });
    expect(request.warning).toBeUndefined();
    expect(runtime.confirmTokenDeployment).toHaveBeenCalledWith(
      "0x534e5f5345504f4c4941",
      "0xabc",
      address.textContent,
      TOKEN_PRESETS.erc20.classHash,
    );
    expect(screen.getByRole("link", { name: /Open contract/ }).getAttribute("href")).toContain("sepolia.");
    expect((screen.getByRole("button", { name: "Review create" }) as HTMLButtonElement).disabled).toBe(true);

    // Same values again: only a fresh salt moves the address, so a second
    // create can never collide with the contract just deployed.
    fill("Supply", "2000");
    fill("Supply", "1000");
    await waitFor(() => expect(address.textContent).not.toBe(predicted));
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a failed class check is an error with the transaction link, never success", async () => {
    runtime.confirmTokenDeployment.mockRejectedValue(
      new Error("The new contract doesn't run the expected OpenZeppelin class."),
    );
    renderCreate();
    fill("Name", "Bramble Test");
    fill("Symbol", "BRT");
    fill("Supply", "1");
    fireEvent.click(await screen.findByRole("button", { name: "Review create" }));

    await waitFor(() => expect(screen.getByRole("status").className).toContain("studio-status--error"));
    expect(screen.getByRole("status").textContent).toContain("expected OpenZeppelin class");
    expect(screen.getByRole("link", { name: /View transaction/ })).toBeTruthy();
  });

  test("invalid input blocks review and explains why", async () => {
    renderCreate();
    fill("Name", "Bramble Test");
    fill("Symbol", "B R T");
    fill("Supply", "1");
    expect(await screen.findByText("Symbol must be 1–11 letters or numbers.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review create" }) as HTMLButtonElement).disabled).toBe(true);
    expect(wallet.requestTransaction).not.toHaveBeenCalled();
  });

  test("an unsupported network blocks review", async () => {
    wallet.value.chainId = "0x534e5f4445564e4554";
    renderCreate();
    fill("Name", "Bramble Test");
    fill("Symbol", "BRT");
    fill("Supply", "1");
    expect(screen.getByText("Unsupported network")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review create" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("Mainnet is off: review is blocked and nothing reaches the wallet", async () => {
    wallet.value.chainId = "0x534e5f4d41494e";
    renderCreate();
    fill("Name", "Bramble Test");
    fill("Symbol", "BRT");
    fill("Supply", "1");
    expect(screen.getByText("Unsupported network")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review create" }) as HTMLButtonElement).disabled).toBe(true);
    expect(wallet.requestTransaction).not.toHaveBeenCalled();
  });

  test("the review says every standard's contract is upgradeable by its owner", async () => {
    renderCreate();
    const note = "Upgradeable contract: your account owns it and can change its code later.";
    fill("Name", "Bramble Test");
    fill("Symbol", "BRT");
    fill("Supply", "1");
    expect(await screen.findByText(note)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "ERC-721" }));
    fill("Base URI", "ipfs://bafy/");
    fill("Token ids", "1");
    expect(await screen.findByText(note)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "ERC-1155" }));
    fill("Amounts", "1");
    expect(await screen.findByText(note)).toBeTruthy();
  });

  test("an ERC-1155 create checks the recipient on the wallet's network before the wallet sees it", async () => {
    renderCreate();
    fireEvent.click(screen.getByRole("tab", { name: "ERC-1155" }));
    fill("Base URI", "https://example.org/{id}.json");
    fill("Token ids", "7");
    fill("Amounts", "2");
    fill("Mint to", " 0xABC ");
    fireEvent.click(await screen.findByRole("button", { name: "Review create" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Created at"));
    expect(runtime.assertErc1155Recipient).toHaveBeenCalledWith("0x534e5f5345504f4c4941", "0xabc");
    expect(runtime.assertErc1155Recipient.mock.invocationCallOrder[0]).toBeLessThan(
      wallet.requestTransaction.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("an ERC-1155 recipient that can't receive it is refused and nothing reaches the wallet", async () => {
    runtime.assertErc1155Recipient.mockRejectedValue(new Error("The recipient can't receive ERC-1155 tokens."));
    renderCreate();
    fireEvent.click(screen.getByRole("tab", { name: "ERC-1155" }));
    fill("Base URI", "https://example.org/{id}.json");
    fill("Token ids", "7");
    fill("Amounts", "2");
    fireEvent.click(await screen.findByRole("button", { name: "Review create" }));
    await waitFor(() => expect(screen.getByRole("status").className).toContain("studio-status--error"));
    expect(screen.getByRole("status").textContent).toContain("The recipient can't receive ERC-1155 tokens.");
    expect(runtime.assertErc1155Recipient).toHaveBeenCalledWith("0x534e5f5345504f4c4941", "0x1234");
    expect(wallet.requestTransaction).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /View transaction/ })).toBeNull();
  });

  test("a rejected wallet review is an error and nothing is confirmed", async () => {
    wallet.requestTransaction.mockRejectedValue(new Error("User rejected the request."));
    renderCreate();
    fireEvent.click(screen.getByRole("tab", { name: "ERC-721" }));
    fill("Name", "Garden");
    fill("Symbol", "GRDN");
    fill("Base URI", "ipfs://bafy/");
    fill("Token ids", "1");
    fireEvent.click(await screen.findByRole("button", { name: "Review create" }));
    await waitFor(() => expect(screen.getByRole("status").className).toContain("studio-status--error"));
    expect(runtime.confirmTokenDeployment).not.toHaveBeenCalled();
    // Only the ERC-1155 preset mints with an acceptance check.
    expect(runtime.assertErc1155Recipient).not.toHaveBeenCalled();
  });
});

describe("Create links", () => {
  test("keep the network the create was sent on after the wallet switches", async () => {
    wallet.value.chainId = "0x534e5f5345504f4c4941";
    wallet.requestTransaction.mockResolvedValue({ transaction_hash: "0xabc" });
    runtime.confirmTokenDeployment.mockResolvedValue(undefined);
    const view = render(<CreateToken makeSalt={() => "0x51"} onNavigate={vi.fn()} />);
    fill("Name", "Bramble Test");
    fill("Symbol", "BRT");
    fill("Supply", "1");
    fireEvent.click(await screen.findByRole("button", { name: "Review create" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Created at"));
    wallet.value.chainId = "0x534e5f4d41494e";
    view.rerender(<CreateToken makeSalt={() => "0x51"} onNavigate={vi.fn()} />);
    expect(screen.getByRole("link", { name: /Open contract/ }).getAttribute("href")).toContain("sepolia.");
  });
});
