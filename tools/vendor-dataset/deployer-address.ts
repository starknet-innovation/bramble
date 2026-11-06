/**
 * Prints the dataset deployer's public key and counterfactual address for the
 * network BRAMBLE_DATASET_NETWORK selects (see deployerKeys in matrix-lib), so
 * it can be funded before deploy-deployer.ts runs. Prints only public data.
 */
import { deployerKeys, NETWORK } from "./matrix-lib";

const { pub, address } = deployerKeys();
console.log("network:         ", NETWORK);
console.log("deployer pubkey: ", pub);
console.log("deployer address:", address);
