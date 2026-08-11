import { describe, expect, it, vi } from "vitest";
import { PRIVACY_POOL_ADDRESS } from "../../../shared/privacy";
import { readPrivacyPool } from "./privacy-pool";

describe("privacy pool provider", () => {
  it("reads the fixed audited view surface", async () => {
    const values = new Map([
      ["get_version", ["0x1"]],
      ["get_fee_amount", ["0x2"]],
      ["get_fee_collector", ["0x3"]],
      ["get_proof_validity_blocks", ["0xa"]],
    ]);
    const call = vi.fn(async (entrypoint: string) => values.get(entrypoint));

    await expect(readPrivacyPool(call)).resolves.toEqual({
      address: PRIVACY_POOL_ADDRESS,
      feeAmount: 2n,
      feeCollector: "0x3",
      proofValidityBlocks: 10,
      version: "0x1",
    });
    expect(call).toHaveBeenCalledTimes(4);
  });

  it("rejects malformed or unsafe pool responses", async () => {
    await expect(readPrivacyPool(async () => ["not-a-felt"])).rejects.toThrow(
      "invalid view result",
    );
    await expect(
      readPrivacyPool(async (entrypoint) =>
        entrypoint === "get_fee_collector" ? ["0x0"] : ["0x1"],
      ),
    ).rejects.toThrow("unsafe configuration");
  });
});
