import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VesuMarket, VesuPosition } from "../../data/index";

// The vToken the pinned factory registers, which differs from the API's (Sherlock 169).
const { REGISTERED_VTOKEN } = vi.hoisted(() => ({ REGISTERED_VTOKEN: "0x5e9157e4" }));

const mocks = vi.hoisted(() => ({
  buildClose: vi.fn(() => [{ contractAddress: "0x1", entrypoint: "close" }]),
  buildIncrease: vi.fn(),
  buildLending: vi.fn(() => [{ contractAddress: "0x1", entrypoint: "deposit" }]),
  buildVaultDeposit: vi.fn(),
  buildVaultRedeem: vi.fn(),
  quoteClose: vi.fn(async () => ({ maxInputAmount: 1n })),
  quoteIncrease: vi.fn(),
  quoteLending: vi.fn(async () => ({ action: "supply", vTokenAddress: REGISTERED_VTOKEN })),
  registeredVToken: vi.fn(async () => REGISTERED_VTOKEN),
  verifyMultiplyPool: vi.fn(async () => undefined),
  requestTransaction: vi.fn(async () => ({ transaction_hash: "0xabc" })),
  watchAsset: vi.fn(async () => undefined),
}));

vi.mock("../../protocols/index", () => ({
  buildVesuMultiplyCloseCalls: mocks.buildClose,
  buildVesuMultiplyIncreaseCalls: mocks.buildIncrease,
  buildVesuVaultDepositCalls: mocks.buildVaultDeposit,
  buildVesuVaultRedeemCalls: mocks.buildVaultRedeem,
  quoteVesuMultiplyClose: mocks.quoteClose,
  quoteVesuMultiplyIncrease: mocks.quoteIncrease,
  registeredVesuVToken: mocks.registeredVToken,
  VESU_VAULT_DEPOSITS_ENABLED: false,
  verifyVesuMultiplyPool: mocks.verifyMultiplyPool,
}));

vi.mock("../../protocols/vesu/vesu", () => ({
  buildLendingCalls: mocks.buildLending,
  quoteLending: mocks.quoteLending,
}));

vi.mock("../../wallet/connection/WalletProvider", () => ({
  useWallet: () => ({
    address: "0x123",
    requestTransaction: mocks.requestTransaction,
    watchAsset: mocks.watchAsset,
  }),
}));

import { LendingManageModal } from "./LendingManageModal";

const market: VesuMarket = {
  assetAddress: "0x33068",
  borrowApr: 4,
  canBeBorrowed: true,
  decimals: 6,
  debt: 10,
  feeRate: 0,
  fullUtilizationApr: 10,
  isPaused: false,
  liquidity: 100,
  maxFullUtilizationApr: 20,
  maxTargetUtilization: 90,
  maxUtilization: 95,
  minFullUtilizationApr: 2,
  minTargetUtilization: 70,
  name: "USD Coin",
  oracleAddress: "0xfeed",
  oracleAggregationMode: "median",
  oracleKey: "Pragma USDC/USD",
  oracleSources: 3,
  oracleTimeWindowSeconds: 120,
  oracleTimeoutSeconds: 300,
  poolId: "0x451fe",
  poolName: "Prime",
  poolOwner: "0x1",
  priceUsd: 1,
  rateHalfLifeSeconds: 3600,
  rateUpdatedAt: null,
  riskUrl: null,
  supplied: 1000,
  supplyApy: 3,
  symbol: "USDC",
  targetRatePercent: 4,
  targetUtilization: 80,
  utilization: 50,
  vTokenAddress: "0x387e8",
  zeroUtilizationApr: 1,
};

const earn: VesuPosition = {
  collateralAddress: market.assetAddress,
  collateralAmount: 8,
  collateralDecimals: 6,
  collateralRaw: "8000000",
  collateralSymbol: "USDC",
  currentLtv: null,
  debtAddress: null,
  debtAmount: 0,
  debtDecimals: null,
  debtRaw: null,
  debtSymbol: null,
  healthFactor: null,
  id: "earn:1",
  maxLtv: null,
  poolId: market.poolId,
  poolName: market.poolName,
  sharesAmount: 7.9,
  sharesDecimals: 18,
  sharesRaw: "7900000000000000000",
  sharesSymbol: "vUSDC",
  type: "earn",
};

describe("LendingManageModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets an existing earn position request its receipt token directly", async () => {
    render(
      <LendingManageModal
        markets={[market]}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
        position={earn}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Track vUSDC" }));
    await waitFor(() =>
      expect(mocks.watchAsset).toHaveBeenCalledWith({ address: REGISTERED_VTOKEN }),
    );
    expect(mocks.registeredVToken).toHaveBeenCalledWith(market.poolId, market.assetAddress);
    expect(mocks.requestTransaction).not.toHaveBeenCalled();
    expect(screen.getByText("vUSDC is now tracked in the wallet.")).toBeTruthy();
  });

  it("keeps an earn position in context and submits a one-step wallet review", async () => {
    const onClose = vi.fn();
    const onSubmitted = vi.fn();
    render(
      <LendingManageModal
        markets={[market]}
        onClose={onClose}
        onSubmitted={onSubmitted}
        position={earn}
      />,
    );

    expect(screen.getByRole("dialog", { name: "USDC" })).toBeTruthy();
    expect(screen.getByText("8 USDC")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add funds" }));
    fireEvent.change(screen.getByLabelText("Position amount"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Review in wallet/ }));

    await waitFor(() => expect(mocks.requestTransaction).toHaveBeenCalled());
    expect(mocks.requestTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ reviewMode: "wallet" }),
    );
    expect(mocks.watchAsset).toHaveBeenCalledWith({ address: REGISTERED_VTOKEN });
    expect(onSubmitted).toHaveBeenCalled();
  });

  it("offers a full atomic unwind without asking for another amount", async () => {
    const multiply: VesuPosition = {
      ...earn,
      debtAddress: "0x4718",
      debtAmount: 2,
      debtDecimals: 18,
      debtRaw: "2000000000000000000",
      debtSymbol: "STRK",
      healthFactor: 1.8,
      id: "multiply:1",
      type: "multiply",
    };
    render(
      <LendingManageModal
        markets={[market]}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
        position={multiply}
      />,
    );

    expect(screen.getByText("Close the full multiplied position")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Review in wallet/ }));
    await waitFor(() => expect(mocks.quoteClose).toHaveBeenCalled());
    expect(mocks.verifyMultiplyPool).toHaveBeenCalledWith(
      market.poolId,
      multiply.collateralAddress,
      multiply.debtAddress,
    );
    expect(mocks.buildClose).toHaveBeenCalled();
  });

  it("builds no Multiply calls for a pool the registry does not list (Sherlock 169)", async () => {
    mocks.verifyMultiplyPool.mockRejectedValueOnce(
      new Error("This Vesu pool or asset is not registered on chain"),
    );
    render(
      <LendingManageModal
        markets={[market]}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
        position={{ ...earn, debtAddress: "0x4718", debtRaw: "1", debtSymbol: "STRK", type: "multiply" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Review in wallet/ }));
    await waitFor(() =>
      expect(screen.getByText("This Vesu pool or asset is not registered on chain")).toBeTruthy(),
    );
    expect(mocks.quoteClose).not.toHaveBeenCalled();
    expect(mocks.buildClose).not.toHaveBeenCalled();
    expect(mocks.requestTransaction).not.toHaveBeenCalled();
  });

  it("offers a vault position no deposit while vault deposits are paused (Sherlock 169)", () => {
    render(
      <LendingManageModal
        markets={[market]}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
        position={{ ...earn, type: "vault" }}
      />,
    );
    expect(screen.getByRole("button", { name: "Redeem" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add funds" })).toBeNull();
  });
});
