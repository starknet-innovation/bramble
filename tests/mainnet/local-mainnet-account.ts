/**
 * Loads the developer's sncast mainnet account for the opt-in wallet suite.
 * The signing key stays in the ready result and is never copied into a
 * message. CI, a missing acknowledgement, a shared RPC, a non-mainnet chain,
 * and an account class this wallet will not import all stop before a browser
 * starts.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isRecord } from "@bramble/core/json";
import { isContractNotFoundError } from "@bramble/starknet/rpc";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isStarkPrivateKey,
  STARKNET_NETWORKS,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { RpcProvider } from "starknet";
import {
  type GaslessE2eEnv,
  loadGaslessMainnetAccount,
} from "../../scripts/gasless-mainnet-account";
import {
  classifyLocalMainnetEnv,
  dedicatedHttpsRpcUrl,
  localOnlyMessage,
  MAINNET_WRITE_ACK,
} from "./mainnet-safety";

/** Printed by the npm script when the developer has not opted in. Exit 0. */
export const LOCAL_MAINNET_SKIP_MESSAGE = `Skipping local mainnet wallet tests: no account configured.
Set BRAMBLE_MAINNET_E2E_ACK, BRAMBLE_MAINNET_E2E_RPC_URL, and BRAMBLE_MAINNET_SNCAST_ACCOUNT
(or BRAMBLE_MAINNET_E2E_ADDRESS with BRAMBLE_MAINNET_E2E_PRIVATE_KEY).
See docs/MAINNET_E2E.md.`;

/** Account the suite may import. `label` never contains the signing key. */
export type LocalMainnetAccount = {
  readonly address: string;
  readonly label: string;
  readonly privateKey: string;
  readonly rpcUrl: string;
};

/** Why the suite should not open a browser, or the account it may use. */
export type LocalMainnetLoad =
  | { readonly account: LocalMainnetAccount; readonly kind: "ready" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "skip"; readonly message: string };

/** On-chain class hash read. `missing` is an undeployed address. */
type ClassHashRead =
  | { readonly classHash: string; readonly kind: "found" }
  | { readonly kind: "missing" }
  | { readonly kind: "unreachable" };

/** Injected chain reads so unit tests never dial a network. */
export type LocalMainnetProbe = {
  readonly chainId: (rpcUrl: string) => Promise<string | null>;
  readonly classHash: (rpcUrl: string, address: string) => Promise<ClassHashRead>;
};

const present = (
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined => {
  const value = env[key];
  return value !== undefined && value.length > 0 ? value : undefined;
};

const gaslessEnv = (
  env: Readonly<Record<string, string | undefined>>,
  rpcUrl: string,
): GaslessE2eEnv => {
  const account = present(env, "BRAMBLE_MAINNET_SNCAST_ACCOUNT");
  const accountsFile = present(env, "BRAMBLE_MAINNET_SNCAST_ACCOUNTS_FILE");
  const address = present(env, "BRAMBLE_MAINNET_E2E_ADDRESS");
  const privateKey = present(env, "BRAMBLE_MAINNET_E2E_PRIVATE_KEY");
  const profile = present(env, "BRAMBLE_MAINNET_SNCAST_PROFILE");
  const snfoundry = present(env, "BRAMBLE_MAINNET_SNFOUNDRY");
  return {
    network: "mainnet",
    rpcUrl,
    ...(account ? { account } : {}),
    ...(accountsFile ? { accountsFile } : {}),
    ...(address ? { address } : {}),
    ...(privateKey ? { privateKey } : {}),
    ...(profile ? { profile } : {}),
    ...(snfoundry ? { snfoundry } : {}),
  };
};

const readChainId = async (rpcUrl: string): Promise<string | null> => {
  try {
    const response = await fetch(rpcUrl, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "starknet_chainId", params: [] }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json()) as unknown;
    if (!response.ok || !isRecord(body) || typeof body["result"] !== "string") {
      return null;
    }
    return body["result"];
  } catch {
    return null;
  }
};

const readClassHash = async (rpcUrl: string, address: string): Promise<ClassHashRead> => {
  try {
    const provider = new RpcProvider({ nodeUrl: rpcUrl });
    const classHash = await provider.getClassHashAt(address);
    const canonical = typeof classHash === "string" ? canonicalFelt(classHash) : null;
    return canonical === null ? { kind: "unreachable" } : { classHash: canonical, kind: "found" };
  } catch (error) {
    return isContractNotFoundError(error) ? { kind: "missing" } : { kind: "unreachable" };
  }
};

const defaultProbe = (): LocalMainnetProbe => ({
  chainId: readChainId,
  classHash: readClassHash,
});

const rpcUrlFrom = (
  env: Readonly<Record<string, string | undefined>>,
): LocalMainnetLoad | string => {
  try {
    return dedicatedHttpsRpcUrl(env["BRAMBLE_MAINNET_E2E_RPC_URL"], "BRAMBLE_MAINNET_E2E_RPC_URL");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid RPC URL";
    return { kind: "error", message };
  }
};

const assertChain = async (rpcUrl: string, probe: LocalMainnetProbe): Promise<string | null> => {
  const chainId = await probe.chainId(rpcUrl);
  if (chainId !== null && sameFelt(chainId, STARKNET_NETWORKS.SN_MAIN.chainId)) {
    return null;
  }
  return chainId === null
    ? "BRAMBLE_MAINNET_E2E_RPC_URL did not return Starknet mainnet."
    : `BRAMBLE_MAINNET_E2E_RPC_URL returned chain ${chainId}, not Starknet mainnet.`;
};

const assertClass = async (
  rpcUrl: string,
  address: string,
  probe: LocalMainnetProbe,
): Promise<string | null> => {
  const read = await probe.classHash(rpcUrl, address);
  if (read.kind === "missing") {
    return "The sncast account is not deployed on mainnet. Run sncast account deploy.";
  }
  if (read.kind === "unreachable") {
    return "Could not read the account class from the dedicated RPC.";
  }
  if (sameFelt(read.classHash, OPENZEPPELIN_ACCOUNT_CLASS_HASH)) {
    return null;
  }
  return `The account class is ${read.classHash}, not the OpenZeppelin class ${OPENZEPPELIN_ACCOUNT_CLASS_HASH} this wallet imports. See docs/MAINNET_E2E.md.`;
};

/**
 * Resolves the mainnet account from `env` and an sncast file. `skip` means
 * the developer did not opt in. `error` means they did, and the configuration
 * cannot be used. Neither of those results contains a signing key.
 */
export const loadLocalMainnetAccount = async (input: {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly probe?: LocalMainnetProbe;
  readonly readText: (path: string) => Promise<string | null>;
}): Promise<LocalMainnetLoad> => {
  const classified = classifyLocalMainnetEnv(input.env);
  if (classified === "blocked") {
    return { kind: "error", message: localOnlyMessage("local mainnet wallet suite") };
  }
  if (classified === "skip") {
    return { kind: "skip", message: LOCAL_MAINNET_SKIP_MESSAGE };
  }
  if (input.env["BRAMBLE_MAINNET_E2E_ACK"] !== MAINNET_WRITE_ACK) {
    return {
      kind: "error",
      message: `Set BRAMBLE_MAINNET_E2E_ACK=${MAINNET_WRITE_ACK} to permit mainnet writes`,
    };
  }
  const rpcUrl = rpcUrlFrom(input.env);
  if (typeof rpcUrl !== "string") {
    return rpcUrl;
  }
  const loaded = await loadGaslessMainnetAccount({
    cwd: input.cwd,
    env: gaslessEnv(input.env, rpcUrl),
    home: input.home,
    readText: input.readText,
  });
  if (loaded.kind === "skip") {
    return {
      kind: "error",
      message:
        "Name the sncast account with BRAMBLE_MAINNET_SNCAST_ACCOUNT, or set BRAMBLE_MAINNET_E2E_ADDRESS and BRAMBLE_MAINNET_E2E_PRIVATE_KEY.",
    };
  }
  if (loaded.kind === "error") {
    return loaded;
  }
  if (!isStarkPrivateKey(loaded.account.privateKey)) {
    return { kind: "error", message: "The account key is not a valid Stark signing key." };
  }
  const probe = input.probe ?? defaultProbe();
  const chainError = await assertChain(rpcUrl, probe);
  if (chainError !== null) {
    return { kind: "error", message: chainError };
  }
  const classError = await assertClass(rpcUrl, loaded.account.address, probe);
  if (classError !== null) {
    return { kind: "error", message: classError };
  }
  return {
    account: {
      address: loaded.account.address,
      label: loaded.account.label,
      privateKey: loaded.account.privateKey,
      rpcUrl,
    },
    kind: "ready",
  };
};

const readTextFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

let processLoad: Promise<LocalMainnetLoad> | undefined;

/**
 * Loads the account from this process's environment, once. The cached promise
 * keeps a worker that imports several specs from dialing the RPC for each file.
 */
export const loadLocalMainnetFromProcess = (): Promise<LocalMainnetLoad> => {
  processLoad ??= loadLocalMainnetAccount({
    cwd: process.cwd(),
    env: process.env,
    home: homedir(),
    readText: readTextFile,
  });
  return processLoad;
};

/**
 * The account the Playwright specs may import. Throws the loader message when
 * the process is not ready, and that message does not contain the signing key.
 */
export const requireLocalMainnetAccount = async (): Promise<LocalMainnetAccount> => {
  const loaded = await loadLocalMainnetFromProcess();
  if (loaded.kind !== "ready") {
    throw new Error(loaded.message);
  }
  return loaded.account;
};
