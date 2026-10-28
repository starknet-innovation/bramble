/**
 * Loads the opt-in mainnet account for the gasless integration script.
 * Reads an sncast accounts file or direct environment variables. The private
 * key stays in the returned value and is never included in a message.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isRecord } from "../packages/foundation/core/src/json";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  STARKNET_NETWORKS,
} from "../packages/foundation/wallet-model/src/networks/networks";

/** Printed when nothing names an account. Exit zero follows this message. */
export const GASLESS_MAINNET_SKIP_MESSAGE = `Skipping gasless mainnet test: no account configured.
Set GASLESS_E2E_ADDRESS and GASLESS_E2E_PRIVATE_KEY, or GASLESS_E2E_ACCOUNT for an sncast account.
See docs/GASLESS_MAINNET.md.`;

/** Account the live script may sign with. `label` never contains the key. */
export type LoadedMainnetAccount = {
  readonly address: string;
  readonly label: string;
  readonly privateKey: string;
  readonly publicKey: string | null;
  readonly rpcUrl: string;
};

/** Why the script should stop before any transaction. */
export type MainnetAccountLoad =
  | { readonly account: LoadedMainnetAccount; readonly kind: "ready" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "skip"; readonly message: string };

/** Environment the loader reads. Tests pass a fixture instead of the process. */
export type GaslessE2eEnv = {
  readonly account?: string;
  readonly accountsFile?: string;
  readonly address?: string;
  readonly network?: string;
  readonly privateKey?: string;
  readonly profile?: string;
  readonly rpcUrl?: string;
  readonly snfoundry?: string;
};

type TomlSections = ReadonlyMap<string, Readonly<Record<string, string>>>;

const DEFAULT_RPC = STARKNET_NETWORKS.SN_MAIN.rpcUrls[0];

const expandHome = (path: string, home: string): string =>
  path.startsWith("~/") ? join(home, path.slice(2)) : path;

const parseToml = (text: string): TomlSections => {
  const sections = new Map<string, Record<string, string>>();
  let current = "";
  sections.set(current, {});
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const header = /^\[([^\]]+)]$/.exec(line);
    if (header?.[1]) {
      current = header[1].trim();
      if (!sections.has(current)) sections.set(current, {});
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const section = sections.get(current);
    if (section) section[key] = value;
  }
  return sections;
};

const profileName = (sections: TomlSections, env: GaslessE2eEnv): string | null => {
  if (env.profile && env.profile.length > 0) return env.profile;
  if (sections.has("sncast.mainnet")) return "mainnet";
  if (sections.has("sncast.alpha-mainnet")) return "alpha-mainnet";
  if (sections.has("sncast.default")) return "default";
  return null;
};

const networkBuckets = (network: string | undefined): readonly string[] | null => {
  if (network === undefined || network.length === 0) return ["alpha-mainnet", "mainnet"];
  const name = network.toLowerCase();
  if (name === "mainnet" || name === "alpha-mainnet") return ["alpha-mainnet", "mainnet"];
  return null;
};

const feltOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const canonical = canonicalFelt(value.trim());
  return canonical !== null && isNonZeroStarkFieldElement(canonical) ? canonical : null;
};

const readRecord = (
  value: unknown,
): {
  readonly address: string;
  readonly privateKey: string;
  readonly publicKey: string | null;
} | null => {
  if (!isRecord(value)) return null;
  const address = feltOrNull(value["address"]);
  const privateKey = feltOrNull(value["private_key"]);
  if (address === null || privateKey === null) return null;
  return { address, privateKey, publicKey: feltOrNull(value["public_key"]) };
};

const deployedFlag = (value: unknown): boolean | null => {
  if (!isRecord(value) || value["deployed"] === undefined) return null;
  return value["deployed"] === true;
};

type FoundAccount = {
  readonly address: string;
  readonly bucket: string;
  readonly privateKey: string;
  readonly publicKey: string | null;
};

const findNamed = (
  parsed: unknown,
  name: string,
  buckets: readonly string[],
): FoundAccount | { readonly kind: "error"; readonly message: string } => {
  if (!isRecord(parsed)) return { kind: "error", message: "Accounts file is not a JSON object." };
  for (const bucket of buckets) {
    const network = parsed[bucket];
    if (!isRecord(network) || !Object.hasOwn(network, name)) continue;
    const record = readRecord(network[name]);
    if (record === null) {
      return {
        kind: "error",
        message: `Account ${name} on ${bucket} has no usable address or key.`,
      };
    }
    if (deployedFlag(network[name]) === false) {
      return {
        kind: "error",
        message: `Account ${name} on ${bucket} is not deployed. Run sncast account deploy.`,
      };
    }
    return { ...record, bucket };
  }
  return {
    kind: "error",
    message: `Account ${name} was not found on mainnet in the accounts file.`,
  };
};

const rpcUrlFor = (env: GaslessE2eEnv, sections: TomlSections, profile: string | null): string => {
  if (env.rpcUrl && env.rpcUrl.length > 0) return env.rpcUrl;
  const section = profile === null ? undefined : sections.get(`sncast.${profile}`);
  if (section?.["url"]) return section["url"];
  const networks = profile === null ? undefined : sections.get(`sncast.${profile}.networks`);
  if (networks?.["mainnet"]) return networks["mainnet"];
  if (DEFAULT_RPC === undefined) return "";
  return DEFAULT_RPC;
};

const walkSnfoundry = async (
  cwd: string,
  readText: (path: string) => Promise<string | null>,
): Promise<string | null> => {
  let dir = cwd;
  for (let depth = 0; depth < 8; depth += 1) {
    const path = join(dir, "snfoundry.toml");
    const text = await readText(path);
    if (text !== null) return text;
    const parent = join(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
};

const ready = (
  account: Omit<LoadedMainnetAccount, "rpcUrl">,
  rpcUrl: string,
): MainnetAccountLoad =>
  rpcUrl.length === 0
    ? { kind: "error", message: "No mainnet RPC URL is configured." }
    : { account: { ...account, rpcUrl }, kind: "ready" };

/**
 * Resolves the mainnet account from `env`, an sncast file, and `snfoundry.toml`.
 * `skip` means the developer did not opt in. `error` means they did, and the
 * configuration cannot be used. Neither result contains a private key.
 */
export const loadGaslessMainnetAccount = async (input: {
  readonly cwd: string;
  readonly env: GaslessE2eEnv;
  readonly home: string;
  readonly readText: (path: string) => Promise<string | null>;
}): Promise<MainnetAccountLoad> => {
  const buckets = networkBuckets(input.env.network);
  if (buckets === null) {
    return { kind: "error", message: "This test runs on Starknet mainnet only." };
  }
  const tomlText = input.env.snfoundry
    ? await input.readText(expandHome(input.env.snfoundry, input.home))
    : await walkSnfoundry(input.cwd, input.readText);
  const sections = parseToml(tomlText ?? "");
  const profile = profileName(sections, input.env);
  if (profile === "sepolia" || profile === "alpha-sepolia") {
    return { kind: "error", message: "This test runs on Starknet mainnet only." };
  }
  const rpcUrl = rpcUrlFor(input.env, sections, profile);
  const directAddress = input.env.address;
  const directKey = input.env.privateKey;
  if ((directAddress && directAddress.length > 0) || (directKey && directKey.length > 0)) {
    const address = feltOrNull(directAddress);
    const privateKey = feltOrNull(directKey);
    if (address === null || privateKey === null) {
      return {
        kind: "error",
        message: "GASLESS_E2E_ADDRESS and GASLESS_E2E_PRIVATE_KEY must both be non-zero felts.",
      };
    }
    return ready({ address, label: `env ${address}`, privateKey, publicKey: null }, rpcUrl);
  }
  const profileSection = profile === null ? undefined : sections.get(`sncast.${profile}`);
  const name = input.env.account ?? profileSection?.["account"];
  if (!name) return { kind: "skip", message: GASLESS_MAINNET_SKIP_MESSAGE };
  const accountsFile = expandHome(
    input.env.accountsFile ??
      profileSection?.["accounts-file"] ??
      join(input.home, ".starknet_accounts", "starknet_open_zeppelin_accounts.json"),
    input.home,
  );
  const text = await input.readText(accountsFile);
  if (text === null) {
    return { kind: "error", message: `Accounts file not found: ${accountsFile}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { kind: "error", message: `Accounts file is not valid JSON: ${accountsFile}` };
  }
  const found = findNamed(parsed, name, buckets);
  if ("kind" in found) return found;
  return ready(
    {
      address: found.address,
      label: `sncast ${found.bucket}/${name} ${found.address}`,
      privateKey: found.privateKey,
      publicKey: found.publicKey,
    },
    rpcUrl,
  );
};

/** Process environment mapped onto {@link GaslessE2eEnv}. The key is not logged. */
const gaslessE2eEnv = (env: NodeJS.ProcessEnv = process.env): GaslessE2eEnv => ({
  ...(env["GASLESS_E2E_ACCOUNT"] ? { account: env["GASLESS_E2E_ACCOUNT"] } : {}),
  ...(env["GASLESS_E2E_ACCOUNTS_FILE"] ? { accountsFile: env["GASLESS_E2E_ACCOUNTS_FILE"] } : {}),
  ...(env["GASLESS_E2E_ADDRESS"] ? { address: env["GASLESS_E2E_ADDRESS"] } : {}),
  ...(env["GASLESS_E2E_NETWORK"] ? { network: env["GASLESS_E2E_NETWORK"] } : {}),
  ...(env["GASLESS_E2E_PRIVATE_KEY"] ? { privateKey: env["GASLESS_E2E_PRIVATE_KEY"] } : {}),
  ...(env["GASLESS_E2E_PROFILE"] ? { profile: env["GASLESS_E2E_PROFILE"] } : {}),
  ...(env["GASLESS_E2E_RPC_URL"] ? { rpcUrl: env["GASLESS_E2E_RPC_URL"] } : {}),
  ...(env["GASLESS_E2E_SNFOUNDRY"] ? { snfoundry: env["GASLESS_E2E_SNFOUNDRY"] } : {}),
});

/** Reads a text file, or null when it does not exist. */
const readTextFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
};

/** Loads the account from the developer machine. */
export const loadProcessAccount = (): Promise<MainnetAccountLoad> =>
  loadGaslessMainnetAccount({
    cwd: process.cwd(),
    env: gaslessE2eEnv(),
    home: homedir(),
    readText: readTextFile,
  });
