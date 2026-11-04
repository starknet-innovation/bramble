/**
 * The deposit PSBT is built as qsb-app builds it, and what comes back from
 * signing is accepted only with a byte-identical unsigned transaction,
 * unchanged `witnessUtxo`s and one SIGHASH_ALL entry by the owner per input.
 * The entries here are placeholders put in place without any key (real
 * Krusty signatures are checked in tests/background/qsb); finalization only
 * moves them into the witness. Previous transactions and funding are checked
 * against their txids.
 */
import { describe, expect, test } from "bun:test";
import { bytesToHex } from "@bramble/core/hex";
import { buildQsbDepositPsbt, finalizeQsbDeposit, type QsbDepositPlan } from "@bramble/qsb/psbt";
import {
  isOwnerKey,
  isOwnerPayment,
  isVaultFunding,
  ownerP2wpkhScript,
  parseQsbTransaction,
  qsbTransactionVsize,
} from "@bramble/qsb/transactions";
import { Transaction } from "@scure/btc-signer";
import { OWNER, OWNER_SCRIPT, paymentTo, VAULT_SCRIPT } from "./fixtures";

// The secp256k1 generator, compressed: a valid key that is not the owner's.
const GENERATOR_KEY = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const previous = paymentTo([70_000, 40_000], "previous");
const plan: QsbDepositPlan = {
  amountSat: 50_000,
  changeSat: 39_000,
  inputs: [
    { previousTxHex: previous.rawHex, txid: previous.txid, valueSat: 70_000, vout: 0 },
    { previousTxHex: previous.rawHex, txid: previous.txid, valueSat: 40_000, vout: 1 },
  ],
  ownerAddress: OWNER.address,
  ownerScript: OWNER_SCRIPT,
  scriptHex: VAULT_SCRIPT,
};

// What a signer adds: one [owner key, DER-shaped bytes + sighash] per input.
const withEntries = (
  tx: Transaction,
  sighash = 0x01,
  key: string = OWNER.publicKey,
): Uint8Array => {
  const copy = Transaction.fromPSBT(tx.toPSBT(0), { allowUnknownOutputs: true });
  for (let index = 0; index < copy.inputsLength; index += 1) {
    copy.updateInput(index, {
      partialSig: [
        [Buffer.from(key, "hex"), Uint8Array.from([0x30, ...Array(69).fill(index + 1), sighash])],
      ],
    });
  }
  return copy.toPSBT(0);
};

describe("owner scripts and keys", () => {
  test("only a mainnet P2WPKH address has an owner script", () => {
    expect(bytesToHex(ownerP2wpkhScript(OWNER.address) ?? new Uint8Array())).toBe(
      bytesToHex(OWNER_SCRIPT),
    );
    expect(ownerP2wpkhScript("tb1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")).toBeNull();
    expect(ownerP2wpkhScript("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBeNull();
    expect(ownerP2wpkhScript("nonsense")).toBeNull();
  });

  test("the address must be the key's own", () => {
    expect(isOwnerKey(OWNER.address, OWNER.publicKey)).toBe(true);
    expect(isOwnerKey(OWNER.address, GENERATOR_KEY)).toBe(false);
    expect(isOwnerKey(OWNER.address, "zz")).toBe(false);
  });
});

describe("previous transactions and funding", () => {
  test("a payment input must be its txid and pay the owner exactly", () => {
    const base = { ownerScript: OWNER_SCRIPT, previousTxHex: previous.rawHex, txid: previous.txid };
    expect(isOwnerPayment({ ...base, valueSat: 70_000, vout: 0 })).toBe(true);
    expect(isOwnerPayment({ ...base, valueSat: 70_001, vout: 0 })).toBe(false);
    expect(isOwnerPayment({ ...base, valueSat: 40_000, vout: 2 })).toBe(false);
    expect(isOwnerPayment({ ...base, txid: "00".repeat(32), valueSat: 70_000, vout: 0 })).toBe(
      false,
    );
    const elsewhere = paymentTo([70_000], "elsewhere", Uint8Array.from([0x51]));
    expect(
      isOwnerPayment({
        ...base,
        previousTxHex: elsewhere.rawHex,
        txid: elsewhere.txid,
        valueSat: 70_000,
        vout: 0,
      }),
    ).toBe(false);
    expect(parseQsbTransaction("zz")).toBeNull();
    expect(parseQsbTransaction("00")).toBeNull();
  });

  test("funding must pay the vault script at output 0", () => {
    const funding = paymentTo([50_000], "funding", Buffer.from(VAULT_SCRIPT, "hex"));
    const base = { rawTxHex: funding.rawHex, scriptHex: VAULT_SCRIPT, txid: funding.txid };
    expect(isVaultFunding({ ...base, valueSat: 50_000 })).toBe(true);
    expect(isVaultFunding({ ...base, valueSat: 49_999 })).toBe(false);
    expect(isVaultFunding({ ...base, scriptHex: "51", valueSat: 50_000 })).toBe(false);
    expect(isVaultFunding({ ...base, txid: previous.txid, valueSat: 50_000 })).toBe(false);
  });
});

describe("building the deposit", () => {
  test("is version 2, lock time 0, inputs in order, the vault at output 0, change at 1", () => {
    const tx = buildQsbDepositPsbt(plan);
    expect(tx).not.toBeNull();
    const built = tx as Transaction;
    expect(built.version).toBe(2);
    expect(built.lockTime).toBe(0);
    expect(built.inputsLength).toBe(2);
    expect(built.getInput(1)).toMatchObject({ index: 1, sequence: 0xffff_fffe });
    expect(built.getInput(0).sighashType).toBeUndefined();
    expect(bytesToHex(built.getOutput(0).script ?? new Uint8Array())).toBe(VAULT_SCRIPT);
    expect(built.getOutput(0).amount).toBe(50_000n);
    expect(built.getOutput(1).amount).toBe(39_000n);
    expect(built.fee).toBe(21_000n);
    expect(buildQsbDepositPsbt({ ...plan, changeSat: 0 })?.outputsLength).toBe(1);
  });

  test.each([
    ["no inputs", { inputs: [] }],
    ["a repeated input", { inputs: [plan.inputs[0], plan.inputs[0]] }],
    [
      "a previous transaction that is not its txid",
      { inputs: [{ ...plan.inputs[0], txid: "00".repeat(32) }] },
    ],
    ["a short script", { scriptHex: "51".repeat(99) }],
    ["no fee", { changeSat: 60_000 }],
    ["a zero amount", { amountSat: 0 }],
  ])("refuses %s", (_label, change) => {
    expect(buildQsbDepositPsbt({ ...plan, ...change } as QsbDepositPlan)).toBeNull();
  });
});

describe("accepting a signed deposit", () => {
  const expected = buildQsbDepositPsbt(plan) as Transaction;

  test("finalizes each input's witness and extracts the transaction", () => {
    const signed = finalizeQsbDeposit(expected, withEntries(expected), OWNER.publicKey);
    expect(signed).not.toBeNull();
    const tx = Transaction.fromRaw(Buffer.from(signed?.rawTxHex ?? "", "hex"), {
      allowUnknownOutputs: true,
    });
    expect(tx.id).toBe(signed?.txid ?? "");
    expect(tx.getInput(0).finalScriptWitness?.map((item) => bytesToHex(item))[1]).toBe(
      OWNER.publicKey,
    );
    expect(bytesToHex(tx.unsignedTx)).toBe(bytesToHex(expected.unsignedTx));
    expect(qsbTransactionVsize(signed?.rawTxHex ?? "")).toBeGreaterThan(0);
  });

  test("refuses another transaction, even one that only moves the change", () => {
    const other = buildQsbDepositPsbt({ ...plan, changeSat: 38_000 }) as Transaction;
    expect(finalizeQsbDeposit(expected, withEntries(other), OWNER.publicKey)).toBeNull();
  });

  test("refuses a changed witnessUtxo, even over the same unsigned transaction", () => {
    // btc-signer itself refuses a witnessUtxo that contradicts nonWitnessUtxo,
    // so the altered copy carries none: only the comparison can catch it.
    const altered = new Transaction({ allowUnknownOutputs: true, version: 2 });
    plan.inputs.forEach((input, index) => {
      altered.addInput({
        index: input.vout,
        sequence: 0xffff_fffe,
        txid: input.txid,
        witnessUtxo: { amount: BigInt(input.valueSat - index), script: OWNER_SCRIPT },
      });
    });
    altered.addOutput({ amount: 50_000n, script: Buffer.from(VAULT_SCRIPT, "hex") });
    altered.addOutputAddress(OWNER.address, 39_000n);
    expect(bytesToHex(altered.unsignedTx)).toBe(bytesToHex(expected.unsignedTx));
    expect(finalizeQsbDeposit(expected, withEntries(altered), OWNER.publicKey)).toBeNull();
  });

  test.each([
    ["SIGHASH_NONE|ANYONECANPAY", withEntries(expected, 0x82)],
    ["another key", withEntries(expected, 0x01, GENERATOR_KEY)],
    ["no entries", expected.toPSBT(0)],
    ["bytes that are not a PSBT", Uint8Array.from([1, 2, 3])],
  ])("refuses %s", (_label, bytes) => {
    expect(finalizeQsbDeposit(expected, bytes, OWNER.publicKey)).toBeNull();
  });

  test("refuses a requested sighash type other than ALL", () => {
    const copy = Transaction.fromPSBT(withEntries(expected), { allowUnknownOutputs: true });
    copy.updateInput(1, { sighashType: 0x83 }, true);
    expect(finalizeQsbDeposit(expected, copy.toPSBT(0), OWNER.publicKey)).toBeNull();
  });
});
