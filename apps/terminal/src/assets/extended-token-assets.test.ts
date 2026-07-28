import { describe, expect, it } from "vitest";
import { extendedTokenLogo } from "./extended-token-assets";

describe("extendedTokenLogo", () => {
  it("maps bundled symbols exactly and leaves missing artwork on the fallback", () => {
    expect(extendedTokenLogo("BTC")).toBe("/token-assets/extended/BTC.svg");
    expect(extendedTokenLogo("kHMSTR")).toBe("/token-assets/extended/kHMSTR.svg");
    expect(extendedTokenLogo("CL")).toBeNull();
  });
});
