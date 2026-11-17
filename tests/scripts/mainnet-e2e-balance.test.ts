/**
 * Hot-wallet spend policy and the balance command. Fixtures are not funded
 * accounts. RPC errors must not echo the URL.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STARKNET_NETWORKS, UINT128_LIMIT } from "@bramble/wallet-model/networks";
import { runBalanceCommand } from "../../scripts/mainnet-e2e-balance";
import {
  dedicatedMainnetRpcUrl,
  type RpcFetch,
  readHotWalletBalances,
  rpcUrlSha256,
} from "../../scripts/mainnet-e2e-rpc";
import {
  judgeBalances,
  parseSpendTier,
  STANDARD_STRK_LIMITS,
  STANDARD_USDC_LIMITS,
  STRK20_STRK_LIMITS,
  spendCeilings,
} from "../../scripts/mainnet-e2e-spend";

const STRK = 10n ** 18n;
const USDC = 10n ** 6n;
const CHAIN = STARKNET_NETWORKS.SN_MAIN.chainId;
const RPC = "https://rpc.example/v0_10";
const SECRET_RPC = "https://rpc.example/v0_10/super-secret-key";

const limbs = (raw: bigint): readonly [string, string] => [
  `0x${(raw % UINT128_LIMIT).toString(16)}`,
  `0x${(raw / UINT128_LIMIT).toString(16)}`,
];

const rpc = (results: readonly unknown[]): RpcFetch => {
  const pending = [...results];
  return () => {
    const next = pending.shift();
    if (next === undefined) return Promise.reject(new Error("unexpected rpc"));
    return Promise.resolve(
      new Response(JSON.stringify({ id: 1, jsonrpc: "2.0", result: next }), { status: 200 }),
    );
  };
};

const balances = (strk: bigint, usdc: bigint): RpcFetch => rpc([CHAIN, limbs(strk), limbs(usdc)]);

describe("mainnet spend policy", () => {
  test("pins the standard and STRK20 ceilings", () => {
    const standard = spendCeilings("standard");
    const strk20 = spendCeilings("strk20");
    expect(standard.strk.minRaw).toBe(50_000_000_000_000_000n);
    expect(standard.strk.maxRaw).toBe(2n * STRK);
    expect(standard.strk.capRaw).toBe(200_000_000_000_000_000n);
    expect(standard.usdc.minRaw).toBe(20_000n);
    expect(standard.usdc.maxRaw).toBe(5n * USDC);
    expect(standard.usdc.capRaw).toBe(50_000n);
    expect(strk20.strk.minRaw).toBe(21n * STRK);
    expect(strk20.strk.maxRaw).toBe(30n * STRK);
    expect(strk20.strk.capRaw).toBe(22n * STRK);
    expect(strk20.usdc).toEqual(standard.usdc);
    expect(parseSpendTier(undefined)).toBe("standard");
    expect(parseSpendTier("strk20")).toBe("strk20");
    expect(() => parseSpendTier("unlimited")).toThrow("standard or strk20");
  });

  test("refuses a hot wallet outside the window and a spend over the cap", () => {
    const below = judgeBalances({
      after: { strk: STRK / 100n, usdc: USDC },
      before: { strk: STRK / 100n, usdc: USDC },
      phase: "preflight",
      tier: "standard",
    });
    expect(below.kind).toBe("below-minimum");
    expect(below.message).toContain("below the 0.05 minimum");
    expect(below.message).not.toContain("http");

    const above = judgeBalances({
      after: { strk: 3n * STRK, usdc: USDC },
      before: { strk: 3n * STRK, usdc: USDC },
      phase: "preflight",
      tier: "standard",
    });
    expect(above.kind).toBe("above-maximum");
    expect(above.message).toContain("above the 2 maximum");

    const spent = judgeBalances({
      after: { strk: STRK / 2n, usdc: USDC },
      before: { strk: STRK, usdc: USDC },
      phase: "post",
      tier: "standard",
    });
    expect(spent.kind).toBe("over-cap");
    expect(spent.strkDelta).toBe(STRK / 2n);
    expect(spent.message).toContain("exceeds the 0.2 per-run cap");

    const held = judgeBalances({
      after: { strk: 25n * STRK, usdc: USDC },
      before: { strk: 25n * STRK, usdc: USDC },
      phase: "preflight",
      tier: "strk20",
    });
    expect(held.kind).toBe("ok");
  });

  test("post-run checks the spend cap, not the preflight minimum", () => {
    // A normal STRK20 lifecycle: start at 25 STRK, spend about 16.
    const strk20Run = judgeBalances({
      after: { strk: 9n * STRK, usdc: USDC },
      before: { strk: 25n * STRK, usdc: USDC },
      phase: "post",
      tier: "strk20",
    });
    expect(strk20Run.kind).toBe("ok");
    expect(strk20Run.strkDelta).toBe(16n * STRK);

    // Standard tier: a run inside the cap that ends below the minimum passes
    // post; the next preflight asks for a top-up.
    const standardRun = judgeBalances({
      after: { strk: STRK / 100n, usdc: USDC / 100n },
      before: { strk: STRK / 10n, usdc: USDC / 20n },
      phase: "post",
      tier: "standard",
    });
    expect(standardRun.kind).toBe("ok");
    const nextPreflight = judgeBalances({
      after: { strk: STRK / 100n, usdc: USDC / 100n },
      before: { strk: STRK / 100n, usdc: USDC / 100n },
      phase: "preflight",
      tier: "standard",
    });
    expect(nextPreflight.kind).toBe("below-minimum");

    // The cap still binds after the run, and so does the maximum.
    const strk20Over = judgeBalances({
      after: { strk: 2n * STRK, usdc: USDC },
      before: { strk: 25n * STRK, usdc: USDC },
      phase: "post",
      tier: "strk20",
    });
    expect(strk20Over.kind).toBe("over-cap");
    expect(strk20Over.message).not.toContain("minimum");
    const grew = judgeBalances({
      after: { strk: 3n * STRK, usdc: USDC },
      before: { strk: STRK, usdc: USDC },
      phase: "post",
      tier: "standard",
    });
    expect(grew.kind).toBe("above-maximum");
  });

  test("the runbook names the same ceilings and secrets", async () => {
    const doc = await Bun.file("docs/MAINNET_E2E_CI.md").text();
    for (const amount of [
      STANDARD_STRK_LIMITS.min,
      STANDARD_STRK_LIMITS.max,
      STANDARD_STRK_LIMITS.cap,
    ]) {
      expect(doc).toContain(`${amount} STRK`);
    }
    for (const amount of [
      STANDARD_USDC_LIMITS.min,
      STANDARD_USDC_LIMITS.max,
      STANDARD_USDC_LIMITS.cap,
    ]) {
      expect(doc).toContain(`${amount} USDC`);
    }
    for (const amount of [STRK20_STRK_LIMITS.min, STRK20_STRK_LIMITS.max, STRK20_STRK_LIMITS.cap]) {
      expect(doc).toContain(`${amount} STRK`);
    }
    expect(doc).toContain("MAINNET_E2E_PRIVATE_KEY");
    expect(doc).toContain("mainnet-e2e");
  });
});

describe("mainnet balance command", () => {
  test("refuses a shared or non-HTTPS RPC without echoing it", () => {
    expect(() =>
      dedicatedMainnetRpcUrl("https://wallet.nodes.starknet.org/rpc/mainnet/v0_10"),
    ).toThrow("dedicated test RPC");
    expect(() => dedicatedMainnetRpcUrl("http://rpc.example/secret-token")).toThrow("HTTPS");
    expect(() => dedicatedMainnetRpcUrl("not-a-url super-secret-key")).toThrow("HTTPS");
    try {
      dedicatedMainnetRpcUrl("not-a-url super-secret-key");
    } catch (error) {
      expect(String(error)).not.toContain("super-secret-key");
    }
  });

  test("reads uint256 balances only after mainnet chain id", async () => {
    const read = await readHotWalletBalances({
      address: "0x123",
      fetchImpl: balances(STRK, USDC),
      rpcUrl: RPC,
    });
    expect(read).toEqual({ strk: STRK, usdc: USDC });
    await expect(
      readHotWalletBalances({
        address: "0x123",
        fetchImpl: rpc(["0x1"]),
        rpcUrl: RPC,
      }),
    ).rejects.toThrow("did not answer Starknet mainnet");
  });

  test("preflight and post-run reports stay inside the policy text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mainnet-e2e-"));
    const env = {
      MAINNET_E2E_ADDRESS: "0x123",
      MAINNET_E2E_REPORT_FILE: join(dir, "report.txt"),
      MAINNET_E2E_RPC_URL: SECRET_RPC,
      MAINNET_E2E_SPEND_TIER: "standard",
    };
    const errors: string[] = [];
    const original = console.error;
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    try {
      expect(await runBalanceCommand("preflight", env, balances(STRK, USDC))).toBe(0);
      const ok = await Bun.file(env.MAINNET_E2E_REPORT_FILE).text();
      expect(ok).toContain("verdict=ok");
      expect(ok).toContain("strk_before=1");
      expect(ok).toContain(`strk_before_raw=${STRK}`);
      expect(ok).toContain(`usdc_before_raw=${USDC}`);
      // Execute compares this hash with its own RPC URL; the URL never leaves.
      const digest = createHash("sha256").update(SECRET_RPC).digest("hex");
      expect(rpcUrlSha256(SECRET_RPC)).toBe(digest);
      expect(ok).toContain(`rpc_sha256=${digest}\n`);
      expect(ok).not.toContain("super-secret-key");

      // The baseline arrives as job outputs from the trusted preflight job,
      // never from a file the code under test could rewrite.
      expect(await runBalanceCommand("post", env, balances(STRK / 2n, USDC))).toBe(1);
      expect(await Bun.file(env.MAINNET_E2E_REPORT_FILE).text()).toBe("verdict=unavailable\n");
      expect(errors.join("\n")).toContain("Preflight balances are missing or malformed");
      for (const malformed of ["", "-1", "0x10", "1.5", "01", "9".repeat(79)]) {
        const bad = {
          ...env,
          MAINNET_E2E_STRK_BEFORE_RAW: malformed,
          MAINNET_E2E_USDC_BEFORE_RAW: `${USDC}`,
        };
        expect(await runBalanceCommand("post", bad, balances(STRK, USDC))).toBe(1);
      }

      const post = {
        ...env,
        MAINNET_E2E_STRK_BEFORE_RAW: `${STRK}`,
        MAINNET_E2E_USDC_BEFORE_RAW: `${USDC}`,
      };
      expect(await runBalanceCommand("post", post, balances(STRK / 2n, USDC))).toBe(1);
      const over = await Bun.file(env.MAINNET_E2E_REPORT_FILE).text();
      expect(over).toContain("verdict=over-cap");
      expect(over).not.toContain("rpc_sha256=");
      expect(over).toContain("strk_delta=0.5");
      expect(errors.join("\n")).not.toContain("super-secret-key");

      let called = false;
      const fetchImpl: RpcFetch = () => {
        called = true;
        return Promise.reject(new Error(SECRET_RPC));
      };
      expect(await runBalanceCommand("preflight", env, fetchImpl)).toBe(1);
      expect(called).toBe(true);
      expect(await Bun.file(env.MAINNET_E2E_REPORT_FILE).text()).toBe("verdict=unavailable\n");
      expect(errors.join("\n")).not.toContain("super-secret-key");
    } finally {
      console.error = original;
    }
  });
});
