/**
 * The withdrawal half of `@bramble/qsb`: which destinations are payable and
 * their dust floors, the canonical manifest and its hash, the size bound the
 * fee is taken over, the solution grammar and its disclosure, and the
 * coordinator's withdrawal answers parsed strictly. The checks on the first
 * mainnet withdrawal's real bytes live in tests/background/qsb.
 */
import { describe, expect, test } from "bun:test";
import { qsbWithdrawalVsize } from "@bramble/qsb/fees";
import {
  isQsbDisclosureOf,
  isQsbSolutionInRange,
  qsbDisclosedIndices,
  readQsbSolution,
} from "@bramble/qsb/withdrawal-binding";
import { QSB_DESTINATION_DUST_SAT, qsbDestination } from "@bramble/qsb/withdrawal-destination";
import {
  qsbManifestHash,
  qsbManifestJson,
  readQsbManifest,
} from "@bramble/qsb/withdrawal-manifest";
import {
  readQsbJobs,
  readQsbSolvedResult,
  readQsbWithdrawalSubmitAnswer,
  readQsbWithdrawalTransactionStatus,
} from "@bramble/qsb/withdrawal-responses";
import { sha256Hex } from "./fixtures";

const TXID = "1378dd5c26aa027b329e7a0645a4087e9cc9e0e619cf605135f76b5a27ad5750";
const MANIFEST = {
  vaultId: "6f1d2c3b-4a59-4687-9a1b-2c3d4e5f6a7b",
  funding: { txid: TXID, vout: 0, value: "100000" },
  helper: { txid: TXID, vout: 1, value: "1449" },
  destination: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  outputScript: "0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2",
  outputValue: "88673",
  fee: "12776",
  idempotencyKey: "0b8f7f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
  costAccepted: true,
  solverReleaseId: "qsb-ranked-v2-40b5d9f9f741-6b4ac63b897c",
} as const;
const SOLUTION = {
  sequence: 2147485601,
  locktime: 950229240,
  round1: [5, 55, 66, 72, 75, 78, 110, 125, 149],
  round2: [14, 28, 65, 81, 87, 95, 128, 145, 147],
};

describe("destinations", () => {
  test.each([
    [
      "P2WPKH",
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
      "0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2",
      294,
    ],
    [
      "P2TR",
      "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
      "5120a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c",
      330,
    ],
    [
      "P2WSH",
      "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
      "00201863143c14c5166804bd19203356da136c985678cd4d27a1b8c6329604903262",
      330,
    ],
    [
      "P2PKH",
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      "76a91477bff20c60e522dfaa3350c39b030a5d004e839a88ac",
      546,
    ],
    [
      "P2SH",
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
      "a914b472a266d0bd89c13706a4132ccfb16f7c3b9fcb87",
      540,
    ],
  ])("pays %s with its own script and dust floor", (_type, address, outputScript, dustSat) => {
    expect(qsbDestination(address)).toEqual({ address, dustSat, outputScript });
  });

  test.each([
    ["P2A (anyone can spend)", "bc1pfeessrawgf"],
    ["a testnet address", "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"],
    ["upper-case bech32", "BC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYU"],
    ["a bad checksum", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv"],
    ["text", "not an address at all"],
    ["a number", 7],
  ])("refuses %s", (_label, address) => {
    expect(qsbDestination(address)).toBeNull();
  });

  test("the dust floors are Bitcoin Core's", () => {
    expect(QSB_DESTINATION_DUST_SAT).toEqual({ pkh: 546, sh: 540, tr: 330, wpkh: 294, wsh: 330 });
  });
});

describe("the manifest", () => {
  test("is hashed over its schema-ordered JSON", () => {
    const json = qsbManifestJson(MANIFEST);
    expect(
      json?.startsWith(
        `{"vaultId":"${MANIFEST.vaultId}","funding":{"txid":"${TXID}","vout":0,"value":"100000"}`,
      ),
    ).toBe(true);
    expect(
      json?.endsWith(`"costAccepted":true,"solverReleaseId":"${MANIFEST.solverReleaseId}"}`),
    ).toBe(true);
    expect(qsbManifestHash(json ?? "")).toBe(sha256Hex(json ?? ""));
  });

  test("a copy with reordered keys and an upper-case txid hashes the same", () => {
    const reordered = {
      fee: MANIFEST.fee,
      costAccepted: true,
      solverReleaseId: MANIFEST.solverReleaseId,
      helper: { value: "1449", vout: 1, txid: TXID.toUpperCase() },
      idempotencyKey: MANIFEST.idempotencyKey,
      outputValue: MANIFEST.outputValue,
      destination: MANIFEST.destination,
      outputScript: MANIFEST.outputScript,
      funding: { vout: 0, value: "100000", txid: TXID },
      vaultId: MANIFEST.vaultId,
    };
    expect(qsbManifestJson(reordered)).toBe(qsbManifestJson(MANIFEST));
  });

  test.each([
    ["an extra field", { ...MANIFEST, note: "x" }],
    ["no idempotency key", (({ idempotencyKey: _, ...rest }) => rest)(MANIFEST)],
    ["costAccepted false", { ...MANIFEST, costAccepted: false }],
    ["a fractional amount", { ...MANIFEST, fee: "1.5" }],
    ["a leading zero", { ...MANIFEST, outputValue: "088673" }],
    ["an upper-case release id", { ...MANIFEST, solverReleaseId: "QSB" }],
    ["an extra outpoint field", { ...MANIFEST, helper: { ...MANIFEST.helper, confirmed: true } }],
  ])("refuses %s", (_label, manifest) => {
    expect(readQsbManifest(manifest)).toBeNull();
    expect(qsbManifestJson(manifest)).toBeNull();
  });
});

describe("the withdrawal's size bound", () => {
  test.each([
    ["P2WPKH", 22, 1338],
    ["P2SH", 23, 1339],
    ["P2PKH", 25, 1341],
    ["P2WSH or P2TR", 34, 1350],
  ])("%s pays at most %i vB", (_type, scriptBytes, vsize) => {
    expect(qsbWithdrawalVsize(scriptBytes as number)).toBe(vsize);
  });
});

describe("the solution", () => {
  test("discloses each subset's sorted prefix, never the bonus indices", () => {
    const solution = readQsbSolution({ ...SOLUTION, round1: [...SOLUTION.round1].reverse() });
    expect(solution && qsbDisclosedIndices(solution)).toEqual({
      round0: [5, 55, 66, 72, 75, 78, 110, 125],
      round1: [14, 28, 65, 81, 87, 95, 128],
    });
    expect(
      solution &&
        isQsbDisclosureOf(
          { round0: [55, 5, 66, 72, 75, 78, 110, 125], round1: [14, 28, 65, 81, 87, 95, 128] },
          solution,
        ),
    ).toBe(false);
  });

  test.each([
    ["eight indices", { ...SOLUTION, round1: SOLUTION.round1.slice(1) }],
    ["a repeated index", { ...SOLUTION, round2: [...SOLUTION.round2.slice(1), 28] }],
    ["index 150", { ...SOLUTION, round2: [...SOLUTION.round2.slice(1), 150] }],
    ["a 33-bit locktime", { ...SOLUTION, locktime: 2 ** 32 }],
    ["an extra field", { ...SOLUTION, bonus: [] }],
  ])("is refused with %s", (_label, value) => {
    expect(readQsbSolution(value)).toBeNull();
  });

  test.each([
    [0x7fff_ffff, 950229240, false],
    [0x8000_0000, 950229240, true],
    [0xffff_ffff, 500_000_000, true],
    [0x8000_0000, 499_999_999, false],
    [0x8000_0000, 1_744_599_999, true],
    [0x8000_0000, 1_744_600_000, false],
  ])("sequence %i and locktime %i are in range: %p", (sequence, locktime, inRange) => {
    expect(isQsbSolutionInRange({ ...SOLUTION, locktime, sequence })).toBe(inRange);
  });
});

describe("withdrawal answers", () => {
  const job = {
    id: MANIFEST.idempotencyKey,
    owner: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    vaultId: MANIFEST.vaultId,
    status: "awaiting_authorization",
    stage: "verification",
    manifest: { ...MANIFEST, funding: { vout: 0, txid: TXID, value: "100000" } },
    manifestHash: qsbManifestHash(qsbManifestJson(MANIFEST) ?? ""),
    attempt: 3,
    gpuBudgetReservedSeconds: 900,
  };

  test("a job is read by its fields, canonical manifest included, the rest ignored", () => {
    expect(readQsbJobs({ jobs: [job] })).toEqual([
      {
        id: job.id,
        manifest: readQsbManifest(MANIFEST) as never,
        manifestHash: job.manifestHash,
        stage: "verification",
        status: "awaiting_authorization",
        txid: null,
        vaultId: MANIFEST.vaultId,
      },
    ]);
    expect(readQsbJobs({ jobs: [{ ...job, status: "cancelled" }] })).toBeNull();
    expect(readQsbJobs({ jobs: [{ ...job, txid: "zz" }] })).toBeNull();
    expect(readQsbJobs({ jobs: [job], next: 1 })).toBeNull();
  });

  test("the solved result is read exactly", () => {
    const solved = {
      format: "qsb-coordinator-public-solved-result-v1",
      network: "mainnet",
      jobId: job.id,
      vaultId: MANIFEST.vaultId,
      manifestHash: job.manifestHash,
      manifest: MANIFEST,
      solution: SOLUTION,
    };
    expect(readQsbSolvedResult(solved)?.solution).toEqual(SOLUTION);
    expect(readQsbSolvedResult({ ...solved, network: "testnet" })).toBeNull();
    expect(readQsbSolvedResult({ ...solved, stateJson: "{}" })).toBeNull();
    expect(
      readQsbSolvedResult({ ...solved, format: "qsb-coordinator-public-signed-result-v1" }),
    ).toBeNull();
  });

  test("a submission answer is exactly a txid and one of four outcomes", () => {
    expect(readQsbWithdrawalSubmitAnswer({ status: "uncertain", txid: TXID })).toEqual({
      status: "uncertain",
      txid: TXID,
    });
    expect(readQsbWithdrawalSubmitAnswer({ status: "rejected", txid: TXID })).toBeNull();
    expect(
      readQsbWithdrawalSubmitAnswer({ retrySafe: false, status: "submitted", txid: TXID }),
    ).toBeNull();
  });

  test("a transaction status reports what was included and how deep", () => {
    expect(
      readQsbWithdrawalTransactionStatus({
        chain: { confirmations: 2, confirmed: true, outpointMatched: true },
        checkedAt: "2026-11-05T10:00:00.000Z",
        includedTxid: "ab".repeat(32),
        retrySafe: false,
        status: "confirmed",
        txid: TXID,
      }),
    ).toEqual({
      chainUnavailable: false,
      confirmations: 2,
      includedTxid: "ab".repeat(32),
      status: "confirmed",
      txid: TXID,
    });
    expect(
      readQsbWithdrawalTransactionStatus({
        chain: null,
        chainUnavailable: true,
        status: "uncertain",
        txid: TXID,
      }),
    ).toEqual({
      chainUnavailable: true,
      confirmations: null,
      includedTxid: null,
      status: "uncertain",
      txid: TXID,
    });
    expect(
      readQsbWithdrawalTransactionStatus({
        chain: { confirmations: -1 },
        status: "submitted",
        txid: TXID,
      }),
    ).toBeNull();
    expect(
      readQsbWithdrawalTransactionStatus({ chain: null, status: "dropped", txid: TXID }),
    ).toBeNull();
  });
});
