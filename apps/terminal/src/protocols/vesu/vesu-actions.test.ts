import { describe, expect, it } from "vitest";
import { MAINNET_TOKEN_ADDRESSES, VESU_ADDRESSES } from "../constants";
import {
  buildVesuRewardClaimCalls,
  buildVesuVaultDepositCalls,
  buildVesuVaultRedeemCalls,
} from "./vesu-actions";

describe("Vesu vault and reward actions", () => {
  it("revokes the exact vault allowance after deposit", () => {
    const calls = buildVesuVaultDepositCalls(
      "0x123",
      MAINNET_TOKEN_ADDRESSES.USDC,
      1_000_000n,
      "0x456",
    );
    expect(calls.map((call) => call.entrypoint)).toEqual(["approve", "deposit", "approve"]);
  });

  it("builds async redemption and proof-backed reward calls", () => {
    expect(buildVesuVaultRedeemCalls("0x123", 5n, "0x456")[0]?.entrypoint).toBe(
      "request_redeem",
    );
    const claim = buildVesuRewardClaimCalls(7n, ["0x0", "0x2"]);
    expect(claim[0]).toMatchObject({
      contractAddress: VESU_ADDRESSES.btcFiDistributor,
      entrypoint: "claim",
    });
    expect(() => buildVesuRewardClaimCalls(0n, [])).toThrow("No claimable");
  });
});
