import { describe, expect, it } from "vitest";
import { screenFromHash } from "./screens";

describe("screenFromHash", () => {
  it("opens the portfolio workspace from the wallet deep link", () => {
    expect(screenFromHash("#portfolio")).toBe("portfolio");
  });

  it("fails closed to Discover for missing or unknown screens", () => {
    expect(screenFromHash("")).toBe("discover");
    expect(screenFromHash("#unknown")).toBe("discover");
  });
});
