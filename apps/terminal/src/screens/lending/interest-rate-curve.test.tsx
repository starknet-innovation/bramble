import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { VesuMarket } from "../../data/index";
import { InterestRateCurve, vesuBorrowAprAt } from "./InterestRateCurve";

const market = {
  assetAddress: "0x1",
  borrowApr: 9.6,
  fullUtilizationApr: 40,
  maxFullUtilizationApr: 60,
  maxTargetUtilization: 85,
  maxUtilization: 95,
  minTargetUtilization: 75,
  poolId: "0x2",
  targetRatePercent: 20,
  targetUtilization: 80,
  utilization: 80,
  zeroUtilizationApr: 2,
} as VesuMarket;

describe("Vesu interest rate curve", () => {
  it("matches the V2 piecewise target/full-utilization model", () => {
    expect(vesuBorrowAprAt(market, 0)).toBe(2);
    expect(vesuBorrowAprAt(market, 80)).toBeCloseTo(9.6);
    expect(vesuBorrowAprAt(market, 100)).toBe(40);
    expect(vesuBorrowAprAt(market, 40)).toBeCloseTo(5.8);
  });

  it("bounds interactive utilization to the model domain", () => {
    expect(vesuBorrowAprAt(market, -10)).toBe(2);
    expect(vesuBorrowAprAt(market, 120)).toBe(40);
  });

  it("uses the chart tooltip for pointer and keyboard inspection without a slider", () => {
    render(<InterestRateCurve market={market} />);
    const chart = screen.getByRole("img", { name: /Use left and right arrow keys/ });
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByText("80.0% utilization")).toBeTruthy();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByText("80.5% utilization")).toBeTruthy();
  });
});
