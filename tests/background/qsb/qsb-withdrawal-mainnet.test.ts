/**
 * The withdrawal checks of `@bramble/qsb` against the first mainnet QSB
 * withdrawal's own bytes (scripts/qsb-mainnet-withdrawal.ts): `T` rebuilt
 * from its manifest and solution is the chain's, the solution is in range
 * and discloses exactly the published indices, both previous outputs read
 * back from the deposit, `finish`'s bytes commit to the intent, and the
 * helper PSBT, carrying the helper signature the chain published, finalizes
 * and verifies to the confirmed withdrawal and its txid. Any change refuses.
 */
import { describe, expect, test } from "bun:test";
import { bytesToHex, hexToBytes } from "@bramble/core/hex";
import {
  isQsbDisclosureOf,
  isQsbSolutionInRange,
  qsbPreviousOutput,
  qsbWithdrawalTransaction,
  readQsbSolution,
} from "@bramble/qsb/withdrawal-binding";
import { qsbDestination } from "@bramble/qsb/withdrawal-destination";
import { readQsbManifest } from "@bramble/qsb/withdrawal-manifest";
import {
  buildQsbHelperPsbt,
  finalizeQsbWithdrawal,
  qsbWithdrawalCommits,
} from "@bramble/qsb/withdrawal-psbt";
import { Transaction } from "@scure/btc-signer";
import {
  QSB_MAINNET_ASSEMBLY,
  QSB_MAINNET_DEPOSIT_TX,
  QSB_MAINNET_MANIFEST,
  QSB_MAINNET_SOLUTION,
  QSB_MAINNET_WITHDRAWAL_TX,
} from "../../../scripts/qsb-mainnet-withdrawal";

const DEPOSIT_TXID = "1378dd5c26aa027b329e7a0645a4087e9cc9e0e619cf605135f76b5a27ad5750";
const WITHDRAWAL_TXID = "fb46f6092560cbf3b254a8125644e42db3a361b94a2b3bafee4454d84297d13a";
const manifest = readQsbManifest(QSB_MAINNET_MANIFEST);
const solution = readQsbSolution(QSB_MAINNET_SOLUTION);
if (!manifest || !solution) throw new Error("fixture does not parse");
const withdrawal = Transaction.fromRaw(hexToBytes(QSB_MAINNET_WITHDRAWAL_TX) ?? new Uint8Array(), {
  allowUnknownInputs: true,
  allowUnknownOutputs: true,
  disableScriptCheck: true,
});
const [SIGNATURE, OWNER_KEY] = withdrawal.getInput(0).finalScriptWitness ?? [];
const OWNER_SCRIPT = hexToBytes(manifest.outputScript) ?? new Uint8Array();

const helperPsbt = () =>
  buildQsbHelperPsbt({
    fundingPreviousTxHex: QSB_MAINNET_DEPOSIT_TX,
    helperPreviousTxHex: QSB_MAINNET_DEPOSIT_TX,
    helperSat: 1449n,
    ownerScript: OWNER_SCRIPT,
    rawHex: QSB_MAINNET_ASSEMBLY.raw,
  });

// The PSBT a signer would return: the expected one with these partial signatures.
const signedWith = (signatures: readonly [Uint8Array, Uint8Array][]): Uint8Array => {
  const signed = helperPsbt();
  if (!signed) throw new Error("no helper PSBT");
  signed.updateInput(0, { partialSig: [...signatures] }, true);
  return signed.toPSBT();
};

describe("T on the first mainnet withdrawal", () => {
  test("is rebuilt byte for byte from the manifest and the solution", () => {
    expect(qsbWithdrawalTransaction(manifest, solution)).toBe(QSB_MAINNET_ASSEMBLY.transaction);
    expect(qsbWithdrawalTransaction({ ...manifest, outputValue: "92082" }, solution)).not.toBe(
      QSB_MAINNET_ASSEMBLY.transaction,
    );
  });

  test("its solution is in range and discloses exactly the published indices", () => {
    expect(isQsbSolutionInRange(solution)).toBe(true);
    expect(isQsbDisclosureOf(QSB_MAINNET_ASSEMBLY, solution)).toBe(true);
  });

  test("its destination is a payable P2WPKH, with the script the manifest names", () => {
    expect(qsbDestination(manifest.destination)?.outputScript).toBe(manifest.outputScript);
  });

  test("both previous outputs read back from the deposit, and only from it", () => {
    expect(qsbPreviousOutput(QSB_MAINNET_DEPOSIT_TX, DEPOSIT_TXID, 1)).toEqual({
      amountSat: 1449n,
      script: manifest.outputScript,
    });
    const vault = qsbPreviousOutput(QSB_MAINNET_DEPOSIT_TX, DEPOSIT_TXID, 0);
    expect(vault?.amountSat).toBe(100_000n);
    expect(vault?.script).toHaveLength(9_923 * 2);
    expect(qsbPreviousOutput(QSB_MAINNET_DEPOSIT_TX, WITHDRAWAL_TXID, 0)).toBeNull();
    expect(qsbPreviousOutput(QSB_MAINNET_DEPOSIT_TX, DEPOSIT_TXID, 2)).toBeNull();
  });
});

describe("finish's bytes on the first mainnet withdrawal", () => {
  const commits = (fields: Partial<Parameters<typeof qsbWithdrawalCommits>[0]>) =>
    qsbWithdrawalCommits({
      manifest,
      rawHex: QSB_MAINNET_ASSEMBLY.raw,
      solution,
      transaction: QSB_MAINNET_ASSEMBLY.transaction,
      ...fields,
    });

  test("commit to the intent", () => {
    expect(commits({})).toBe(true);
  });

  test.each([
    ["another fee", { manifest: { ...manifest, fee: "9365" } }],
    [
      "another output script",
      { manifest: { ...manifest, outputScript: `0014${"00".repeat(20)}` } },
    ],
    ["another sequence", { solution: { ...solution, sequence: solution.sequence + 1 } }],
    ["another T", { transaction: `${QSB_MAINNET_ASSEMBLY.transaction.slice(0, -2)}00` }],
    ["no QSB scriptSig", { rawHex: QSB_MAINNET_ASSEMBLY.transaction }],
  ])("refuse %s", (_label, fields) => {
    expect(commits(fields)).toBe(false);
  });
});

describe("the helper signature on the first mainnet withdrawal", () => {
  test("verifies and finalizes to the confirmed withdrawal and its txid", () => {
    const expected = helperPsbt();
    expect(expected).not.toBeNull();
    const signed = finalizeQsbWithdrawal(
      expected as Transaction,
      signedWith([[OWNER_KEY as Uint8Array, SIGNATURE as Uint8Array]]),
      bytesToHex(OWNER_KEY as Uint8Array),
    );
    expect(signed).toEqual({ rawTxHex: QSB_MAINNET_WITHDRAWAL_TX, txid: WITHDRAWAL_TXID });
  });

  test("refuses a signature that does not verify, a second one, or another key", () => {
    const expected = helperPsbt() as Transaction;
    const key = OWNER_KEY as Uint8Array;
    const forged = Uint8Array.from(SIGNATURE as Uint8Array);
    forged[10] = (forged[10] ?? 0) ^ 1;
    const otherKey = Uint8Array.from(key);
    otherKey[0] = key[0] === 2 ? 3 : 2;
    for (const signatures of [
      [[key, forged]],
      [
        [key, SIGNATURE],
        [otherKey, SIGNATURE],
      ],
      [[otherKey, SIGNATURE]],
    ] as [Uint8Array, Uint8Array][][]) {
      expect(finalizeQsbWithdrawal(expected, signedWith(signatures), bytesToHex(key))).toBeNull();
    }
  });

  test("refuses a PSBT whose QSB scriptSig was changed", () => {
    const expected = helperPsbt() as Transaction;
    const tampered = helperPsbt() as Transaction;
    tampered.updateInput(
      0,
      { partialSig: [[OWNER_KEY as Uint8Array, SIGNATURE as Uint8Array]] },
      true,
    );
    const scriptSig = Uint8Array.from(tampered.getInput(1).finalScriptSig ?? []);
    scriptSig[scriptSig.length - 1] = 0x51;
    tampered.updateInput(1, { finalScriptSig: scriptSig }, true);
    expect(
      finalizeQsbWithdrawal(expected, tampered.toPSBT(), bytesToHex(OWNER_KEY as Uint8Array)),
    ).toBeNull();
  });
});
