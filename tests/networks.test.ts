/**
 * Starknet network checks prove field validators reject oversized calldata.
 */
import { expect, test } from "bun:test";

import { isNonZeroStarkFieldElement, isStarkFieldElement } from "../src/starknet/networks";

test("validates bounded Stark field elements", () => {
  expect(isStarkFieldElement("0x1")).toBe(true);
  expect(isNonZeroStarkFieldElement("0x1")).toBe(true);
  expect(isNonZeroStarkFieldElement("0x0")).toBe(false);
  expect(
    isStarkFieldElement("0x800000000000011000000000000000000000000000000000000000000000001"),
  ).toBe(false);
  expect(isStarkFieldElement(`0x${"0".repeat(64)}1`)).toBe(false);
});
