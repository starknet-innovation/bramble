import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The executor's class read at wallet handoff (#269). Only the RPC read and
// the planning request are stubbed; the handoff guard itself is the real one.
const mocks = vi.hoisted(() => ({
  classHash: vi.fn(async (): Promise<unknown> => undefined),
  prepare: vi.fn(async () => ({ call: {}, proof: {} })),
  submit: vi.fn(async () => `0x01${"0".repeat(62)}`),
}));

vi.mock("../../protocols/support/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../protocols/support/provider")>()),
  withRpcFallback: () => mocks.classHash(),
}));

vi.mock("../../protocols/privacy/privacy-pool", () => ({
  readPrivacyPool: () => Promise.reject(new Error("offline")),
}));

vi.mock("../../protocols/avnu/private-swap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../protocols/avnu/private-swap-client")>()),
  fetchPrivateSwapPlan: async () => ({
    actions: [
      { amount: "0x2", recipient: "0x3", token: "0x4", type: "withdraw" },
      { amount: "0x1", recipient: "0x6", token: "0x4", type: "withdraw" },
      { amount: "OPEN", recipient: "0x7", token: "0x5", type: "transfer" },
      { calldata: ["0x5"], contract: "0x3", type: "invoke" },
    ],
    buyAmount: "0x5",
    executor: "0x3",
    fee: { amount: "0x1", recipient: "0x6", token: "0x4" },
    minBuyAmount: "0x4",
    quoteId: "quote-1",
    sellAmount: "0x2",
  }),
  submitPrivateSwapProof: mocks.submit,
}));

vi.mock("../../wallet/connection/WalletProvider", () => ({
  useWallet: () => ({
    address: "0x7",
    chainId: "SN_MAIN",
    connect: vi.fn(),
    invokePrivate: vi.fn(),
    isConnected: true,
    isConnecting: false,
    preparePrivateInvoke: mocks.prepare,
    privateBalances: vi.fn(async () => []),
    registerPrivate: vi.fn(),
  }),
}));

import { PRIVATE_SWAP_EXECUTOR_CLASS_HASH } from "../../../shared/privacy";
import {
  PRIVATE_SWAP_EXECUTOR_CHANGED,
  PRIVATE_SWAP_EXECUTOR_UNVERIFIED,
} from "../../protocols/avnu/private-swap-client";
import Privacy from "./Privacy";

const reviewRoute = async (): Promise<void> => {
  render(<Privacy onNavigate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Private swap/ }));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review private route" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Authorize proof and submit" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Authorize proof and submit" }));
};

describe("Privacy swap handoff (#269)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks the wallet to prove only after the executor class re-check passes", async () => {
    mocks.classHash.mockResolvedValue(PRIVATE_SWAP_EXECUTOR_CLASS_HASH);
    await reviewRoute();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it.each([
    ["a different class", () => mocks.classHash.mockResolvedValue("0x1234"), PRIVATE_SWAP_EXECUTOR_CHANGED],
    ["a failed class read", () => mocks.classHash.mockRejectedValue(new Error("down")), PRIVATE_SWAP_EXECUTOR_UNVERIFIED],
  ])("never opens the wallet on %s", async (_name, arrange, message) => {
    arrange();
    await reviewRoute();
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
