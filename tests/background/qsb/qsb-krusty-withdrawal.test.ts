/**
 * Krusty signs a QSB withdrawal's helper input, and nothing else. A
 * withdrawal shaped as `finish` returns it — input 0 the owner's helper
 * output, unsigned; input 1 the vault, already final with a QSB scriptSig —
 * becomes the helper PSBT `@bramble/qsb` builds; the real Krusty adapter
 * signs input 0 with the BIP-84 test key; the result leaves input 1's final
 * scriptSig byte-identical, verifies against BIP-143, and finalizes to a
 * transaction whose helper witness is `[signature, key]` and whose vault
 * input is untouched. Every key here is a published test vector.
 */
import { describe, expect, test } from "bun:test";
import { bytesToHex, hexToBytes } from "@bramble/core/hex";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { ownerP2wpkhScript } from "@bramble/qsb/transactions";
import { buildQsbHelperPsbt, finalizeQsbWithdrawal } from "@bramble/qsb/withdrawal-psbt";
import { Transaction } from "@scure/btc-signer";
import { paymentToAddress } from "../../support/qsb-coordinator-fake";

const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
const owner = await kms.deriveBitcoinP2wpkhKeypair(`${"abandon ".repeat(11)}about`, 0, 0, 0);
const OWNER_SCRIPT = ownerP2wpkhScript(owner.address) ?? new Uint8Array();
const OPTIONS = { allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true };
// A push-only stand-in for the QSB scriptSig: what Krusty must not touch.
const QSB_SCRIPT_SIG = Uint8Array.from([0x14, ...new Uint8Array(20).fill(7), 0x51]);

const [helper] = paymentToAddress(owner.address, [5_000], "qsb withdrawal helper");
const [funding] = paymentToAddress(owner.address, [100_000], "qsb withdrawal vault");
if (!helper || !funding) throw new Error("no fixture outputs");

// `finish`'s shape: legacy serialization, input 1 final, input 0 empty.
const finished = (): string => {
  const tx = new Transaction({ ...OPTIONS, lockTime: 950_229_240, version: 1 });
  // btc-signer takes no output once an input is final, so the output goes first.
  tx.addInput({ index: helper.vout, sequence: 0xffff_fffe, txid: helper.txid });
  tx.addOutput({ amount: 92_000n, script: OWNER_SCRIPT });
  tx.addInput({
    finalScriptSig: QSB_SCRIPT_SIG,
    index: funding.vout,
    sequence: 0x8000_07a1,
    txid: funding.txid,
  });
  return bytesToHex(tx.toBytes(true, false));
};

describe("Krusty's helper signature", () => {
  test("signs input 0 only, leaves the QSB input final, and verifies", async () => {
    const expected = buildQsbHelperPsbt({
      fundingPreviousTxHex: funding.rawHex,
      helperPreviousTxHex: helper.rawHex,
      helperSat: 5_000n,
      ownerScript: OWNER_SCRIPT,
      rawHex: finished(),
    });
    if (!expected) throw new Error("no helper PSBT");
    const signed = await kms.signBitcoinPsbtInputs(owner.privateKey, expected.toPSBT(), [0]);
    const returned = Transaction.fromPSBT(signed, OPTIONS);
    expect(bytesToHex(returned.getInput(1).finalScriptSig ?? new Uint8Array())).toBe(
      bytesToHex(QSB_SCRIPT_SIG),
    );
    expect(returned.getInput(1).partialSig ?? []).toEqual([]);
    const final = finalizeQsbWithdrawal(expected, signed, owner.publicKey);
    expect(final).not.toBeNull();
    const tx = Transaction.fromRaw(hexToBytes(final?.rawTxHex ?? "") ?? new Uint8Array(), OPTIONS);
    expect(tx.id).toBe(final?.txid as string);
    expect(tx.getInput(0).finalScriptWitness?.map(bytesToHex)[1]).toBe(owner.publicKey);
    expect(bytesToHex(tx.getInput(1).finalScriptSig ?? new Uint8Array())).toBe(
      bytesToHex(QSB_SCRIPT_SIG),
    );
    expect(tx.getInput(1).finalScriptWitness ?? []).toEqual([]);
  });

  test("refuses to sign the QSB input, which is not the owner's coin", async () => {
    const expected = buildQsbHelperPsbt({
      fundingPreviousTxHex: funding.rawHex,
      helperPreviousTxHex: helper.rawHex,
      helperSat: 5_000n,
      ownerScript: OWNER_SCRIPT,
      rawHex: finished(),
    });
    await expect(
      kms.signBitcoinPsbtInputs(owner.privateKey, expected?.toPSBT() ?? new Uint8Array(), [1]),
    ).rejects.toThrow();
  });
});
