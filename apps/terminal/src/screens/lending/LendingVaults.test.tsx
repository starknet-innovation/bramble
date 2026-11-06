import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Resource, VesuPosition, VesuRedeem, VesuVault } from "../../data/index";

// Real call builders; only the on-chain class read is stubbed (#270).
const mocks = vi.hoisted(() => ({
  requestTransaction: vi.fn(async () => ({ transaction_hash: "0xabc" })),
  verifyVault: vi.fn(async () => undefined),
}));

vi.mock("../../protocols/index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../protocols/index")>()),
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
const UNLISTED = "0x0716cf8be5e3d6b28c76e8afbe60b7d5824a913967444fe1d4962615e585a155";

const resource = <T,>(data: T): Resource<T> => ({ data, error: null, isLoading: false, refresh: vi.fn() });

const vault = (address: string): VesuVault => ({
  address,
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
});

const redeem = (sharesAddress: string): VesuRedeem => ({
  assetsAmount: 0.1,
  assetsSymbol: "WBTC",
  redemptionId: "7",
  sharesAddress,
  sharesAmount: 0.1,
  sharesDecimals: 18,
  sharesSymbol: "nWBTC",
  status: "claimable",
  timestamp: "2026-11-06T00:00:00Z",
});

const position = (poolId: string): VesuPosition =>
  ({ poolId, sharesAmount: 1, sharesDecimals: 18, sharesSymbol: "nWBTC", type: "vault" }) as VesuPosition;

type Handoff = { readonly handoffCheck?: () => Promise<void> };
const handedOff = (): Handoff =>
  (mocks.requestTransaction.mock.calls.at(-1) as unknown as [Handoff] | undefined)?.[0] ?? {};

const renderVaults = (address: string): void => {
  render(
    <LendingVaults
      positions={resource([position(address)])}
      redeems={resource([redeem(address)])}
      resource={resource([vault(address)])}
    />,
  );
};

describe("LendingVaults allowlist (#270)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-checks a curated vault's class at handoff for a claim", async () => {
    renderVaults(NWBTC);
    fireEvent.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(mocks.requestTransaction).toHaveBeenCalled());
    expect(mocks.verifyVault).not.toHaveBeenCalled();
    await handedOff().handoffCheck?.();
    expect(mocks.verifyVault).toHaveBeenCalledWith(NWBTC);
  });

  it("re-checks a curated vault's class at handoff for a redemption request", async () => {
    renderVaults(NWBTC);
    fireEvent.change(screen.getAllByPlaceholderText("0.00")[1] as HTMLElement, { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Request redemption" }));
    await waitFor(() => expect(mocks.requestTransaction).toHaveBeenCalled());
    await handedOff().handoffCheck?.();
    expect(mocks.verifyVault).toHaveBeenCalledWith(NWBTC);
  });

  it("refuses a claim and a redemption request on a vault the API lists but the allowlist does not", async () => {
    renderVaults(UNLISTED);
    fireEvent.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(screen.getByText("Bramble doesn't support this Vesu vault")).toBeTruthy());
    fireEvent.change(screen.getAllByPlaceholderText("0.00")[1] as HTMLElement, { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Request redemption" }));
    await waitFor(() => expect(screen.getByText("Bramble doesn't support this Vesu vault")).toBeTruthy());
    expect(mocks.requestTransaction).not.toHaveBeenCalled();
  });
});
