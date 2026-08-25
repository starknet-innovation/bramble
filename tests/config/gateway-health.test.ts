/** Sanitized synthetic gateway probe behavior. */
import { describe, expect, test } from "bun:test";
import { runGatewayHealthProbe } from "../../scripts/check-gateway-health";

describe("gateway health probe", () => {
  test("reports fixed categories without exposing endpoint or response data", async () => {
    let now = 0;
    const results = await runGatewayHealthProbe({
      fetch: async (_input, init) => {
        now += 10;
        const body = JSON.parse(String(init?.body)) as { readonly method: string };
        expect(body.method).toBe("starknet_chainId");
        const sepolia = String(_input).includes("sepolia");
        return Response.json({ result: sepolia ? "0x534e5f5345504f4c4941" : "0x534e5f4d41494e" });
      },
      now: () => now,
    });

    expect(results).toHaveLength(4);
    expect(results.every((result) => result.outcome === "ok")).toBe(true);
    expect(JSON.stringify(results)).not.toContain("http");
  });
});
