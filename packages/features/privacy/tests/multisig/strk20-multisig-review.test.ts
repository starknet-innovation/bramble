/**
 * The signing review is the hashed calls. A sender's label is not rendered, a
 * live proof is not evicted, and a lock rolls an in-flight write back.
 */
import { describe, expect, test } from "bun:test";
import {
  type MultisigStrk20Authorization,
  type MultisigStrk20RelayRequest,
  multisigStrk20CallSetHash,
  withMultisigStrk20RelayFragment,
} from "@bramble/privacy/multisig-strk20";
import { redactStrk20Calldata } from "@bramble/privacy/multisig-strk20-redaction";
import {
  isMultisigStrk20RelayInvite,
  multisigStrk20RelayInviteFrom,
} from "@bramble/privacy/multisig-strk20-relay-invite";
import { reviewMultisigStrk20Calls } from "@bramble/privacy/multisig-strk20-review";
import { createMultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { ec, num, typedData } from "starknet";
import { paymasterTypedData } from "../support/paymaster";

const SCALAR = "0x654321";
const ACCOUNT = "0x123";
const CHAIN = STARKNET_NETWORKS.SN_MAIN.chainId;
const FORGED = "Totally a registration";

const authorization = (summary: string): MultisigStrk20Authorization => {
  const calls = [
    {
      calldata: redactStrk20Calldata(["0x10", SCALAR, "0x9999"], SCALAR) ?? [],
      contractAddress: ACCOUNT,
      entrypoint: "compile_actions",
    },
  ];
  const hash = multisigStrk20CallSetHash(ACCOUNT, calls, CHAIN, SCALAR) ?? "0x1";
  return {
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
    summary,
    threshold: 1,
  };
};

const proof = (intentId: string) => ({
  intentId,
  proof: {
    data: "aa",
    output: ["0x1"],
    proof_facts: ["0x1", "0x2", "0x3", "0x4", "0x5", "0x6", "0x7", "0x1", "0x9"],
  },
  request: { kind: "register" as const },
});

describe("multisig STRK20 review binding", () => {
  test("shows the restored calls and not a label the sender wrote", async () => {
    const record = authorization(FORGED);
    const store = createMultisigStrk20Store(createMemoryStore());
    expect(await store.upsertAuthorization(record, SCALAR)).toBe("stored");
    const review = reviewMultisigStrk20Calls(record.calls, SCALAR, []);
    expect(review).toEqual({ lines: ["0x10", "0x9999"], title: "compile_actions" });
    expect(JSON.stringify(review)).not.toContain(FORGED);
  });

  test("keeps a proof whose intent is still live and refuses a ninth live proof", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    const live = Array.from({ length: 8 }, (_, index) => `intent-${index}`);
    for (const id of live) expect(await store.putProof(proof(id), live)).toBe("stored");
    expect(await store.putProof(proof("intent-8"), [...live, "intent-8"])).toBe("full");
    expect(await store.getProof("intent-0")).not.toBeNull();
    const nextLive = [...live.slice(1), "intent-9"];
    expect(await store.putProof(proof("intent-9"), nextLive)).toBe("stored");
    expect(await store.getProof("intent-0")).toBeNull();
    expect(await store.getProof("intent-1")).not.toBeNull();
    expect(await store.getProof("intent-9")).not.toBeNull();
  });

  test("rolls an authorization back when the unlock lapses during the write", async () => {
    const record = authorization("Register this multisig's private balance");
    let open = true;
    const memory = createMemoryStore();
    const store = createMultisigStrk20Store({
      get: (key) => memory.get(key),
      remove: (key) => memory.remove(key),
      set: async (key, value) => {
        await memory.set(key, value);
        open = false;
      },
    } satisfies KeyValueStore);
    expect(await store.upsertAuthorization(record, SCALAR, () => open)).toBe("unauthorized");
    expect(await store.getAuthorization(record.id, SCALAR)).toBeNull();
  });
});

describe("multisig STRK20 relay invite", () => {
  test("shares fragments without the proof and merges them onto the local relay", () => {
    const firstKey = "0x11";
    const secondKey = "0x22";
    const signers = [
      ec.starkCurve.getStarkKey(firstKey),
      ec.starkCurve.getStarkKey(secondKey),
    ].sort((left, right) =>
      BigInt(argentSignerGuid(left)) < BigInt(argentSignerGuid(right)) ? -1 : 1,
    );
    const typed = paymasterTypedData();
    const messageHash = num.toHex(typedData.getMessageHash(typed, ACCOUNT));
    const fragmentFor = (privateKey: string) => {
      const signed = ec.starkCurve.sign(messageHash, privateKey);
      return {
        publicKey: ec.starkCurve.getStarkKey(privateKey),
        r: num.toHex(signed.r),
        s: num.toHex(signed.s),
      };
    };
    const first = fragmentFor(firstKey);
    const second = fragmentFor(secondKey);
    const relay: MultisigStrk20RelayRequest = {
      accountAddress: ACCOUNT,
      accountId: `SN_MAIN:${ACCOUNT}`,
      authorization: {
        caller: "0x99",
        executeAfter: "0x1",
        executeBefore: "0x100",
        publicCallCount: 1,
      },
      call: {
        calldata: ["0x1"],
        contractAddress: "0x2",
        entrypoint: "apply_actions",
      },
      feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
      fragments: [first],
      id: `SN_MAIN:${ACCOUNT}:${messageHash}`,
      messageHash,
      proof: { ...proof("relay").proof, data: "proof-bytes-marker" },
      request: { amount: "0x10", kind: "transfer", recipient: "0x6", token: "0x7" },
      signerPublicKeys: signers,
      state: "collecting",
      summary: FORGED,
      threshold: 2,
      typedData: typed,
    };
    const invite = multisigStrk20RelayInviteFrom(relay);
    expect(invite).not.toBeNull();
    expect(JSON.stringify(invite)).not.toContain("proof-bytes-marker");
    expect(isMultisigStrk20RelayInvite({ ...invite, proof: relay.proof })).toBe(false);
    const merged = withMultisigStrk20RelayFragment(relay, second);
    expect(merged?.state).toBe("ready");
    expect(merged?.proof.data).toBe("proof-bytes-marker");
    expect(merged?.fragments).toHaveLength(2);
  });
});
