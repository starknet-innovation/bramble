import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshReferenceUsdPrice, referenceUsdPrice, type VesuMarket, type VesuPair } from "../../data/index";

const mocks = vi.hoisted(() => ({
  buildIncrease: vi.fn(() => [{ contractAddress: "0x7", entrypoint: "modify_lever" }]),
  buildLending: vi.fn(() => [{ contractAddress: "0x1", entrypoint: "deposit" }]),
  quoteIncrease: vi.fn(async () => ({ maxInputAmount: 1n })),
  quoteLending: vi.fn(async () => ({ action: "supply", vTokenAddress: null })),
  recheckLendingQuote: vi.fn(async () => undefined),
  recheckMultiplyQuote: vi.fn(async () => undefined),
  requestTransaction: vi.fn(async () => ({ transaction_hash: "0xabc" })),
  verifyMultiplyPool: vi.fn(async () => undefined),
}));

vi.mock("../../protocols/index", () => ({
  buildVesuMultiplyIncreaseCalls: mocks.buildIncrease,
  quoteVesuMultiplyIncrease: mocks.quoteIncrease,
  recheckVesuLendingQuote: mocks.recheckLendingQuote,
  recheckVesuMultiplyQuote: mocks.recheckMultiplyQuote,
  verifyVesuMultiplyPool: mocks.verifyMultiplyPool,
}));

vi.mock("../../protocols/vesu/vesu", () => ({
  buildLendingCalls: mocks.buildLending,
  quoteLending: mocks.quoteLending,
}));

vi.mock("../../wallet/connection/WalletProvider", () => ({
  useWallet: () => ({
    address: "0x123",
    chainId: "SN_MAIN",
    connect: vi.fn(),
    isConnected: true,
    isConnecting: false,
    requestTransaction: mocks.requestTransaction,
    watchAsset: vi.fn(async () => undefined),
  }),
}));

import { WalletError } from "../../protocols/support/errors";
import { LendingTicket } from "./LendingTicket";

const market = (assetAddress: string, symbol: string): VesuMarket => ({
  assetAddress,
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
  name: symbol,
  oracleAddress: "0xfeed",
  oracleAggregationMode: "median",
  oracleKey: `Pragma ${symbol}/USD`,
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
  symbol,
  targetRatePercent: 4,
  targetUtilization: 80,
  utilization: 50,
  vTokenAddress: "0x387e8",
  zeroUtilizationApr: 1,
});

const debt = market("0x33068", "USDC");
const collateral = market("0x49d36", "ETH");
const pair: VesuPair = {
  collateralAddress: collateral.assetAddress,
  debtAddress: debt.assetAddress,
  debtCap: 1_000_000,
  liquidationFactor: 0.9,
  maxLtv: 80,
  poolId: debt.poolId,
};

type Handoff = { readonly handoffCheck?: () => Promise<void> };
const handedOff = (): Handoff =>
  (mocks.requestTransaction.mock.calls.at(-1) as unknown as [Handoff] | undefined)?.[0] ?? {};

// The registry is read once when quoting; the review can stay open for as long
// as the user takes, so every Vesu request must re-read it at handoff (#270).
describe("LendingTicket wallet handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-checks a lending quote's registry anchors when the wallet is opened", async () => {
    render(<LendingTicket collateralPairs={[]} market={debt} />);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Review supply" }));

    await waitFor(() => expect(mocks.requestTransaction).toHaveBeenCalled());
    const quote = await mocks.quoteLending.mock.results[0]?.value;
    const { handoffCheck } = handedOff();
    expect(handoffCheck).toBeTypeOf("function");
    expect(mocks.recheckLendingQuote).not.toHaveBeenCalled();
    await handoffCheck?.();
    expect(mocks.recheckLendingQuote).toHaveBeenCalledWith(quote);
  });

  it("re-verifies both Multiply legs when the wallet is opened", async () => {
    render(
      <LendingTicket
        collateralPairs={[{ market: collateral, pair }]}
        market={debt}
        requestedAction="multiply"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Review Multiply" }));

    await waitFor(() => expect(mocks.requestTransaction).toHaveBeenCalled());
    expect(mocks.verifyMultiplyPool).toHaveBeenCalledTimes(1);
    // The swap cap is anchored to the AVNU feed with each leg's decimals (#646).
    expect(mocks.quoteIncrease).toHaveBeenCalledWith(
      collateral.assetAddress,
      debt.assetAddress,
      expect.any(BigInt),
      { collateralDecimals: collateral.decimals, debtDecimals: debt.decimals, priceUsd: referenceUsdPrice },
    );
    expect(mocks.recheckMultiplyQuote).not.toHaveBeenCalled();
    await handedOff().handoffCheck?.();
    expect(mocks.verifyMultiplyPool).toHaveBeenCalledTimes(2);
    expect(mocks.verifyMultiplyPool).toHaveBeenLastCalledWith(
      debt.poolId,
      collateral.assetAddress,
      debt.assetAddress,
    );
    // ...and re-checked against an uncached price at handoff.
    expect(mocks.recheckMultiplyQuote).toHaveBeenCalledWith(
      await mocks.quoteIncrease.mock.results[0]?.value,
      freshReferenceUsdPrice,
    );
  });

  // A price-anchor refusal while quoting (#646) must leave nothing to sign and
  // no stale quote behind: the next attempt quotes again from scratch.
  it("sends nothing on a price refusal, shows its sentence, and re-quotes on retry", async () => {
    mocks.quoteIncrease.mockRejectedValueOnce(new Error("The swap price is too far from the market price. Try again later."));
    render(
      <LendingTicket
        collateralPairs={[{ market: collateral, pair }]}
        market={debt}
        requestedAction="multiply"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    const review = screen.getByRole("button", { name: "Review Multiply" });
    fireEvent.click(review);

    expect(await screen.findByText("The swap price is too far from the market price. Try again later.")).toBeTruthy();
    expect(mocks.buildIncrease).not.toHaveBeenCalled();
    expect(mocks.requestTransaction).not.toHaveBeenCalled();

    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    await waitFor(() => expect(mocks.requestTransaction).toHaveBeenCalledTimes(1));
    expect(mocks.quoteIncrease).toHaveBeenCalledTimes(2);
    expect(mocks.buildIncrease).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      await mocks.quoteIncrease.mock.results[1]?.value,
    );
  });

  // Issue 652: a quoting diagnostic is the terminal's plumbing and reads as the
  // screen's own failure sentence; a route mismatch is a security fact and is
  // shown with its fact.
  it.each([
    ["Could not quote Vesu wind route", "Vesu request failed."],
    ["Ekubo Multiply route amount mismatch", "Ekubo Multiply route amount mismatch"],
  ])("shows %s as %s", async (thrown, shown) => {
    mocks.quoteIncrease.mockRejectedValueOnce(new WalletError(thrown));
    render(
      <LendingTicket
        collateralPairs={[{ market: collateral, pair }]}
        market={debt}
        requestedAction="multiply"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Review Multiply" }));

    expect(await screen.findByText(shown)).toBeTruthy();
    if (thrown !== shown) expect(screen.queryByText(thrown)).toBeNull();
    expect(mocks.requestTransaction).not.toHaveBeenCalled();
  });
});
