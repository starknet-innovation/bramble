import { describe, expect, it } from "vitest";
import { MAINNET_TOKEN_ADDRESSES, VESU_ADDRESSES, VESU_CURATED_VAULTS } from "../constants";
import {
  buildVesuRewardClaimCalls,
  buildVesuVaultClaimCalls,
  buildVesuVaultDepositCalls,
  buildVesuVaultRedeemCalls,
  VESU_VAULT_DEPOSITS_PAUSED,
} from "./vesu-actions";
import { VESU_VAULT_NOT_CURATED } from "./vesu-vaults";

const [NWBTC] = VESU_CURATED_VAULTS;
if (NWBTC === undefined) throw new Error("allowlist is empty");
// Listed by the unfiltered Vesu API, but not curated.
const UNLISTED = "0x0716cf8be5e3d6b28c76e8afbe60b7d5824a913967444fe1d4962615e585a155";

describe("Vesu vault and reward actions", () => {
  it("refuses a vault deposit while deposits are paused (Sherlock 169)", () => {
    expect(() =>
      buildVesuVaultDepositCalls(NWBTC.address, NWBTC.assetAddress, 1_000_000n, "0x456"),
    ).toThrow(VESU_VAULT_DEPOSITS_PAUSED);
  });

  it("revokes the exact vault allowance after deposit", () => {
    const calls = buildVesuVaultDepositCalls(
      NWBTC.address,
      NWBTC.assetAddress,
      1_000_000n,
      "0x456",
      true,
    );
    expect(calls.map((call) => call.entrypoint)).toEqual(["approve", "deposit", "approve"]);
    expect(calls[1]?.contractAddress).toBe(NWBTC.address);
  });

  it("refuses a deposit into a vault outside the allowlist (#270)", () => {
    expect(() =>
      buildVesuVaultDepositCalls(UNLISTED, NWBTC.assetAddress, 1n, "0x456", true),
    ).toThrow(VESU_VAULT_NOT_CURATED);
  });

  it("refuses a deposit of an asset other than the curated vault's (#270)", () => {
    expect(() =>
      buildVesuVaultDepositCalls(NWBTC.address, MAINNET_TOKEN_ADDRESSES.USDC, 1n, "0x456", true),
    ).toThrow(VESU_VAULT_NOT_CURATED);
  });

  it("refuses request_redeem and claim_redeem on a vault outside the allowlist (#270)", () => {
    expect(() => buildVesuVaultRedeemCalls(UNLISTED, 5n, "0x456")).toThrow(VESU_VAULT_NOT_CURATED);
    expect(() => buildVesuVaultClaimCalls(UNLISTED, 1n)).toThrow(VESU_VAULT_NOT_CURATED);
  });

  it("builds async redemption, claim and proof-backed reward calls for a curated vault", () => {
    expect(buildVesuVaultRedeemCalls(NWBTC.address, 5n, "0x456")[0]).toMatchObject({
      contractAddress: NWBTC.address,
      entrypoint: "request_redeem",
    });
    // The address without its leading zero is the same felt and still matches.
    expect(buildVesuVaultClaimCalls(NWBTC.address.replace("0x0", "0x"), 1n)[0]).toMatchObject({
      entrypoint: "claim_redeem",
    });
    const claim = buildVesuRewardClaimCalls(7n, ["0x0", "0x2"]);
    expect(claim[0]).toMatchObject({
      contractAddress: VESU_ADDRESSES.btcFiDistributor,
      entrypoint: "claim",
    });
    expect(() => buildVesuRewardClaimCalls(0n, [])).toThrow("No claimable");
  });
});
