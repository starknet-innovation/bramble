/**
 * Preflight and post-run balance check for the mainnet E2E job.
 *
 * Reads STRK and native USDC through the dedicated RPC, compares them with
 * the spend policy, and writes a line-oriented `key=value` report. The private
 * key is not an input. The RPC URL is never printed.
 *
 *   bun run scripts/mainnet-e2e-balance.ts preflight
 *   bun run scripts/mainnet-e2e-balance.ts post
 *
 * The workflow runs both phases from the workflow's own `main` checkout, in
 * hosted jobs that never hold the signing key or the release commit. The
 * preflight's raw balances travel to `post` as job outputs
 * (MAINNET_E2E_STRK_BEFORE_RAW, MAINNET_E2E_USDC_BEFORE_RAW), so code under
 * test cannot rewrite the baseline its spend is measured against.
 *
 * Requires MAINNET_E2E_ADDRESS, MAINNET_E2E_RPC_URL, and
 * MAINNET_E2E_REPORT_FILE. MAINNET_E2E_SPEND_TIER is `standard` or `strk20`.
 */

import { writeFile } from "node:fs/promises";
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

const RAW_AMOUNT = /^(0|[1-9][0-9]{0,77})$/;

const readBefore = (env: NodeJS.ProcessEnv): BalancePair => {
  const strk = env["MAINNET_E2E_STRK_BEFORE_RAW"] ?? "";
  const usdc = env["MAINNET_E2E_USDC_BEFORE_RAW"] ?? "";
  if (!RAW_AMOUNT.test(strk) || !RAW_AMOUNT.test(usdc)) {
    throw new Error("Preflight balances are missing or malformed");
  }
  return { strk: BigInt(strk), usdc: BigInt(usdc) };
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
    `strk_before_raw=${input.before.strk.toString()}`,
    `usdc_before_raw=${input.before.usdc.toString()}`,
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
 * the platform fetch. Writes the report file even when the policy refuses, and
 * writes `verdict=unavailable` alone when the balances cannot be read. A
 * missing or malformed preflight baseline fails `post` closed.
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
    if (reportPath === undefined || reportPath.length === 0) {
      throw new Error("MAINNET_E2E_REPORT_FILE is required");
    }
    const stored = phase === "post" ? readBefore(env) : null;
    const balances = await readHotWalletBalances({
      address,
      rpcUrl: envValue(env, "MAINNET_E2E_RPC_URL"),
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    const before = stored ?? balances;
    const after = balances;
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
