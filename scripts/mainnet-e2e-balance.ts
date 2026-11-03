/**
 * Preflight and post-run balance check for the mainnet E2E job.
 *
 * Reads STRK and native USDC through the dedicated RPC, compares them with
 * the spend policy, and writes a line-oriented report the workflow can
 * sanitize. The private key is not an input. The RPC URL is never printed.
 *
 *   bun run scripts/mainnet-e2e-balance.ts preflight
 *   bun run scripts/mainnet-e2e-balance.ts post
 *
 * Requires MAINNET_E2E_ADDRESS, MAINNET_E2E_RPC_URL, MAINNET_E2E_BALANCE_FILE,
 * and MAINNET_E2E_REPORT_FILE. MAINNET_E2E_SPEND_TIER is `standard` or `strk20`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { isRecord } from "@bramble/core/json";
import { type RpcFetch, readHotWalletBalances, starknetAddress } from "./mainnet-e2e-rpc";
import {
  type BalanceJudgement,
  type BalancePair,
  formatSignedAmount,
  judgeBalances,
  parseSpendTier,
  type SpendTier,
  spendCeilings,
} from "./mainnet-e2e-spend";

type Phase = "post" | "preflight";

type Snapshot = {
  readonly strk: bigint;
  readonly tier: SpendTier;
  readonly usdc: bigint;
};

const envValue = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
};

const phaseOf = (value: string | undefined): Phase => {
  if (value === "preflight" || value === "post") return value;
  throw new Error("Usage: mainnet-e2e-balance.ts preflight|post");
};

const writeText = async (path: string, text: string): Promise<void> => {
  await writeFile(path, text, { mode: 0o600 });
};

const snapshotText = (snapshot: Snapshot): string =>
  `${JSON.stringify({
    strk: snapshot.strk.toString(),
    tier: snapshot.tier,
    usdc: snapshot.usdc.toString(),
  })}\n`;

const readSnapshot = async (path: string, tier: SpendTier): Promise<Snapshot> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error("Preflight balance file is unreadable");
  }
  if (
    !isRecord(parsed) ||
    typeof parsed["strk"] !== "string" ||
    typeof parsed["usdc"] !== "string" ||
    typeof parsed["tier"] !== "string" ||
    !/^[0-9]+$/.test(parsed["strk"]) ||
    !/^[0-9]+$/.test(parsed["usdc"])
  ) {
    throw new Error("Preflight balance file is unreadable");
  }
  if (parsed["tier"] !== tier) {
    throw new Error("Preflight balance file does not match this run's spend tier");
  }
  return { strk: BigInt(parsed["strk"]), tier, usdc: BigInt(parsed["usdc"]) };
};

const reportText = (input: {
  readonly address: string;
  readonly after: BalancePair;
  readonly before: BalancePair;
  readonly judgement: BalanceJudgement;
  readonly tier: SpendTier;
}): string => {
  const ceilings = spendCeilings(input.tier);
  const lines = [
    `address=${input.address}`,
    `tier=${input.tier}`,
    `verdict=${input.judgement.kind}`,
    `strk_before=${formatSignedAmount(input.before.strk, ceilings.strk.decimals)}`,
    `strk_after=${formatSignedAmount(input.after.strk, ceilings.strk.decimals)}`,
    `strk_delta=${formatSignedAmount(input.judgement.strkDelta, ceilings.strk.decimals)}`,
    `usdc_before=${formatSignedAmount(input.before.usdc, ceilings.usdc.decimals)}`,
    `usdc_after=${formatSignedAmount(input.after.usdc, ceilings.usdc.decimals)}`,
    `usdc_delta=${formatSignedAmount(input.judgement.usdcDelta, ceilings.usdc.decimals)}`,
  ];
  return `${lines.join("\n")}\n`;
};

const safeError = (error: unknown, rpcUrl: string): string => {
  const message = error instanceof Error ? error.message : "Mainnet balance check failed";
  const redacted = rpcUrl.length > 0 ? message.split(rpcUrl).join("[redacted]") : message;
  return redacted.slice(0, 300);
};

/**
 * Runs one balance phase against `env`. Returns 0 when the policy accepts the
 * reading and 1 otherwise. `fetchImpl` stubs the RPC in tests; the CLI uses
 * the platform fetch. Writes the report file even when the policy refuses.
 */
export const runBalanceCommand = async (
  phaseArg: string | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl?: RpcFetch,
): Promise<number> => {
  const reportPath = env["MAINNET_E2E_REPORT_FILE"];
  const rpcUrl = env["MAINNET_E2E_RPC_URL"] ?? "";
  try {
    const phase = phaseOf(phaseArg);
    const tier = parseSpendTier(env["MAINNET_E2E_SPEND_TIER"]);
    const address = starknetAddress(env["MAINNET_E2E_ADDRESS"]);
    const balancePath = envValue(env, "MAINNET_E2E_BALANCE_FILE");
    if (reportPath === undefined || reportPath.length === 0) {
      throw new Error("MAINNET_E2E_REPORT_FILE is required");
    }
    const stored = phase === "post" ? await readSnapshot(balancePath, tier) : null;
    const balances = await readHotWalletBalances({
      address,
      rpcUrl: envValue(env, "MAINNET_E2E_RPC_URL"),
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    const before = stored ?? balances;
    const after = balances;
    if (phase === "preflight") {
      await writeText(
        balancePath,
        snapshotText({ strk: balances.strk, tier, usdc: balances.usdc }),
      );
    }
    const judgement = judgeBalances({ after, before, phase, tier });
    await writeText(reportPath, reportText({ address, after, before, judgement, tier }));
    if (judgement.kind !== "ok") {
      console.error(judgement.message);
      return 1;
    }
    console.log(judgement.message);
    return 0;
  } catch (error) {
    if (reportPath !== undefined && reportPath.length > 0) {
      await writeText(reportPath, "verdict=unavailable\n").catch(() => undefined);
    }
    console.error(safeError(error, rpcUrl));
    return 1;
  }
};

if (import.meta.main) {
  process.exit(await runBalanceCommand(process.argv[2], process.env));
}
