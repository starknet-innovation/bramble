/**
 * Deploys the dataset deployer account (OZ 3.0.0, salt = pubkey) via
 * DEPLOY_ACCOUNT v3, paid from its own pre-funded balance. Idempotent: exits
 * quietly if the account is already deployed. Prints only public data.
 */
import { readFileSync } from "node:fs";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { grindKey, getStarkKey } from "@scure/starknet";
import { Account, RpcProvider, hash } from "starknet";

const OZ_300 = "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";
const ENV_PATH = "/Users/henri/Workshop/mc-wallet/.env.vendor-seeds.local";
const NODE = "https://mainnet.nodes.starknet.org/rpc/v0_10";

const seed = (() => {
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^BRAMBLE_DATASET_SEED_DEPLOYER="?([^"]+)"?\s*$/);
    if (m && m[1].trim()) return m[1].trim();
  }
  throw new Error("BRAMBLE_DATASET_SEED_DEPLOYER is empty");
})();

const node = HDKey.fromMasterSeed(mnemonicToSeedSync(seed)).derive("m/44'/9004'/0'/0/0");
if (!node.privateKey) throw new Error("derivation failed");
const priv = "0x" + grindKey(node.privateKey);
const pub = getStarkKey(priv);
const address = hash.calculateContractAddressFromHash(pub, OZ_300, [pub], 0);

const provider = new RpcProvider({ nodeUrl: NODE });
const existing = await provider.getClassHashAt(address).catch(() => null);
if (existing) {
  console.log("already deployed, class:", existing);
  process.exit(0);
}

const account = new Account({ provider, address, signer: priv, cairoVersion: "1" });
const { transaction_hash, contract_address } = await account.deployAccount({
  classHash: OZ_300,
  constructorCalldata: [pub],
  addressSalt: pub,
});
console.log("deploy tx:", transaction_hash);
const receipt = await provider.waitForTransaction(transaction_hash);
console.log("status:", receipt.statusReceipt ?? receipt.execution_status ?? "unknown");
console.log("deployed at:", "0x" + BigInt(contract_address).toString(16));
