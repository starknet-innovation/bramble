/**
 * Opt-in Starknet mainnet gasless integration. Not part of `bun run check`.
 * Uses the wallet's quote, ceiling, typed-data check, and submit. Signs with
 * the configured account key. Prints the transaction hash and explorer links,
 * and the reason each curated token was skipped. Skips with exit 0 when no
 * account is configured.
 */

import { RpcProvider } from "starknet";
import { knownTokensForNetwork } from "../packages/features/portfolio/src/tokens/token-registry";
import { accountSignsGaslessV2 } from "../packages/features/transactions/src/gasless/gasless-account";
import {
  GASLESS_FEES_ENABLED,
  type GaslessRoute,
  gaslessRoute,
} from "../packages/features/transactions/src/gasless/gasless-config";
import { GaslessRefusal } from "../packages/features/transactions/src/gasless/gasless-errors";
import { readGaslessSupportedTokens } from "../packages/features/transactions/src/gasless/gasless-request";
import { postGasless } from "../packages/features/transactions/src/gasless/gasless-rpc";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  XVERSE_ARGENT_CLASS_HASH,
} from "../packages/foundation/wallet-model/src/accounts/account-families";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "../packages/foundation/wallet-model/src/accounts/accounts";
import {
  canonicalFelt,
  STRK_TOKEN_ADDRESS,
  sameFelt,
} from "../packages/foundation/wallet-model/src/networks/networks";
import { type LoadedMainnetAccount, loadProcessAccount } from "./gasless-mainnet-account";
import { payWithToken, recordingHttp } from "./gasless-mainnet-attempt";
import { displayRpcUrl, selectMainnetRpc } from "./gasless-mainnet-rpc";

const PIN = "0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f";

type ReadyRoute = GaslessRoute & { readonly enabled: true; readonly forwarder: string };
type Family = "argent" | "openzeppelin";

const redact = (message: string, key: string): string => message.split(key).join("[redacted]");

const requireRoute = (): ReadyRoute => {
  const route = gaslessRoute("SN_MAIN");
  if (
    GASLESS_FEES_ENABLED.SN_SEPOLIA !== false ||
    route === null ||
    route.enabled !== true ||
    route.forwarder !== PIN
  ) {
    throw new Error("Mainnet gasless route is not the pinned, enabled route.");
  }
  return { ...route, enabled: true, forwarder: PIN };
};

const familyFor = (classHash: string): Family | null => {
  if (sameFelt(classHash, OPENZEPPELIN_ACCOUNT_CLASS_HASH)) return "openzeppelin";
  if (
    sameFelt(classHash, ARGENT_ACCOUNT_CLASS_HASH) ||
    sameFelt(classHash, XVERSE_ARGENT_CLASS_HASH)
  ) {
    return "argent";
  }
  return null;
};

const refusal = async (run: () => Promise<unknown>): Promise<GaslessRefusal> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof GaslessRefusal) return error;
    throw error;
  }
  throw new Error("Expected a gasless refusal.");
};

/**
 * Runs the live mainnet path for one configured account. Throws on failure.
 * Each curated token prints why it was skipped before the next one is tried.
 */
const runGaslessMainnet = async (account: LoadedMainnetAccount): Promise<void> => {
  const route = requireRoute();
  const transport = recordingHttp();
  const rpc = await selectMainnetRpc({
    configuredSource: account.rpcSource,
    configuredUrl: account.rpcUrl,
  });
  console.log(`Account ${account.label}`);
  console.log(`RPC ${displayRpcUrl(rpc.url)}`);
  console.log(`RPC source ${rpc.source}`);
  if (rpc.note) console.log(rpc.note);
  const provider = new RpcProvider({ nodeUrl: rpc.url });
  const classHashRaw = await provider.getClassHashAt(account.address);
  const classHash = canonicalFelt(String(classHashRaw));
  const family = classHash === null ? null : familyFor(classHash);
  const signs =
    classHash !== null &&
    family !== null &&
    accountSignsGaslessV2({ accountContractType: family, classHash, deployed: true });
  if (!signs || classHash === null || family === null) {
    throw new Error(
      `Class ${String(classHashRaw)} cannot sign gasless v2. Deploy OpenZeppelin ${OPENZEPPELIN_ACCOUNT_CLASS_HASH}.`,
    );
  }
  console.log(`Class ${classHash} (${family}).`);
  const available = await postGasless(transport.http, route.url, "paymaster_isAvailable", [], {
    executes: false,
  });
  if (available !== true) throw new Error("paymaster_isAvailable did not return true.");
  console.log("paymaster_isAvailable: true");
  const mapped = await refusal(() =>
    postGasless(transport.http, route.url, "paymaster_buildTransaction", [{ not: "valid" }], {
      executes: false,
    }),
  );
  if (mapped.code !== "invalid_gasless_request") {
    throw new Error(`Expected invalid_gasless_request, got ${mapped.code}.`);
  }
  if (transport.executed() !== 0) {
    throw new Error("Error-code check posted paymaster_executeTransaction.");
  }
  console.log("Malformed build returned invalid_gasless_request and was not executed.");
  const supported = readGaslessSupportedTokens(
    await postGasless(transport.http, route.url, "paymaster_getSupportedTokens", [], {
      executes: false,
    }),
  );
  if (supported === null) {
    console.log(
      `response ${transport.lastExchange().status} ${transport.lastExchange().text.slice(0, 4000)}`,
    );
    throw new Error("paymaster_getSupportedTokens was not a list of address and decimals.");
  }
  console.log(`Paymaster lists ${supported.length} tokens.`);
  const known = knownTokensForNetwork("SN_MAIN").filter(
    (token) => !sameFelt(token.address, STRK_TOKEN_ADDRESS),
  );
  const usdc = known.find((token) => token.symbol === "USDC");
  const ordered = usdc === undefined ? known : [usdc, ...known.filter((token) => token !== usdc)];
  for (const token of ordered) {
    const paid = await payWithToken({
      account,
      classHash,
      family,
      listed: supported,
      provider,
      route,
      token,
      transport,
    });
    if (paid) return;
  }
  throw new Error("No curated token produced a gasless quote under the ceiling.");
};

const main = async (): Promise<number> => {
  const loaded = await loadProcessAccount();
  if (loaded.kind === "skip") {
    console.log(loaded.message);
    return 0;
  }
  if (loaded.kind === "error") {
    console.error(loaded.message);
    return 1;
  }
  try {
    await runGaslessMainnet(loaded.account);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "gasless mainnet test failed";
    console.error(redact(message, loaded.account.privateKey));
    return 1;
  }
};

if (import.meta.main) {
  process.exit(await main());
}
