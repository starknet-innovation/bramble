/**
 * Krusty's QSB signatures, checked without Krusty. A deposit PSBT built by
 * `@bramble/qsb` is signed by the real Krusty adapter with the BIP-84 test
 * key, accepted by the post-sign verification, finalized and extracted; each
 * input's signature is then verified with secp256k1 against the BIP-143
 * SIGHASH_ALL digest btc-signer computes for that input, low-R and low-S. The
 * sign-in proof is verified the same way, over BIP-322's own `to_spend` and
 * `to_sign` transactions. Every key and phrase here is a published test vector.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { buildQsbDepositPsbt, finalizeQsbDeposit } from "@bramble/qsb/psbt";
import { ownerP2wpkhScript } from "@bramble/qsb/transactions";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { NETWORK, OutScript, p2wpkh, Script, SigHash, Transaction } from "@scure/btc-signer";
import { paymentToAddress } from "../../support/qsb-coordinator-fake";

const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
const owner = await kms.deriveBitcoinP2wpkhKeypair(`${"abandon ".repeat(11)}about`, 0, 0, 0);
const OWNER_SCRIPT = ownerP2wpkhScript(owner.address) ?? new Uint8Array();
const PUBLIC_KEY = Buffer.from(owner.publicKey, "hex");
// BIP-143's scriptCode for a P2WPKH spend: the P2PKH script of the key hash.
const SCRIPT_CODE = OutScript.encode({ hash: p2wpkh(PUBLIC_KEY, NETWORK).hash, type: "pkh" });
const VAULT_SCRIPT = `${Array.from(
  { length: 300 },
  (_, index) => `14${createHash("sha256").update(`vault ${index}`).digest("hex").slice(0, 40)}`,
).join("")}ac`;

const sha256 = (data: Uint8Array): Uint8Array => createHash("sha256").update(data).digest();
const taggedHash = (tag: string, message: Uint8Array): Uint8Array => {
  const tagHash = sha256(Buffer.from(tag));
  return sha256(Buffer.concat([tagHash, tagHash, message]));
};

// A DER signature with its sighash byte removed, checked low-S by noble.
const isValidAll = (signed: Uint8Array, digest: Uint8Array): boolean =>
  signed.at(-1) === SigHash.ALL &&
  signed.length <= 72 &&
  secp256k1.verify(signed.subarray(0, -1), digest, PUBLIC_KEY, {
    format: "der",
    lowS: true,
    prehash: false,
  });

describe("Krusty's deposit signatures", () => {
  test("verify against each input's BIP-143 digest, and finalize into a valid deposit", async () => {
    const coins = [
      ...paymentToAddress(owner.address, [70_000], "first"),
      ...paymentToAddress(owner.address, [40_000, 5_000], "second"),
    ].slice(0, 2);
    const unsigned = buildQsbDepositPsbt({
      amountSat: 80_000,
      changeSat: 9_000,
      inputs: coins.map((coin) => ({ ...coin, previousTxHex: coin.rawHex })),
      ownerAddress: owner.address,
      ownerScript: OWNER_SCRIPT,
      scriptHex: VAULT_SCRIPT,
    });
    expect(unsigned).not.toBeNull();
    const expected = unsigned as Transaction;
    const signed = await kms.signBitcoinPsbtInputs(owner.privateKey, expected.toPSBT(0), [0, 1]);
    const deposit = finalizeQsbDeposit(expected, signed, owner.publicKey);
    expect(deposit).not.toBeNull();
    const tx = Transaction.fromRaw(Buffer.from(deposit?.rawTxHex ?? "", "hex"), {
      allowUnknownOutputs: true,
    });
    expect(tx.id).toBe(deposit?.txid ?? "");
    for (const [index, coin] of coins.entries()) {
      const [item, key] = tx.getInput(index).finalScriptWitness ?? [];
      expect(Buffer.from(key ?? []).toString("hex")).toBe(owner.publicKey);
      const digest = tx.preimageWitnessV0(index, SCRIPT_CODE, SigHash.ALL, BigInt(coin.valueSat));
      expect(isValidAll(item ?? new Uint8Array(), digest)).toBe(true);
      // Another input's digest does not verify: the signature is this input's.
      const other = tx.preimageWitnessV0(
        1 - index,
        SCRIPT_CODE,
        SigHash.ALL,
        BigInt(coins[1 - index]?.valueSat ?? 0),
      );
      expect(isValidAll(item ?? new Uint8Array(), other)).toBe(false);
    }
  });

  test("a coin that is not the owner's is refused, by the builder and by Krusty", async () => {
    const foreignAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
    const [foreign] = paymentToAddress(foreignAddress, [70_000], "foreign");
    const coin = {
      ...(foreign as NonNullable<typeof foreign>),
      previousTxHex: foreign?.rawHex ?? "",
    };
    // The builder states the owner's script as the coin's witness UTXO, which
    // its previous transaction contradicts, so it builds nothing.
    expect(
      buildQsbDepositPsbt({
        amountSat: 50_000,
        changeSat: 0,
        inputs: [coin],
        ownerAddress: owner.address,
        ownerScript: OWNER_SCRIPT,
        scriptHex: VAULT_SCRIPT,
      }),
    ).toBeNull();
    // Stated honestly, the foreign coin is still not the key's to sign.
    const foreignScript = ownerP2wpkhScript(foreignAddress) ?? new Uint8Array();
    const tx = new Transaction({ allowUnknownOutputs: true, version: 2 });
    tx.addInput({
      index: 0,
      nonWitnessUtxo: Buffer.from(coin.rawHex, "hex"),
      txid: coin.txid,
      witnessUtxo: { amount: 70_000n, script: foreignScript },
    });
    tx.addOutput({ amount: 50_000n, script: Buffer.from(VAULT_SCRIPT, "hex") });
    await expect(kms.signBitcoinPsbtInputs(owner.privateKey, tx.toPSBT(0), [0])).rejects.toThrow();
  });
});

describe("Krusty's sign-in proof", () => {
  test("is the unprefixed BIP-322 simple witness, valid over to_sign's digest", async () => {
    const message = "QSB Vault sign-in\nExample";
    const proof = Buffer.from(
      await kms.signBip322SimpleUnprefixed(owner.privateKey, owner.address, message),
      "base64",
    );
    expect(proof.toString("utf8", 0, 3)).not.toBe("smp");
    const [count, length] = proof;
    expect(count).toBe(2);
    const item = proof.subarray(2, 2 + (length ?? 0));
    expect(proof.subarray(3 + (length ?? 0)).toString("hex")).toBe(owner.publicKey);

    const toSpend = new Transaction({
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
      version: 0,
    });
    toSpend.addOutput({ amount: 0n, script: OWNER_SCRIPT });
    toSpend.addInput({
      finalScriptSig: Script.encode([
        0,
        taggedHash("BIP0322-signed-message", Buffer.from(message)),
      ]),
      index: 0xffff_ffff,
      sequence: 0,
      txid: "00".repeat(32),
    });
    const toSign = new Transaction({ allowUnknownOutputs: true, version: 0 });
    toSign.addInput({
      index: 0,
      sequence: 0,
      txid: Transaction.fromRaw(toSpend.toBytes(true, false), {
        allowUnknownInputs: true,
        allowUnknownOutputs: true,
      }).id,
      witnessUtxo: { amount: 0n, script: OWNER_SCRIPT },
    });
    toSign.addOutput({ amount: 0n, script: Script.encode(["RETURN"]) });
    const digest = toSign.preimageWitnessV0(0, SCRIPT_CODE, SigHash.ALL, 0n);
    expect(isValidAll(item, digest)).toBe(true);
    const tampered = taggedHash("BIP0322-signed-message", Buffer.from(`${message}!`));
    expect(isValidAll(item, tampered)).toBe(false);
  });
});
