// SNIP-36 experiment: prove an SLH-DSA signature check inside a client-side proof, the way the
// STRK20 privacy pool checks its users, and consume the proof on Sepolia.
//
//   node snip36.mjs setup                      declare + deploy probe, consumer, SHAKE account
//   node snip36.mjs prove <ecdsa|blake2s|shake> [--tamper]
//   node snip36.mjs submit <result.json> [--wrong-payload]
//   node snip36.mjs report
//
// Environment (see README.md):
//   PQ_FUNDER_ADDRESS, PQ_FUNDER_PRIVATE_KEY  funded Sepolia OpenZeppelin account (setup, submit,
//                                             and the ECDSA baseline's signer)
//   PQ_SLH_KEY          BLAKE2s key file of the deployed SLH-DSA-BLAKE2s account
//   PQ_BLAKE2S_ACCOUNT  that account's address
//   PQ_SHAKE_KEY        SHAKE key file (setup creates the account for it)
//   PQ_PROVER           prover JSON-RPC URL (default http://127.0.0.1:3100)
//   PQ_PROVER_PID       local prover process id, to sample its peak memory (optional)
//   PQ_RPC              Sepolia JSON-RPC 0.10 endpoint
//   PQ_STATE            deployment state file (default ./snip36-state.json)
//   PQ_RESULTS          directory for proof results (default ./results)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Account, CallData, RpcProvider, constants, ec, hash, shortString, stark, transaction } from "starknet";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const RPC = process.env.PQ_RPC ?? "https://sepolia.nodes.starknet.org/rpc/v0_10";
const PROVER = process.env.PQ_PROVER ?? "http://127.0.0.1:3100";
const STATE = process.env.PQ_STATE ?? "snip36-state.json";
const RESULTS = process.env.PQ_RESULTS ?? "results";
const SIGNER = here("../signer/slh_signer.py");
const ARTIFACTS = here("../target/dev/pq_accounts_");
const CHAIN = constants.StarknetChainId.SN_SEPOLIA;
// Proofs stay valid for this many blocks after their base block (the privacy pool uses an
// admin-set window; a SHAKE proof can take minutes).
const VALIDITY_BLOCKS = 5_000n;
// The OS enforces l2_gas.max_amount on the proven run. SHAKE verification is ~410M, under the
// 1.11B execute cap; the probe's own validation is trivial.
const VIRTUAL_L2_GAS = { ecdsa: 100_000_000n, blake2s: 100_000_000n, shake: 1_000_000_000n };

const provider = new RpcProvider({ nodeUrl: RPC });
const hex = (v) => `0x${BigInt(v).toString(16)}`;
const need = (name) => process.env[name] ?? fail(`set ${name}`);
function fail(message) {
  console.error(message);
  process.exit(2);
}
const funder = () =>
  new Account({ provider, address: need("PQ_FUNDER_ADDRESS"), signer: need("PQ_FUNDER_PRIVATE_KEY") });
const loadState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {});
const saveState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 1));
const artifact = (name) => ({
  contract: JSON.parse(readFileSync(`${ARTIFACTS}${name}.contract_class.json`, "utf8")),
  casm: JSON.parse(readFileSync(`${ARTIFACTS}${name}.compiled_contract_class.json`, "utf8")),
});

// Nodes whose Sierra compiler stops at 1.9.x cannot estimate Sierra 1.10 classes, so every
// on-chain transaction here uses fixed bounds at twice the latest prices.
async function bounds(l2) {
  const b = await provider.getBlockWithTxHashes("latest");
  const twice = (p) => BigInt(p.price_in_fri) * 2n;
  return {
    l2_gas: { max_amount: BigInt(l2), max_price_per_unit: twice(b.l2_gas_price) },
    l1_gas: { max_amount: 0n, max_price_per_unit: twice(b.l1_gas_price) },
    l1_data_gas: { max_amount: 4_000n, max_price_per_unit: twice(b.l1_data_gas_price) },
  };
}

async function waitFor(label, txHash) {
  const rc = await provider.waitForTransaction(txHash, { retryInterval: 3000 });
  const out = {
    label,
    tx: txHash,
    status: rc.execution_status,
    revert: rc.revert_reason,
    fee_strk: Number(BigInt(rc.actual_fee.amount)) / 1e18,
    l2_gas: rc.execution_resources?.l2_gas,
  };
  console.log(JSON.stringify(out));
  if (rc.execution_status !== "SUCCEEDED") fail(`${label} did not succeed`);
  return out;
}

const slhSign = (keyFile, scheme, txHash) =>
  new Promise((resolve, reject) => {
    const child = spawn("python3", ["-I", SIGNER, "--key", keyFile], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(JSON.parse(out).signature) : reject(new Error(`signer exited with ${code}`)),
    );
    child.stdin.end(JSON.stringify({ scheme, action: "sign-hash", payload: { hash: hex(txHash) } }));
  });

async function declareIfNeeded(name) {
  const a = artifact(name);
  const classHash = hash.computeContractClassHash(a.contract);
  try {
    await provider.getClassByHash(classHash);
    console.log(`${name}: class ${classHash} already declared`);
  } catch {
    const r = await funder().declare(a, { resourceBounds: await bounds(1_500_000_000) });
    await waitFor(`declare ${name}`, r.transaction_hash);
  }
  return classHash;
}

async function deploy(label, classHash, constructorCalldata) {
  const r = await funder().deployContract(
    { classHash, constructorCalldata, salt: stark.randomAddress(), unique: false },
    { resourceBounds: await bounds(50_000_000) },
  );
  await waitFor(`deploy ${label}`, r.transaction_hash);
  console.log(`${label}: ${r.contract_address}`);
  return r.contract_address;
}

async function setup() {
  const s = loadState();
  const probeClass = await declareIfNeeded("PqAuthProbe");
  const consumerClass = await declareIfNeeded("PqAuthConsumer");
  const shakeClass = await declareIfNeeded("SlhDsaShake128sAccount");
  s.probe ??= await deploy("probe", probeClass, []);
  s.consumer ??= await deploy("consumer", consumerClass, [s.probe, hex(VALIDITY_BLOCKS)]);
  if (!s.shake_account) {
    const pk = JSON.parse(readFileSync(need("PQ_SHAKE_KEY"), "utf8"));
    if (pk.scheme !== "slh-dsa-shake-128s") fail("PQ_SHAKE_KEY is not a SHAKE key file");
    s.shake_account = await deploy("SHAKE account", shakeClass, ["0x2", ...pk.public_key]);
  }
  saveState(s);
  console.log(JSON.stringify(s, null, 1));
}

function userFor(scheme, s) {
  if (scheme === "ecdsa") return { address: need("PQ_FUNDER_ADDRESS") };
  if (scheme === "blake2s") return { address: need("PQ_BLAKE2S_ACCOUNT"), key: need("PQ_SLH_KEY") };
  if (scheme === "shake") return { address: s.shake_account ?? fail("run setup first"), key: need("PQ_SHAKE_KEY") };
  return fail("scheme must be ecdsa, blake2s or shake");
}

async function signFor(scheme, user, txHash) {
  if (scheme === "ecdsa") {
    const sig = ec.starkCurve.sign(hex(txHash), need("PQ_FUNDER_PRIVATE_KEY"));
    return [hex(sig.r), hex(sig.s)];
  }
  return slhSign(user.key, scheme === "shake" ? "slh-dsa-shake-128s" : "slh-dsa-blake2s-128s", txHash);
}

// Samples the local prover's resident memory once a second; returns a stop function.
function sampleMemory() {
  const pid = process.env.PQ_PROVER_PID;
  if (!pid) return () => null;
  let peak = 0;
  const timer = setInterval(() => {
    try {
      const m = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
      if (m) peak = Math.max(peak, Number(m[1]));
    } catch {}
  }, 1000);
  return () => {
    clearInterval(timer);
    return Math.round(peak / 1024);
  };
}

async function prove(scheme, tamper) {
  const s = loadState();
  if (!s.probe) fail("run setup first");
  const user = userFor(scheme, s);
  // A fresh nonce in the payload makes every proof consumable once.
  const payload = [shortString.encodeShortString("pq-snip36"), shortString.encodeShortString(scheme), stark.randomAddress()];
  const calldata = transaction.getExecuteCalldata(
    [{ contractAddress: s.probe, entrypoint: "authorize", calldata: CallData.compile({ user: user.address, payload }) }],
    "1",
  );
  const l2 = VIRTUAL_L2_GAS[scheme];
  const resourceBounds = {
    l1_gas: { max_amount: 0n, max_price_per_unit: 0n },
    l2_gas: { max_amount: l2, max_price_per_unit: 0n },
    l1_data_gas: { max_amount: 0n, max_price_per_unit: 0n },
  };
  const nonce = await provider.getNonceForAddress(s.probe);
  const txHash = hash.calculateInvokeTransactionHash({
    senderAddress: s.probe,
    version: "0x3",
    compiledCalldata: calldata,
    chainId: CHAIN,
    nonce,
    accountDeploymentData: [],
    nonceDataAvailabilityMode: 0,
    feeDataAvailabilityMode: 0,
    resourceBounds,
    tip: 0n,
    paymasterData: [],
  });
  const t0 = Date.now();
  let signature = await signFor(scheme, user, txHash);
  const signMs = Date.now() - t0;
  if (tamper) signature = signature.map((f, i) => (i === signature.length - 1 ? hex(BigInt(f) ^ 1n) : f));
  const tx = {
    type: "INVOKE",
    version: "0x3",
    sender_address: s.probe,
    calldata: calldata.map(hex),
    signature,
    nonce: hex(nonce),
    resource_bounds: {
      l1_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
      l2_gas: { max_amount: hex(l2), max_price_per_unit: "0x0" },
      l1_data_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
    },
    tip: "0x0",
    paymaster_data: [],
    account_deployment_data: [],
    nonce_data_availability_mode: "L1",
    fee_data_availability_mode: "L1",
  };
  const block = (await provider.getBlockWithTxHashes("latest")).block_number - 1;
  const stop = sampleMemory();
  const t1 = Date.now();
  let body;
  try {
    const res = await fetch(PROVER, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_proveTransaction",
        params: { block_id: { block_number: block }, transaction: tx },
      }),
    });
    body = await res.json();
  } catch (error) {
    // A prover that runs out of memory drops the connection without a JSON-RPC error.
    body = { error: { code: "connection", message: `${error.cause?.code ?? error.message} (prover crashed? check its log for an OOM kill)` } };
  }
  const proveMs = Date.now() - t1;
  const peakMb = stop();
  const result = {
    scheme,
    tamper,
    user: user.address,
    payload,
    base_block: block,
    virtual_tx_hash: hex(txHash),
    signature_felts: signature.length,
    sign_ms: signMs,
    prove_ms: proveMs,
    prover_peak_rss_mb: peakMb,
    error: body.error ?? null,
    proof_chars: body.result?.proof?.length ?? null,
    proof_facts: body.result?.proof_facts ?? null,
    l2_to_l1_messages: body.result?.l2_to_l1_messages ?? null,
  };
  mkdirSync(RESULTS, { recursive: true });
  const file = `${RESULTS}/${scheme}${tamper ? "-tampered" : ""}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify({ ...result, proof: body.result?.proof ?? null }));
  console.log(JSON.stringify({ ...result, file }, null, 1));
}

async function submit(file, wrongPayload) {
  const s = loadState();
  const r = JSON.parse(readFileSync(file, "utf8"));
  if (!r.proof) fail(`${file} holds no proof`);
  const payload = wrongPayload ? [...r.payload.slice(0, 2), stark.randomAddress()] : r.payload;
  const call = { contractAddress: s.consumer, entrypoint: "apply", calldata: CallData.compile({ user: r.user, payload }) };
  const before = await provider.callContract({ contractAddress: s.consumer, entrypoint: "applied_count", calldata: [r.user] });
  const sent = await funder().execute([call], {
    proof: r.proof,
    proofFacts: r.proof_facts,
    resourceBounds: await bounds(150_000_000),
    tip: 0n,
  });
  const out = await waitFor(`apply ${r.scheme}${wrongPayload ? " (wrong payload)" : ""}`, sent.transaction_hash);
  const after = await provider.callContract({ contractAddress: s.consumer, entrypoint: "applied_count", calldata: [r.user] });
  const record = { ...out, scheme: r.scheme, applied_before: BigInt(before[0]).toString(), applied_after: BigInt(after[0]).toString() };
  writeFileSync(file.replace(/\.json$/, `.submit${wrongPayload ? "-wrong" : ""}.json`), JSON.stringify(record, null, 1));
  console.log(JSON.stringify(record, null, 1));
}

function report() {
  if (!existsSync(RESULTS)) fail(`no ${RESULTS} directory`);
  const rows = readdirSync(RESULTS)
    .filter((f) => /^(ecdsa|blake2s|shake)(-tampered)?-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(`${RESULTS}/${f}`, "utf8")));
  console.log("| Scheme | Tampered | Proved | Prove time | Prover peak RSS | Proof size | Error |");
  console.log("|---|---|---|---:|---:|---:|---|");
  for (const r of rows) {
    console.log(
      `| ${r.scheme} | ${r.tamper ? "yes" : "no"} | ${r.proof_chars ? "yes" : "no"} | ${(r.prove_ms / 1000).toFixed(1)} s | ${r.prover_peak_rss_mb ?? "n/a"} MB | ${r.proof_chars ? Math.round((r.proof_chars * 3) / 4 / 1024) + " KiB" : "-"} | ${r.error ? `${r.error.code} ${r.error.message}` : ""} |`,
    );
  }
}

const [cmd, arg, flag] = process.argv.slice(2);
if (cmd === "setup") await setup();
else if (cmd === "prove") await prove(arg, flag === "--tamper");
else if (cmd === "submit") await submit(arg, flag === "--wrong-payload");
else if (cmd === "report") report();
else fail("usage: node snip36.mjs <setup|prove <ecdsa|blake2s|shake> [--tamper]|submit <result.json> [--wrong-payload]|report>");
