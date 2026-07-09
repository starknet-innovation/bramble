/**
 * Multisig registry invariants: record validation, deterministic ids, caps,
 * orphaned-proposal filtering, and remove cascades.
 */
import { describe, expect, test } from "bun:test";
import {
  createMultisigStore,
  isMultisigProposalRecord,
  isMultisigRecord,
  MULTISIG_STORE_KEY,
  type MultisigProposalRecord,
  type MultisigRecord,
  multisigId,
  multisigProposalId,
} from "../src/storage/multisig-store";

const SIGNER_A = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const SIGNER_B = "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const ADDRESS = "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const record: MultisigRecord = {
  address: ADDRESS,
  id: multisigId("SN_MAIN", ADDRESS) ?? "",
  networkId: "SN_MAIN",
  quorum: 2,
  signers: [SIGNER_A, SIGNER_B],
};

const proposal: MultisigProposalRecord = {
  call: {
    calldata: ["0x5", "0x0"],
    contractAddress: SIGNER_B,
    entrypoint: "transfer",
    salt: "0x0",
  },
  confirmations: 1,
  id: multisigProposalId(record.id, "0xabc") ?? "",
  multisigId: record.id,
  state: "pending",
  summary: "Send funds",
  txId: "0xabc",
};

const memoryKv = () => {
  const data = new Map<string, unknown>();
  return {
    store: {
      async get(key: string) {
        return data.get(key);
      },
      async remove(key: string) {
        data.delete(key);
      },
      async set(key: string, value: unknown) {
        data.set(key, value);
      },
    },
    data,
  };
};

describe("multisig store", () => {
  test("validates records and rejects tampered ids", () => {
    expect(isMultisigRecord(record)).toBe(true);
    expect(isMultisigRecord({ ...record, id: "SN_MAIN:0xdead" })).toBe(false);
    expect(isMultisigRecord({ ...record, quorum: 3 })).toBe(false);
    expect(isMultisigRecord({ ...record, extra: true })).toBe(false);
    expect(isMultisigProposalRecord(proposal)).toBe(true);
    expect(isMultisigProposalRecord({ ...proposal, state: "unknown" })).toBe(false);
    expect(isMultisigProposalRecord({ ...proposal, id: "other" })).toBe(false);
  });

  test("persists multisigs and proposals and reads them back newest-first", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    await registry.upsertMultisig(record);
    await registry.upsertProposal(proposal);
    expect(await registry.listMultisigs()).toEqual([record]);
    expect(await registry.listProposals()).toEqual([proposal]);
  });

  test("drops proposals whose multisig is not watched", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    await registry.upsertProposal(proposal);
    expect(await registry.listProposals()).toEqual([]);
  });

  test("removing a multisig removes its proposals", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    await registry.upsertMultisig(record);
    await registry.upsertProposal(proposal);
    await registry.removeMultisig(record.id);
    expect(await registry.listMultisigs()).toEqual([]);
    expect(await registry.listProposals()).toEqual([]);
  });

  test("filters invalid stored data instead of trusting it", async () => {
    const { store, data } = memoryKv();
    data.set(MULTISIG_STORE_KEY, {
      multisigs: [record, { ...record, quorum: "2" }],
      proposals: [proposal, { ...proposal, confirmations: -1 }],
    });
    const registry = createMultisigStore({ store });
    expect(await registry.listMultisigs()).toEqual([record]);
    expect(await registry.listProposals()).toEqual([proposal]);
  });

  test("caps stored multisigs at twenty", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    for (let index = 1; index <= 25; index += 1) {
      const address = `0x${index.toString(16)}00`;
      await registry.upsertMultisig({
        address,
        id: multisigId("SN_MAIN", address) ?? "",
        networkId: "SN_MAIN",
        quorum: 1,
        signers: [SIGNER_A],
      });
    }
    expect(await registry.listMultisigs()).toHaveLength(20);
  });
});
