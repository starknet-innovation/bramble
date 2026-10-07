/**
 * Shared plumbing for the Phase-3 matrix: env seeds, vendor derivations,
 * address shapes, the deployer account, token transfers, and the manifest
 * ledger. Never logs or returns seed words; private keys stay inside account
 * objects. Everything is idempotent-friendly: callers check chain state first.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { grindKey, getStarkKey } from "@scure/starknet";
import { Account, RpcProvider, hash, uint256 } from "starknet";

export const NODE = "https://mainnet.nodes.starknet.org/rpc/v0_10";
const ENV_PATH = "/Users/henri/Workshop/mc-wallet/.env.vendor-seeds.local";
export const MANIFEST_PATH =
  "/private/tmp/claude-501/-Users-henri-Workshop-mc-wallet/f23bc925-416e-417b-ac94-2b651f242887/scratchpad/dataset/manifest.json";

export const CLASSES = {
  argent040: "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f",
  argent031: "0x029927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b",
  argent030: "0x01a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003",
  braavosDeploy: "0x03d16c7a9a60b0593bd202f660a28c5d76e0403601d9ccc7e4fa253b6a70c201",
  oz300: "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381",
} as const;

export const TOKENS = {
  STRK: { address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d", decimals: 18 },
  ETH: { address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7", decimals: 18 },
  // Circle-native USDC (what users hold since the bridged->native migration),
  // NOT the legacy StarkGate-bridged 0x053c9125… token.
  USDC: { address: "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb", decimals: 6 },
} as const;

export const provider = new RpcProvider({ nodeUrl: NODE });

export function envSeed(name: string): string {
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(new RegExp(`^${name}="?([^"]+)"?\\s*$`));
    if (m && m[1].trim()) return m[1].trim();
  }
  throw new Error(`${name} is empty`);
}

type Keypair = { readonly priv: string; readonly pub: string };

/** Ready/Argent X: ETH key at m/44'/60'/0'/0/0 seeds the stark tree. */
export function readyKeypair(mnemonic: string, index: number, passphrase = ""): Keypair {
  const eth = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase)).derive(
    "m/44'/60'/0'/0/0",
  );
  if (!eth.privateKey) throw new Error("derivation failed");
  const node = HDKey.fromMasterSeed(eth.privateKey).derive(`m/44'/9004'/0'/0/${index}`);
  if (!node.privateKey) throw new Error("derivation failed");
  const priv = "0x" + grindKey(node.privateKey);
  return { priv, pub: getStarkKey(priv) };
}

/** Braavos: BIP-39 seed directly, address axis. */
export function braavosKeypair(mnemonic: string, index: number, passphrase = ""): Keypair {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase)).derive(
    `m/44'/9004'/0'/0/${index}`,
  );
  if (!node.privateKey) throw new Error("derivation failed");
  const priv = "0x" + grindKey(node.privateKey);
  return { priv, pub: getStarkKey(priv) };
}

export const argentAddress = (pub: string, cls: string): string =>
  "0x" +
  BigInt(
    cls === CLASSES.argent040
      ? hash.calculateContractAddressFromHash(pub, cls, ["0x0", pub, "0x1"], 0)
      : hash.calculateContractAddressFromHash(pub, cls, [pub, "0x0"], 0),
  ).toString(16);

export const argentConstructor = (pub: string, cls: string): string[] =>
  cls === CLASSES.argent040 ? ["0x0", pub, "0x1"] : [pub, "0x0"];

export function deployerAccount(): Account {
  const seed = envSeed("BRAMBLE_DATASET_SEED_DEPLOYER");
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(seed)).derive("m/44'/9004'/0'/0/0");
  if (!node.privateKey) throw new Error("derivation failed");
  const priv = "0x" + grindKey(node.privateKey);
  const pub = getStarkKey(priv);
  const address = "0x" + BigInt(hash.calculateContractAddressFromHash(pub, CLASSES.oz300, [pub], 0)).toString(16);
  return new Account({ provider, address, signer: priv, cairoVersion: "1" });
}

export async function tokenBalance(token: keyof typeof TOKENS, holder: string): Promise<bigint> {
  const res = await provider.callContract({
    contractAddress: TOKENS[token].address,
    entrypoint: "balanceOf",
    calldata: [holder],
  });
  return uint256.uint256ToBN({ low: res[0], high: res[1] });
}

export async function classAt(address: string): Promise<string | null> {
  return provider.getClassHashAt(address).catch(() => null);
}

export async function transfer(
  from: Account,
  token: keyof typeof TOKENS,
  to: string,
  amount: bigint,
): Promise<string> {
  const u = uint256.bnToUint256(amount);
  const { transaction_hash } = await from.execute({
    contractAddress: TOKENS[token].address,
    entrypoint: "transfer",
    calldata: [to, u.low, u.high],
  });
  await provider.waitForTransaction(transaction_hash);
  return transaction_hash;
}

export type ManifestEntry = {
  readonly id: string;
  readonly seed: string; // env var name, never words
  readonly vendorDerivation: "ready-double" | "braavos-direct";
  readonly index: number;
  readonly passphrase?: boolean;
  readonly address: string;
  readonly pubkey: string;
  readonly classAtDeploy: string | null;
  readonly expected: string;
  readonly detectability: "D1" | "D2" | "D3" | "D4" | "D5";
  readonly backedBy: "none" | "vendor-backend" | "simulated";
  state: Record<string, unknown>;
  log: string[];
};

export function loadManifest(): Record<string, ManifestEntry> {
  if (!existsSync(MANIFEST_PATH)) return {};
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

export function saveManifest(m: Record<string, ManifestEntry>): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
}
