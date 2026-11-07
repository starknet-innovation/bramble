/**
 * Deploys the dataset deployer account (OZ 3.0.0, see deployerKeys in
 * matrix-lib) via DEPLOY_ACCOUNT v3, paid from its own pre-funded balance.
 * Idempotent: exits quietly if the account is already deployed. Prints only
 * public data.
 */
import { CLASSES, classAt, deployerAccount, deployerKeys, provider } from "./matrix-lib";

const { pub, salt, address } = deployerKeys();
const existing = await classAt(address);
if (existing) {
  console.log("already deployed, class:", existing);
  process.exit(0);
}

const { transaction_hash, contract_address } = await deployerAccount().deployAccount({
  classHash: CLASSES.oz300,
  constructorCalldata: [pub],
  addressSalt: salt,
});
console.log("deploy tx:", transaction_hash);
const receipt = await provider.waitForTransaction(transaction_hash);
console.log("status:", receipt.statusReceipt);
console.log("deployed at:", `0x${BigInt(contract_address).toString(16)}`);
