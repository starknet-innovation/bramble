/**
 * The release and withdrawal fixtures the vault-service QSB suites share: a
 * binding transaction `T` spending a full-length funding txid and a helper,
 * its digest from the fake Krusty, a release request over it, and a
 * withdrawal record. Every txid and hash is a full 64-digit hex string.
 */
import { createHash } from "node:crypto";
import { FAKE_GENERATED_MNEMONIC_24, fakeKms } from "@bramble/testkit/fake-kms";
import type { QsbWithdrawalRecord } from "@bramble/vault/qsb-withdrawal-store";
import type { QsbReleaseRequest } from "@bramble/vault/service-types";

/** The harness phrase's words, for the backup check. */
export const words = FAKE_GENERATED_MNEMONIC_24.split(" ");
/** The deposit `T` spends. */
export const FUNDING_TXID = createHash("sha256").update("qsb release funding").digest("hex");
// The helper output `T` spends.
const HELPER_TXID = createHash("sha256").update("qsb release helper").digest("hex");
/** The released round-0 indices, in signing order. */
export const ROUND0 = [5, 55, 66, 72, 75, 78, 110, 125];
/** The released round-1 indices, in signing order. */
export const ROUND1 = [14, 28, 65, 81, 87, 95, 128];

const le = (hex: string): string => hex.match(/../g)?.reverse().join("") ?? "";

/** T: version 1, the helper then the funding, one P2WPKH output, a locktime. */
export const transaction = (outputSat = 92_000, locktime = 950_229_240): string =>
  [
    "01000000",
    "02",
    le(HELPER_TXID),
    "01000000",
    "00",
    "feffffff",
    le(FUNDING_TXID),
    "00000000",
    "00",
    "a1070080",
    "01",
    le(outputSat.toString(16).padStart(16, "0")),
    "16",
    `0014${"33".repeat(20)}`,
    le(locktime.toString(16).padStart(8, "0")),
  ].join("");

const digestOf = async (t: string, round0 = ROUND0, round1 = ROUND1) =>
  (await fakeKms().qsbRevealDigest(t, round0, round1)).digest;

/** A conformant release request of vault 0 over `T`, its digest computed. */
export const request = async (
  fields: Partial<QsbReleaseRequest> = {},
): Promise<QsbReleaseRequest> => {
  const t = fields.transaction ?? transaction();
  return {
    digest: await digestOf(t, [...(fields.round0 ?? ROUND0)], [...(fields.round1 ?? ROUND1)]),
    emergency: false,
    round0: ROUND0,
    round1: ROUND1,
    transaction: t,
    v: 0,
    ...fields,
  };
};

/** A withdrawal intent of vault 0, not yet started. */
export const intent = (fields: Partial<QsbWithdrawalRecord> = {}): QsbWithdrawalRecord => ({
  destination: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  feeSat: 9_449,
  helper: { txid: HELPER_TXID, valueSat: 1_449, vout: 1 },
  jobCreated: false,
  jobId: "0b8f7f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
  manifestHash: createHash("sha256").update("manifest").digest("hex"),
  manifestJson: '{"vaultId":"x"}',
  outcome: null,
  outputSat: 92_000,
  signed: null,
  v: 0,
  ...fields,
});
