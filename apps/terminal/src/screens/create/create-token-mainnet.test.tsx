import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

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

vi.mock("../../protocols/constants", async () => ({
  ...(await vi.importActual<typeof import("../../protocols/constants")>("../../protocols/constants")),
  TOKEN_CREATE_NETWORKS: ["SN_MAIN", "SN_SEPOLIA"],
}));

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

// Mainnet ships off. This pins the real-fees warning for when it is turned on.
describe("Create once Mainnet is on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wallet.value.chainId = "0x534e5f4d41494e";
    wallet.value.requestTransaction = wallet.requestTransaction;
    wallet.requestTransaction.mockResolvedValue({ transaction_hash: "0xabc" });
    runtime.confirmTokenDeployment.mockResolvedValue(undefined);
    runtime.assertErc1155Recipient.mockResolvedValue(undefined);
  });

  test("adds the real-fees warning to the request", async () => {
    render(<CreateToken makeSalt={() => "0x51"} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "ERC-1155" }));
    for (const [label, value] of [["Base URI", "ipfs://bafy/"], ["Token ids", "1 2"], ["Amounts", "5 6"]]) {
      fireEvent.change(screen.getByLabelText(label as string), { target: { value } });
    }
    fireEvent.click(await screen.findByRole("button", { name: "Review create" }));
    await waitFor(() => expect(wallet.requestTransaction).toHaveBeenCalled());
    const request = wallet.requestTransaction.mock.calls[0]?.[0];
    expect(request.warning).toBe("This is a Mainnet transaction with real network fees.");
    expect(request.title).toBe("Create ERC-1155 collection");
    expect(runtime.assertErc1155Recipient).toHaveBeenCalledWith("0x534e5f4d41494e", "0x1234");
  });
});
