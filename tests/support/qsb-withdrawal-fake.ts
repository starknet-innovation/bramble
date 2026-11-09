/**
 * The withdrawal half of the stand-in QSB coordinator (./qsb-coordinator-fake)
 * and of the runtime stand-in: the job, solved-result, exact-submit and
 * transaction-status routes, answered as qsb-app's `server/app.ts`,
 * `server/submit-exact.ts` and `server/withdrawal-status.ts` answer them, and
 * a `prepare`/`finish` pair shaped like the pinned bridge's.
 *
 * It checks what the real deployment checks: a job's manifest hash is taken
 * over the schema-ordered manifest (computed here independently of Bramble),
 * its funding is the vault's confirmed funding, its output script is the
 * destination's and its amounts balance, its solver release is the
 * configuration's, one job per vault ever and one manifest per job id;
 * identical submitted bytes are answered from the record, any others for the
 * same job refused. The fake `finish` checks each preimage against its
 * commitment like the bridge, and records every preimage it was handed so a
 * suite can tell what left Krusty. It never verifies a QSB puzzle, so
 * `prepareRefuses` stands in for a solution the pipeline cannot assemble.
 */
import { createHash } from "node:crypto";
import { bytesToHex, hexToBytes } from "@bramble/core/hex";
import { qsbWithdrawalTransaction, readQsbSolution } from "@bramble/qsb/withdrawal-binding";
import { readQsbManifest } from "@bramble/qsb/withdrawal-manifest";
import { Address, NETWORK, OutScript, Transaction } from "@scure/btc-signer";
import type { QsbPreparedWithdrawal } from "../../apps/extension/src/background/qsb/qsb-withdrawal-assembly";

type Answer = { readonly body: unknown; readonly status: number };

/** One job as the fake keeps it: the server's record, with its solution once found. */
export type FakeJob = Record<string, unknown> & {
  readonly id: string;
  manifest: Record<string, unknown>;
  readonly manifestHash: string;
  solution?: Record<string, unknown>;
  stage: string;
  status: string;
  txid?: string;
  readonly vaultId: string;
};

/** The part of the coordinator's world the withdrawal routes read and write. */
export type FakeWithdrawalWorld = {
  config: Record<string, unknown>;
  confirmed: Set<string>;
  readonly jobs: Map<string, FakeJob>;
  owner: string;
  readonly transactions: Map<string, { readonly raw: string; status: string }>;
  utxos: { readonly txid: string; readonly valueSat: number; readonly vout: number }[];
  readonly vaults: Map<string, { raw: string | null; vault: Record<string, unknown> }>;
  /** What a fresh exact submission answers. */
  withdrawalSubmission: "conflict" | "submitted" | "uncertain";
};

const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");
const refused = (status: number, code: string): Answer => ({
  body: { code, error: `refused: ${code}` },
  status,
});

// The coordinator's `withdrawalSchema` order, outpoints `txid`, `vout`, `value`.
const schemaOrdered = (body: Record<string, unknown>): Record<string, unknown> => {
  const outpoint = (value: unknown) => {
    const point = value as Record<string, unknown>;
    return {
      txid: String(point["txid"]).toLowerCase(),
      vout: point["vout"],
      value: point["value"],
    };
  };
  return {
    vaultId: body["vaultId"],
    funding: outpoint(body["funding"]),
    helper: outpoint(body["helper"]),
    destination: body["destination"],
    outputScript: body["outputScript"],
    outputValue: body["outputValue"],
    fee: body["fee"],
    idempotencyKey: body["idempotencyKey"],
    costAccepted: body["costAccepted"],
    ...(body["solverReleaseId"] === undefined ? {} : { solverReleaseId: body["solverReleaseId"] }),
  };
};

const isBalanced = (manifest: Record<string, unknown>): boolean => {
  const value = (point: unknown) => BigInt(String((point as Record<string, unknown>)["value"]));
  return (
    value(manifest["funding"]) + value(manifest["helper"]) ===
      BigInt(String(manifest["outputValue"])) + BigInt(String(manifest["fee"])) &&
    BigInt(String(manifest["fee"])) > 0n
  );
};

const destinationScript = (destination: unknown): string | null => {
  try {
    return bytesToHex(OutScript.encode(Address(NETWORK).decode(String(destination))));
  } catch {
    return null;
  }
};

const isUnsound = (world: FakeWithdrawalWorld, manifest: Record<string, unknown>): boolean => {
  const entry = world.vaults.get(String(manifest["vaultId"]));
  const funding = entry?.vault["funding"] as Record<string, unknown> | undefined;
  const asked = manifest["funding"] as Record<string, unknown>;
  const helper = manifest["helper"] as Record<string, unknown>;
  return (
    entry?.vault["status"] !== "confirmed" ||
    funding?.["txid"] !== asked["txid"] ||
    funding?.["value"] !== asked["value"] ||
    destinationScript(manifest["destination"]) !== manifest["outputScript"] ||
    !isBalanced(manifest) ||
    !world.utxos.some(
      (utxo) =>
        utxo.txid === helper["txid"] &&
        utxo.vout === helper["vout"] &&
        String(utxo.valueSat) === helper["value"],
    )
  );
};

const createJob = (world: FakeWithdrawalWorld, body: Record<string, unknown>): Answer => {
  const manifest = schemaOrdered(body);
  const manifestHash = sha256(JSON.stringify(manifest));
  const id = String(manifest["idempotencyKey"]);
  const existing = world.jobs.get(id);
  if (existing) {
    return existing.manifestHash === manifestHash
      ? { body: { job: existing }, status: 200 }
      : refused(409, "idempotency_conflict");
  }
  if (manifest["solverReleaseId"] !== world.config["solverReleaseId"]) {
    return refused(503, "solver_not_served");
  }
  if (!world.vaults.has(String(manifest["vaultId"]))) return refused(404, "vault_not_found");
  if (isUnsound(world, manifest)) return refused(400, "withdrawal_invalid");
  if ([...world.jobs.values()].some((job) => job.vaultId === manifest["vaultId"])) {
    return refused(409, "state_conflict");
  }
  const job: FakeJob = {
    attempt: 0,
    createdAt: "2026-11-05T10:00:00.000Z",
    id,
    manifest,
    manifestHash,
    owner: world.owner,
    solver: { descriptor: { id: world.config["solverReleaseId"] } },
    stage: "pinning",
    status: "queued",
    updatedAt: "2026-11-05T10:00:00.000Z",
    vaultId: String(manifest["vaultId"]),
  };
  world.jobs.set(id, job);
  return { body: { job }, status: 201 };
};

const solvedResult = (world: FakeWithdrawalWorld, id: string): Answer => {
  const job = world.jobs.get(id);
  if (!job) return refused(404, "job_not_found");
  if (job.status !== "awaiting_authorization" || job.stage !== "verification" || !job.solution) {
    return refused(404, "solved_result_unavailable");
  }
  return {
    body: {
      format: "qsb-coordinator-public-solved-result-v1",
      jobId: job.id,
      manifest: job.manifest,
      manifestHash: job.manifestHash,
      network: "mainnet",
      solution: job.solution,
      vaultId: job.vaultId,
    },
    status: 200,
  };
};

const submit = (world: FakeWithdrawalWorld, id: string, body: Record<string, unknown>): Answer => {
  const job = world.jobs.get(id);
  if (!job?.solution) return refused(409, "job_state_invalid");
  const raw = String(body["rawTxHex"]).toLowerCase();
  const txid = Transaction.fromRaw(hexToBytes(raw) ?? new Uint8Array(), {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  }).id;
  const existing = world.transactions.get(txid);
  if (existing) {
    return existing.raw === raw
      ? { body: { status: existing.status, txid }, status: 200 }
      : refused(409, "intent_conflict");
  }
  if (job.txid !== undefined || job.status !== "awaiting_authorization") {
    return refused(409, "intent_conflict");
  }
  world.transactions.set(txid, { raw, status: world.withdrawalSubmission });
  job.status = "submitted";
  job.txid = txid;
  return { body: { status: world.withdrawalSubmission, txid }, status: 200 };
};

const transactionStatus = (world: FakeWithdrawalWorld, txid: string): Answer => {
  const record = world.transactions.get(txid);
  if (!record) return refused(404, "intent_not_found");
  const confirmed = world.confirmed.has(txid);
  if (confirmed) record.status = "confirmed";
  return {
    body: {
      chain: confirmed
        ? { confirmations: 1, confirmed: true, outpointMatched: true, outputMatched: true, txid }
        : null,
      checkedAt: "2026-11-05T10:00:00.000Z",
      ...(confirmed ? { includedTxid: txid } : {}),
      retrySafe: false,
      section7Inclusion: null,
      status: record.status,
      txid,
    },
    status: 200,
  };
};

type Handler = (world: FakeWithdrawalWorld, body: Record<string, unknown>, id: string) => Answer;

/** The withdrawal routes, by route label, for the coordinator fake's table. */
export const WITHDRAWAL_HANDLERS: Readonly<Record<string, Handler>> = {
  "GET /jobs": (world) => ({ body: { jobs: [...world.jobs.values()] }, status: 200 }),
  "GET /jobs/:id/solved-result": (world, _body, id) => solvedResult(world, id),
  "GET /transactions/:id/status": (world, _body, id) => transactionStatus(world, id),
  "POST /jobs": (world, body) => createJob(world, body),
  "POST /jobs/:id/submit": (world, body, id) => submit(world, id, body),
};

/** Labels a withdrawal path the way {@link WITHDRAWAL_HANDLERS} keys it, with its id. */
export const withdrawalRoute = (path: string): { readonly id: string; readonly path: string } => {
  const job = /^\/jobs\/([0-9a-f-]{36})(\/.*)?$/.exec(path);
  if (job) return { id: job[1] ?? "", path: `/jobs/:id${job[2] ?? ""}` };
  const tx = /^\/transactions\/([0-9a-f]{64})\/status$/.exec(path);
  return tx ? { id: tx[1] ?? "", path: "/transactions/:id/status" } : { id: "", path };
};

/** Moves job `id` to awaiting the user's authorization with `solution`. */
export const solveFakeJob = (
  world: Pick<FakeWithdrawalWorld, "jobs">,
  id: string,
  solution: Record<string, unknown>,
): void => {
  const job = world.jobs.get(id);
  if (!job) throw new Error(`no fake job ${id}`);
  job.solution = solution;
  job.stage = "verification";
  job.status = "awaiting_authorization";
};

/** A solution in range whose subsets disclose round 0's 0..7 and round 1's 0..6. */
export const FAKE_SOLUTION = {
  sequence: 0x8000_07a1,
  locktime: 950_229_240,
  round1: [7, 6, 5, 4, 3, 2, 1, 0, 149],
  round2: [6, 5, 4, 3, 2, 1, 0, 148, 147],
} as const;

const hash160 = (hex: string): string =>
  createHash("ripemd160")
    .update(createHash("sha256").update(Buffer.from(hex, "hex")).digest())
    .digest("hex");

/** The runtime's withdrawal half, faked; see the module comment. */
export type FakeWithdrawalRuntime = {
  /** Every preimage `finish` was handed, in order. */
  readonly finished: string[];
  /** Replaceable, so a suite can observe or fail a call. */
  finish: (prepared: QsbPreparedWithdrawal, preimages: readonly string[]) => Promise<string>;
  prepare: (
    publicStateJson: string,
    manifestJson: string,
    solutionJson: string,
  ) => Promise<QsbPreparedWithdrawal>;
  /** Makes `prepare` refuse as the pipeline does a solution it cannot assemble. */
  prepareRefuses: boolean;
  /** Makes `finish` fail as a crashed interpreter would. */
  finishFails: boolean;
};

// T with input 1's scriptSig set to pushes of the preimages and OP_1.
const withQsbScriptSig = (transaction: string, preimages: readonly string[]): string => {
  const script = `${preimages.map((preimage) => `14${preimage}`).join("")}51`;
  const length = script.length / 2;
  const at = (4 + 1 + 41 + 36) * 2;
  const size =
    length < 0xfd
      ? length.toString(16).padStart(2, "0")
      : `fd${(length & 0xff).toString(16).padStart(2, "0")}${(length >> 8).toString(16).padStart(2, "0")}`;
  return `${transaction.slice(0, at)}${size}${script}${transaction.slice(at + 2)}`;
};

/** A fresh fake withdrawal runtime. */
export const fakeWithdrawalRuntime = (): FakeWithdrawalRuntime => {
  const runtime: FakeWithdrawalRuntime = {
    async finish(prepared, preimages) {
      runtime.finished.push(...preimages);
      if (runtime.finishFails) throw new Error("QSB withdrawal finish failed");
      const { publicStateJson } = JSON.parse(prepared.json) as { publicStateJson: string };
      const { hors_commitments: rounds } = JSON.parse(publicStateJson) as {
        hors_commitments: string[][];
      };
      const slots = [...prepared.round0.map((i) => [0, i]), ...prepared.round1.map((i) => [1, i])];
      if (
        preimages.length !== 15 ||
        slots.some(([r, i], k) => hash160(preimages[k] ?? "") !== rounds[r ?? 0]?.[i ?? 0])
      ) {
        throw new Error("QSB withdrawal finish failed");
      }
      return withQsbScriptSig(prepared.transaction, preimages);
    },
    finishFails: false,
    finished: [],
    async prepare(publicStateJson, manifestJson, solutionJson) {
      const manifest = readQsbManifest(JSON.parse(manifestJson));
      const solution = readQsbSolution(JSON.parse(solutionJson));
      const transaction = manifest && solution && qsbWithdrawalTransaction(manifest, solution);
      if (runtime.prepareRefuses || !transaction || !solution) {
        throw new Error("QSB withdrawal prepare failed");
      }
      const ascending = (values: readonly number[]) => [...values].sort((a, b) => a - b);
      const { full_script_hex: script } = JSON.parse(publicStateJson) as {
        full_script_hex: string;
      };
      const round0 = ascending(solution.round1).slice(0, 8);
      const round1 = ascending(solution.round2).slice(0, 7);
      const scriptHash = sha256(Buffer.from(script, "hex"));
      const json = JSON.stringify({
        manifest: JSON.parse(manifestJson),
        publicStateJson,
        round0,
        round1,
        scriptHash,
        solution: JSON.parse(solutionJson),
        transaction,
      });
      return { json, round0, round1, scriptHash, transaction };
    },
    prepareRefuses: false,
  };
  return runtime;
};
