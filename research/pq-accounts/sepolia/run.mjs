// Sepolia end-to-end for SlhDsaBlake2s128sAccount: declare, fund, deploy, one SLH-DSA-signed
// transfer, and a tampered-signature transfer that must be rejected.
//
//   node run.mjs <declare|fund|deploy|transfer|tamper>
//
// Environment:
//   PQ_FUNDER_ADDRESS, PQ_FUNDER_PRIVATE_KEY  a funded Sepolia account (declare and fund steps)
//   PQ_SLH_KEY      key file from `signer/slh_signer.py keygen`
//   PQ_STATE        file that keeps the deploy salt between steps (default ./state.json)
//   PQ_RPC          Sepolia JSON-RPC 0.10 endpoint
//
// Starknet nodes running Sierra compiler 1.9.x cannot estimate fees for Sierra 1.10 classes,
// so the PQ-account transactions and the declare use fixed resource bounds.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Account, CallData, RpcProvider, cairo, hash, stark, transaction } from "starknet";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const RPC = process.env.PQ_RPC ?? "https://sepolia.nodes.starknet.org/rpc/v0_10";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ARTIFACTS = here("../target/dev/pq_accounts_SlhDsaBlake2s128sAccount");
const KEY = process.env.PQ_SLH_KEY;
const STATE = process.env.PQ_STATE ?? "state.json";
const SIGNER = here("../signer/slh_signer.py");

const provider = new RpcProvider({ nodeUrl: RPC });
const funder = () =>
  new Account({
    provider,
    address: process.env.PQ_FUNDER_ADDRESS,
    signer: process.env.PQ_FUNDER_PRIVATE_KEY,
  });

const bounds = async (l2) => {
  const b = await provider.getBlockWithTxHashes("latest");
  const twice = (price) => BigInt(price.price_in_fri) * 2n;
  return {
    l2_gas: { max_amount: BigInt(l2), max_price_per_unit: twice(b.l2_gas_price) },
    l1_gas: { max_amount: 0n, max_price_per_unit: twice(b.l1_gas_price) },
    l1_data_gas: { max_amount: 2000n, max_price_per_unit: twice(b.l1_data_gas_price) },
  };
};

const report = async (label, txHash) => {
  const rc = await provider.waitForTransaction(txHash, { retryInterval: 3000 });
  console.log(
    JSON.stringify({
      label,
      tx: txHash,
      status: rc.execution_status,
      revert: rc.revert_reason,
      fee_strk: Number(BigInt(rc.actual_fee.amount)) / 1e18,
      l2_gas: rc.execution_resources?.l2_gas,
    }),
  );
};

// Runs the Python signer for one request. `tamper` flips one bit of signature felt 200.
const sign = (request, tamper) =>
  new Promise((resolve, reject) => {
    const child = spawn("python3", ["-I", SIGNER, "--key", KEY], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`signer exited with code ${code}`));
      const { signature } = JSON.parse(out);
      if (tamper) signature[200] = `0x${(BigInt(signature[200]) ^ 1n).toString(16)}`;
      resolve(signature);
    });
    child.stdin.end(JSON.stringify({ scheme: "slh-dsa-blake2s-128s", ...request }));
  });

class SlhSigner {
  constructor(tamper = false) {
    this.tamper = tamper;
  }
  async signTransaction(calls, d) {
    const txHash = hash.calculateInvokeTransactionHash({
      ...d,
      senderAddress: d.walletAddress,
      compiledCalldata: transaction.getExecuteCalldata(calls, d.cairoVersion),
      nonceDataAvailabilityMode: stark.intDAM(d.nonceDataAvailabilityMode),
      feeDataAvailabilityMode: stark.intDAM(d.feeDataAvailabilityMode),
    });
    return sign({ action: "sign-transaction", payload: { hash: txHash } }, this.tamper);
  }
  async signDeployAccountTransaction(d) {
    const txHash = hash.calculateDeployAccountTransactionHash({
      ...d,
      salt: d.addressSalt,
      compiledConstructorCalldata: CallData.compile(d.constructorCalldata),
      nonceDataAvailabilityMode: stark.intDAM(d.nonceDataAvailabilityMode),
      feeDataAvailabilityMode: stark.intDAM(d.feeDataAvailabilityMode),
    });
    return sign({ action: "sign-deploy-account", payload: { hash: txHash } }, this.tamper);
  }
}

const sierra = JSON.parse(readFileSync(`${ARTIFACTS}.contract_class.json`, "utf8"));
const casm = JSON.parse(readFileSync(`${ARTIFACTS}.compiled_contract_class.json`, "utf8"));
const classHash = hash.computeContractClassHash(sierra);
const publicKey = JSON.parse(readFileSync(KEY, "utf8")).public_key;
const ctor = ["0x2", publicKey[0], publicKey[1]];
// Read the state in one step (no exists-then-read); a missing file starts a new account.
const readState = () => {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { salt: stark.randomAddress() };
    throw error;
  }
};
const state = readState();
state.address = hash.calculateContractAddressFromHash(state.salt, classHash, ctor, 0);
writeFileSync(STATE, JSON.stringify(state, null, 1));
console.log("class", classHash, "account", state.address);

const pq = (tamper) => new Account({ provider, address: state.address, signer: new SlhSigner(tamper) });
const transferBack = () => [
  {
    contractAddress: STRK,
    entrypoint: "transfer",
    calldata: CallData.compile({ to: process.env.PQ_FUNDER_ADDRESS, amount: cairo.uint256(10n ** 18n) }),
  },
];

switch (process.argv[2]) {
  case "declare": {
    const r = await funder().declare({ contract: sierra, casm }, { resourceBounds: await bounds(1_000_000_000) });
    await report("declare", r.transaction_hash);
    break;
  }
  case "fund": {
    const call = { contractAddress: STRK, entrypoint: "transfer", calldata: CallData.compile({ to: state.address, amount: cairo.uint256(30n * 10n ** 18n) }) };
    await report("fund 30 STRK", (await funder().execute([call])).transaction_hash);
    break;
  }
  case "deploy": {
    const r = await pq(false).deployAccount(
      { classHash, constructorCalldata: ctor, addressSalt: state.salt, contractAddress: state.address },
      { resourceBounds: await bounds(400_000_000) },
    );
    await report("deploy", r.transaction_hash);
    break;
  }
  case "transfer":
  case "tamper": {
    const tamper = process.argv[2] === "tamper";
    const r = await pq(tamper).execute(transferBack(), { resourceBounds: await bounds(400_000_000) });
    await report(tamper ? "tampered transfer (must not be accepted)" : "SLH-signed transfer 1 STRK", r.transaction_hash);
    break;
  }
  default:
    console.error("usage: node run.mjs <declare|fund|deploy|transfer|tamper>");
    process.exit(2);
}
