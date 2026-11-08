import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Resource, VesuVault } from "../../data/index";

// Deposits are paused in production; this suite turns them on to pin the
// handoff re-check that guards them once they are enabled (#270).
const mocks = vi.hoisted(() => ({
  requestTransaction: vi.fn(async () => ({ transaction_hash: "0xabc" })),
  verifyVault: vi.fn(async () => undefined),
}));

vi.mock("../../protocols/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../protocols/constants")>()),
  VESU_VAULT_DEPOSITS_ENABLED: true,
}));

vi.mock("../../protocols/vesu/vesu-vaults", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../protocols/vesu/vesu-vaults")>()),
  verifyCuratedVesuVault: mocks.verifyVault,
}));

vi.mock("../../wallet/connection/WalletProvider", () => ({
  useWallet: () => ({
    address: "0x123",
    connect: vi.fn(),
    isConnected: true,
    requestTransaction: mocks.requestTransaction,
  }),
}));

import { LendingVaults } from "./LendingAccountViews";

const NWBTC = "0x023ccbaf0f70e8dcb29520ab4ea12e2e916fb71204677321e91e525062279e35";
const resource = <T,>(data: T): Resource<T> => ({ data, error: null, isLoading: false, refresh: vi.fn() });
const vault: VesuVault = {
  address: NWBTC,
  apr30d: 1,
  apr7d: 1,
  assetAddress: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
  assetDecimals: 8,
  assetSymbol: "WBTC",
  averageRedeemDelaySeconds: 86_400,
  curatorAddress: "0x48f9",
  depositLimit: 100,
  managementFee: 1,
  name: "Noon WBTC",
  performanceFee: 10,
  symbol: "nWBTC",
  tvlUsd: 1_000,
};

it("re-checks a curated vault's class at handoff for a deposit", async () => {
  render(<LendingVaults positions={resource([])} redeems={resource([])} resource={resource([vault])} />);
  fireEvent.change(screen.getAllByPlaceholderText("0.00")[0] as HTMLElement, { target: { value: "0.5" } });
  fireEvent.click(screen.getByRole("button", { name: /Review deposit/ }));
  await waitFor(() => expect(mocks.requestTransaction).toHaveBeenCalled());
  const [request] = mocks.requestTransaction.mock.calls.at(-1) as unknown as [
    { readonly handoffCheck?: () => Promise<void> },
  ];
  expect(mocks.verifyVault).not.toHaveBeenCalled();
  await request.handoffCheck?.();
  expect(mocks.verifyVault).toHaveBeenCalledWith(NWBTC);
});
