import { describe, expect, it } from "vitest";
import { canonicalAddress, sameAddress } from "./networks";

describe("terminal Starknet address helpers", () => {
  it("normalizes padding without equating invalid values", () => {
    expect(sameAddress("0x049d", "0x49d")).toBe(true);
    expect(sameAddress("not-an-address", "not-an-address")).toBe(false);
    expect(canonicalAddress("0x49d")).toHaveLength(66);
  });
});
