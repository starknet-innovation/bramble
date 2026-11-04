/**
 * The Krusty adapter's QSB and Bitcoin calls refuse every malformed input
 * before Krusty sees it and every malformed result before a caller does, and
 * free each Krusty result object once it is read. The module doubles answer
 * with plain objects; the real-Krusty known answers live in `check:krusty`
 * and tests/background/qsb/qsb-krusty-bitcoin.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import {
  BIP84_VECTOR,
  BIP322_WITNESS,
  bitcoinExports,
  commitmentsResult,
  PSBT_BYTES,
} from "./bitcoin-exports";

const PHRASE = `${"abandon ".repeat(11)}about`;
const KEY = BIP84_VECTOR.private_key;
const ADDRESS = BIP84_VECTOR.address;

// Every export the adapter requires, the Bitcoin ones from the fixture.
const moduleWith = (overrides: Record<string, unknown> = {}) => {
  const unused = () => {
    throw new Error("not under test");
  };
  return {
    ...Object.fromEntries(
      [
        "deriveArgentLegacyKeypair",
        "deriveNostrPublicKey",
        "deriveOzAccountAddress",
        "deriveScopedStrk20ViewingKey",
        "deriveStarknetKeypair",
        "generateMnemonic",
        "getAccountClassHashes",
        "openNostrApplicationData",
        "signStarkHash",
        "validateMnemonic",
        "wrapNostrApplicationData",
      ].map((name) => [name, unused]),
    ),
    ...bitcoinExports(overrides),
  };
};

const kmsWith = (overrides: Record<string, unknown> = {}) => createKrustyKms(moduleWith(overrides));

// A result object of one of Krusty's own classes, whose fields are getters on
// the prototype and whose `free` the adapter must call.
const krustyObject = (name: string, fields: Record<string, unknown>) => {
  const freed: string[] = [];
  const Klass = { [name]: class {} }[name] as new () => object;
  for (const [field, value] of Object.entries(fields)) {
    Object.defineProperty(Klass.prototype, field, { get: () => value });
  }
  Object.defineProperty(Klass.prototype, "free", {
    value() {
      freed.push(name);
    },
  });
  return { freed, value: new Klass() };
};

describe("the adapter requires every QSB and Bitcoin export", () => {
  test.each([
    "deriveBitcoinP2wpkhKeypair",
    "deriveQsbCommitments",
    "signBip322Simple",
    "signBitcoinPsbtInputs",
  ])("refuses a module without %s", (name) => {
    expect(() => kmsWith({ [name]: undefined })).toThrow(`Krusty KMS export missing: ${name}`);
  });
});

describe("deriveQsbCommitments", () => {
  test("returns the commitments in round order with their root, net 0", async () => {
    const calls: unknown[][] = [];
    const expected = commitmentsResult();
    const kms = kmsWith({
      deriveQsbCommitments: (...args: unknown[]) => {
        calls.push(args);
        return expected;
      },
    });
    expect(await kms.deriveQsbCommitments(PHRASE, 7)).toEqual(expected);
    expect(calls).toEqual([[PHRASE, 0, 7]]);
  });

  test("reads and frees a Krusty result object", async () => {
    const { freed, value } = krustyObject("WasmQsbCommitments", commitmentsResult());
    const kms = kmsWith({ deriveQsbCommitments: () => value });
    expect((await kms.deriveQsbCommitments(PHRASE, 0)).round0).toHaveLength(150);
    expect(freed).toEqual(["WasmQsbCommitments"]);
  });

  test.each([-1, 2 ** 31, 1.5, Number.NaN])("refuses vault index %p", async (index) => {
    await expect(kmsWith().deriveQsbCommitments(PHRASE, index)).rejects.toThrow(
      "Invalid QSB derivation input",
    );
  });

  test("refuses a phrase that is not mnemonic text", async () => {
    await expect(kmsWith().deriveQsbCommitments("", 0)).rejects.toThrow(
      "Invalid QSB derivation input",
    );
  });

  const good = commitmentsResult();
  test.each([
    ["a short round", { ...good, round0: good.round0.slice(1) }],
    ["uppercase hex", { ...good, round1: good.round1.map((c) => c.toUpperCase()) }],
    [
      "a 19-byte commitment",
      { ...good, round0: [good.round0[0]?.slice(2), ...good.round0.slice(1)] },
    ],
    ["a repeated commitment", { ...good, round1: [good.round0[0], ...good.round1.slice(1)] }],
    ["a root over other commitments", { ...good, root: commitmentsResult("other").root }],
    ["a malformed root", { ...good, root: "00" }],
  ])("refuses %s, and still frees the result", async (_label, result) => {
    const { freed, value } = krustyObject("WasmQsbCommitments", result);
    await expect(
      kmsWith({ deriveQsbCommitments: () => value }).deriveQsbCommitments(PHRASE, 0),
    ).rejects.toThrow("Krusty KMS returned");
    expect(freed).toEqual(["WasmQsbCommitments"]);
  });
});

describe("deriveBitcoinP2wpkhKeypair", () => {
  test("returns the BIP-84 keypair and frees Krusty's copy", async () => {
    const { freed, value } = krustyObject("WasmBitcoinP2wpkhKeypair", BIP84_VECTOR);
    const kms = kmsWith({ deriveBitcoinP2wpkhKeypair: () => value });
    expect(await kms.deriveBitcoinP2wpkhKeypair(PHRASE, 0, 0, 0)).toEqual({
      address: ADDRESS,
      privateKey: KEY,
      publicKey: BIP84_VECTOR.public_key,
    });
    expect(freed).toEqual(["WasmBitcoinP2wpkhKeypair"]);
  });

  test.each([
    [-1, 0, 0],
    [2 ** 31, 0, 0],
    [0, 2, 0],
    [0, 0, 2 ** 31],
  ])("refuses account %p change %p index %p", async (account, change, index) => {
    await expect(
      kmsWith().deriveBitcoinP2wpkhKeypair(PHRASE, account, change, index),
    ).rejects.toThrow("Invalid Bitcoin derivation input");
  });

  test.each([
    ["a testnet address", { address: "tb1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu" }],
    ["a taproot address", { address: `bc1p${"q".repeat(58)}` }],
    ["an uncompressed key", { public_key: `04${"11".repeat(64)}` }],
    ["a zero private key", { private_key: "00".repeat(32) }],
    [
      "a key at the group order",
      { private_key: "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141" },
    ],
    ["another path", { path: "m/84'/0'/0'/0/1" }],
  ])("refuses %s", async (_label, change) => {
    await expect(
      kmsWith({
        deriveBitcoinP2wpkhKeypair: () => ({ ...BIP84_VECTOR, ...change }),
      }).deriveBitcoinP2wpkhKeypair(PHRASE, 0, 0, 0),
    ).rejects.toThrow("Krusty KMS returned an invalid Bitcoin P2WPKH keypair");
  });
});

describe("signBip322SimpleUnprefixed", () => {
  test("asks Krusty for the unprefixed form and returns the witness", async () => {
    const calls: unknown[][] = [];
    const kms = kmsWith({
      signBip322Simple: (...args: unknown[]) => {
        calls.push(args);
        return BIP322_WITNESS;
      },
    });
    expect(await kms.signBip322SimpleUnprefixed(KEY, ADDRESS, "hello")).toBe(BIP322_WITNESS);
    expect(calls).toEqual([[KEY, ADDRESS, "hello", true]]);
  });

  test.each([
    ["an empty message", KEY, ADDRESS, ""],
    ["an oversized message", KEY, ADDRESS, "x".repeat(4_097)],
    ["a 0x key", `0x${KEY.slice(2)}`, ADDRESS, "m"],
    ["a non-P2WPKH address", KEY, "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "m"],
  ])("refuses %s", async (_label, key, address, message) => {
    await expect(kmsWith().signBip322SimpleUnprefixed(key, address, message)).rejects.toThrow(
      "Invalid BIP-322 signing input",
    );
  });

  const witness = Buffer.from(BIP322_WITNESS, "base64");
  test.each([
    ["the smp-prefixed form", `smp${BIP322_WITNESS}`],
    [
      "three witness items",
      Buffer.concat([Buffer.from([3]), witness.subarray(1)]).toString("base64"),
    ],
    [
      "a non-ALL sighash",
      Buffer.from(witness.map((byte, index) => (index === 73 ? 0x81 : byte))).toString("base64"),
    ],
    ["trailing bytes", Buffer.concat([witness, Buffer.from([0])]).toString("base64")],
    ["a non-string", 42],
  ])("refuses %s", async (_label, proof) => {
    await expect(
      kmsWith({ signBip322Simple: () => proof }).signBip322SimpleUnprefixed(KEY, ADDRESS, "m"),
    ).rejects.toThrow("Krusty KMS returned an invalid BIP-322 proof");
  });
});

describe("signBitcoinPsbtInputs", () => {
  test("hands Krusty base64 and the indices, and returns the PSBT bytes", async () => {
    const calls: unknown[][] = [];
    const kms = kmsWith({
      signBitcoinPsbtInputs: (...args: unknown[]) => {
        calls.push(args);
        return args[1];
      },
    });
    expect(await kms.signBitcoinPsbtInputs(KEY, PSBT_BYTES, [0, 1])).toEqual(PSBT_BYTES);
    expect(calls).toEqual([[KEY, Buffer.from(PSBT_BYTES).toString("base64"), [0, 1]]]);
  });

  test.each([
    ["no indices", PSBT_BYTES, []],
    ["a repeated index", PSBT_BYTES, [0, 0]],
    ["a negative index", PSBT_BYTES, [-1]],
    ["bytes that are not a PSBT", Uint8Array.from([1, 2, 3, 4, 5]), [0]],
  ])("refuses %s", async (_label, psbt, indices) => {
    await expect(kmsWith().signBitcoinPsbtInputs(KEY, psbt, indices)).rejects.toThrow(
      "Invalid PSBT signing input",
    );
  });

  test.each([
    ["base64 that is not a PSBT", Buffer.from("not a psbt").toString("base64")],
    ["text that is not base64", "%%%"],
    [
      "a PSBT that grew past its signatures",
      Buffer.concat([Buffer.from(PSBT_BYTES), Buffer.alloc(200)]).toString("base64"),
    ],
  ])("refuses %s", async (_label, result) => {
    await expect(
      kmsWith({ signBitcoinPsbtInputs: () => result }).signBitcoinPsbtInputs(KEY, PSBT_BYTES, [0]),
    ).rejects.toThrow("Krusty KMS returned an invalid PSBT");
  });
});
