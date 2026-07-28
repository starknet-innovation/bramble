import { describe, expect, it } from "vitest";
import type { VesuMarket } from "../data";
import { resolveCollateralAddress } from "./lending-model";

const choices = [
  { market: { assetAddress: "0x111" } as VesuMarket },
  { market: { assetAddress: "0x0222" } as VesuMarket },
];

describe("Vesu lending ticket intent", () => {
  it("uses the position collateral even when it is not the first market", () => {
    expect(resolveCollateralAddress(choices, "", "0x222")).toBe("0x0222");
  });

  it("preserves a manual choice and otherwise falls back to the first market", () => {
    expect(resolveCollateralAddress(choices, "0x111", "")).toBe("0x111");
    expect(resolveCollateralAddress(choices, "0x999", "")).toBe("0x111");
  });
});
