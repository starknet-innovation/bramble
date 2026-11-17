/**
 * Multisig STRK20 rounds: the pool's proof window, scalar redaction, and the
 * Argent aggregate the CallSet signer must return.
 */
import { describe, expect, test } from "bun:test";
import { Strk20CallSetSigner } from "@bramble/privacy/call-set-signer";
import {
  strk20ProofBaseBlock,
  strk20ProofSubmittable,
} from "@bramble/privacy/multisig-proof-window";
import {
  type MultisigStrk20Authorization,
  multisigStrk20CallSetAggregate,
  multisigStrk20CallSetHash,
  withMultisigStrk20Fragment,
} from "@bramble/privacy/multisig-strk20";
import {
  MULTISIG_STRK20_REDACTED_FELT,
  redactStrk20Calldata,
  restoreStrk20Calldata,
} from "@bramble/privacy/multisig-strk20-redaction";
import { createMultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import { createMemoryStore } from "@bramble/store/kv";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { ec, type InvocationsSignerDetails, num } from "starknet";

const SCALAR = "0x654321";
const ACCOUNT = "0x123";
const CHAIN = STARKNET_NETWORKS.SN_MAIN.chainId;

const factsFor = (base: number, span = "0x1"): readonly string[] => [
  "0x1",
  "0x2",
  "0x3",
  "0x4",
  num.toHex(base),
  "0x6",
  "0x7",
  span,
  "0x9",
];

describe("STRK20 proof window", () => {
  test("reads the base block only from the pool's ProofFacts layout", () => {
    expect(strk20ProofBaseBlock(factsFor(100))).toBe(100n);
    expect(strk20ProofBaseBlock(["0x1", "0x2"])).toBeNull();
    expect(strk20ProofBaseBlock(factsFor(100, "0x2"))).toBeNull();
  });

  test("matches the pool's acceptance inequality", () => {
    expect(
      strk20ProofSubmittable({ baseBlock: 100n, currentBlock: 120n, validityBlocks: 50n }),
    ).toBe(true);
    expect(
      strk20ProofSubmittable({ baseBlock: 100n, currentBlock: 100n, validityBlocks: 50n }),
    ).toBe(false);
    expect(
      strk20ProofSubmittable({ baseBlock: 100n, currentBlock: 151n, validityBlocks: 50n }),
    ).toBe(false);
    expect(
      strk20ProofSubmittable({ baseBlock: 100n, currentBlock: 150n, validityBlocks: 50n }),
    ).toBe(true);
  });
});

describe("multisig STRK20 calldata redaction", () => {
  test("round-trips the scalar and refuses a marker that was already present", () => {
    const redacted = redactStrk20Calldata(["0x1", SCALAR, "0x2"], SCALAR);
    expect(redacted).toEqual(["0x1", MULTISIG_STRK20_REDACTED_FELT, "0x2"]);
    expect(redacted?.join(" ")).not.toContain(SCALAR);
    expect(restoreStrk20Calldata(redacted ?? [], SCALAR)).toEqual(["0x1", SCALAR, "0x2"]);
    expect(redactStrk20Calldata([MULTISIG_STRK20_REDACTED_FELT], SCALAR)).toBeNull();
    expect(restoreStrk20Calldata(["0x1", SCALAR], SCALAR)).toBeNull();
  });
});

describe("multisig STRK20 CallSet aggregate", () => {
  test("the SDK signer returns the Argent multisig aggregate unchanged", async () => {
    const privateKey = "0x1234567890abcdef";
    const publicKey = ec.starkCurve.getStarkKey(privateKey);
    const calls = [
      { calldata: ["0x1", SCALAR], contractAddress: ACCOUNT, entrypoint: "compile_actions" },
    ];
    const redactedCalls = calls.map((call) => ({
      ...call,
      calldata: redactStrk20Calldata(call.calldata, SCALAR) ?? [],
    }));
    const hash = multisigStrk20CallSetHash(ACCOUNT, redactedCalls, CHAIN, SCALAR);
    expect(hash).not.toBeNull();
    const signed = ec.starkCurve.sign(hash ?? "0x0", privateKey);
    const fragment = { publicKey, r: num.toHex(signed.r), s: num.toHex(signed.s) };
    const authorization: MultisigStrk20Authorization = {
      accountAddress: ACCOUNT,
      accountId: `SN_MAIN:${ACCOUNT}`,
      calls: redactedCalls,
      chainId: CHAIN,
      fragments: [],
      hash: hash ?? "0x0",
      id: `SN_MAIN:${ACCOUNT}:${hash}`,
      request: { kind: "register" },
      signerPublicKeys: [publicKey],
      state: "collecting",
      summary: "Register this multisig's private balance",
      threshold: 1,
    };
    const withFragment = withMultisigStrk20Fragment(authorization, fragment);
    expect(withFragment?.state).toBe("ready");
    const aggregate = multisigStrk20CallSetAggregate(withFragment?.fragments ?? [], {
      signerPublicKeys: [publicKey],
      threshold: 1,
    });
    expect(aggregate[0]).toBe("1");
    expect(aggregate[1]).toBe("0");
    expect(aggregate).toContain(publicKey);
    const signer = new Strk20CallSetSigner({
      accountAddress: ACCOUNT,
      chainId: CHAIN,
      sign: async (_messageHash, forwarded) => {
        expect(forwarded).toEqual(calls);
        return [...aggregate];
      },
    });
    await expect(signer.signTransaction(calls, {} as InvocationsSignerDetails)).resolves.toEqual([
      ...aggregate,
    ]);
  });

  test("stores an authorization and keeps the scalar out of the row", async () => {
    const memory = createMemoryStore();
    const store = createMultisigStrk20Store(memory);
    const calls = [
      {
        calldata: redactStrk20Calldata(["0x1", SCALAR], SCALAR) ?? [],
        contractAddress: ACCOUNT,
        entrypoint: "compile_actions",
      },
    ];
    const hash = multisigStrk20CallSetHash(ACCOUNT, calls, CHAIN, SCALAR) ?? "0x1";
    const record: MultisigStrk20Authorization = {
      accountAddress: ACCOUNT,
      accountId: `SN_MAIN:${ACCOUNT}`,
      calls,
      chainId: CHAIN,
      fragments: [],
      hash,
      id: `SN_MAIN:${ACCOUNT}:${hash}`,
      request: { kind: "register" },
      signerPublicKeys: ["0xabc"],
      state: "collecting",
      summary: "Register this multisig's private balance",
      threshold: 1,
    };
    expect(await store.upsertAuthorization(record, SCALAR)).toBe("stored");
    const saved = JSON.stringify(await memory.get("bramble:argent-multisig-strk20:v1"));
    expect(saved).not.toContain(SCALAR);
    expect(await store.getAuthorization(record.id, "0x111")).toBeNull();
    expect((await store.getAuthorization(record.id, SCALAR))?.id).toBe(record.id);
  });
});
