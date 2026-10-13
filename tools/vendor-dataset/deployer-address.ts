/**
 * Derives the dataset deployer's counterfactual address from
 * BRAMBLE_DATASET_SEED_DEPLOYER: standard BIP-39 → m/44'/9004'/0'/0/0 → grind,
 * OpenZeppelin 3.0.0 class, salt = pubkey, constructor [pubkey], deployer 0.
 * Prints only the public key and address.
 */
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { ec, hash } from "starknet";
import { envSeed } from "./dataset-env";

const { grindKey, getStarkKey } = ec.starkCurve;

const OZ_300 = "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";

const seed = envSeed("BRAMBLE_DATASET_SEED_DEPLOYER");

if (seed.split(/\s+/).length !== 12) throw new Error("deployer seed is not 12 words");

const node = HDKey.fromMasterSeed(mnemonicToSeedSync(seed)).derive("m/44'/9004'/0'/0/0");
if (!node.privateKey) throw new Error("derivation failed");
const pub = getStarkKey("0x" + grindKey(node.privateKey));
const address = hash.calculateContractAddressFromHash(pub, OZ_300, [pub], 0);
console.log("deployer pubkey: ", pub);
console.log("deployer address:", "0x" + BigInt(address).toString(16));
