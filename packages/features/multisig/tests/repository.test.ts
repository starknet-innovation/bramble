/**
 * Multisig registry invariants: record validation, deterministic ids, caps,
 * orphaned-proposal filtering, and remove cascades.
 */
import { describe, expect, test } from "bun:test";
import {
  createMultisigStore,
  isMultisigOperationRecord,
  isMultisigProposalRecord,
  isMultisigRecord,
  MULTISIG_STORE_KEY,
  type MultisigOperationRecord,
  type MultisigProposalRecord,
  type MultisigRecord,
  multisigId,
  multisigOperationId,
  multisigProposalId,
} from "@mc-wallet/multisig/repository";

const SIGNER_A = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const SIGNER_B = "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const ADDRESS = "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const OP_ACCOUNT_ID = "SN_MAIN:0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

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

const operation: MultisigOperationRecord = {
  accountId: OP_ACCOUNT_ID,
  id: multisigOperationId("deploy", "SN_MAIN", OP_ACCOUNT_ID, ADDRESS) ?? "",
  kind: "deploy",
  networkId: "SN_MAIN",
  target: ADDRESS,
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
    expect(isMultisigProposalRecord({ ...proposal, confirmedBySigner: true })).toBe(false);
    expect(
      isMultisigProposalRecord({
        ...proposal,
        confirmedBySigner: true,
        confirmedBySignerAddress: SIGNER_A,
        confirmedSignerAddresses: [SIGNER_A],
      }),
    ).toBe(true);
    expect(
      isMultisigProposalRecord({
        ...proposal,
        confirmedSignerAddresses: [SIGNER_A, `0x0${SIGNER_A.slice(2)}`],
      }),
    ).toBe(false);
    expect(isMultisigProposalRecord({ ...proposal, confirmedSignerAddresses: ["invalid"] })).toBe(
      false,
    );
    expect(isMultisigProposalRecord({ ...proposal, submitTransactionHash: "0x1234" })).toBe(true);
    expect(isMultisigProposalRecord({ ...proposal, submitTransactionHash: "not-a-hash" })).toBe(
      false,
    );
    expect(isMultisigProposalRecord({ ...proposal, state: "unknown" })).toBe(false);
    expect(isMultisigProposalRecord({ ...proposal, id: "other" })).toBe(false);
    expect(multisigProposalId("account-1", proposal.txId)).toBeNull();
    expect(isMultisigOperationRecord(operation)).toBe(true);
    expect(
      isMultisigOperationRecord({
        ...operation,
        id: multisigOperationId("confirm", "SN_MAIN", OP_ACCOUNT_ID, proposal.txId) ?? "",
        kind: "confirm",
        target: proposal.txId,
      }),
    ).toBe(true);
    expect(isMultisigOperationRecord({ ...operation, networkId: "SN_SEPOLIA" })).toBe(false);
    expect(isMultisigOperationRecord({ ...operation, id: "other" })).toBe(false);
  });

  test("claims operations atomically and persists their broadcast hash", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    expect(await registry.claimOperation(operation)).toBe("claimed");
    expect(await registry.claimOperation(operation)).toBe("exists");
    expect(await registry.listOperations()).toEqual([operation]);
    await registry.setOperationHash(operation.id, "0xabc");
    expect(await createMultisigStore({ store }).getOperation(operation.id)).toEqual({
      ...operation,
      transactionHash: "0xabc",
    });
    await registry.releaseOperation(operation.id);
    expect(await registry.getOperation(operation.id)).toBeNull();
  });

  test("claims proposal actions atomically across action kinds", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    const owner = multisigId("SN_MAIN", record.address) ?? "";
    const confirm: MultisigOperationRecord = {
      accountId: OP_ACCOUNT_ID,
      id: multisigOperationId("confirm", "SN_MAIN", OP_ACCOUNT_ID, proposal.txId, owner) ?? "",
      kind: "confirm",
      multisigId: owner,
      networkId: "SN_MAIN",
      target: proposal.txId,
    };
    const revoke: MultisigOperationRecord = {
      ...confirm,
      id: multisigOperationId("revoke", "SN_MAIN", OP_ACCOUNT_ID, proposal.txId, owner) ?? "",
      kind: "revoke",
    };

    expect(
      await Promise.all([
        registry.claimProposalOperation(confirm),
        registry.claimProposalOperation(revoke),
      ]),
    ).toEqual(["claimed", "exists"]);
    expect(await registry.listOperations()).toHaveLength(1);
  });

  test("persists multisigs and proposals and reads them back newest-first", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    await registry.upsertMultisig(record);
    await registry.upsertProposal(proposal);
    expect(await registry.listMultisigs()).toEqual([record]);
    expect(await registry.listProposals()).toEqual([proposal]);
  });

  test("keeps watched multisig order stable when chain refreshes update records", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    const secondAddress = "0x444";
    const second: MultisigRecord = {
      address: secondAddress,
      id: multisigId("SN_MAIN", secondAddress) ?? "",
      networkId: "SN_MAIN",
      quorum: 1,
      signers: [SIGNER_A],
    };
    await registry.upsertMultisig(record);
    await registry.upsertMultisig(second);
    expect((await registry.listMultisigs()).map((stored) => stored.id)).toEqual([
      second.id,
      record.id,
    ]);

    await registry.upsertMultisig({ ...record, name: "Updated treasury", quorum: 1 });
    const refreshed = await registry.listMultisigs();
    expect(refreshed.map((stored) => stored.id)).toEqual([second.id, record.id]);
    expect(refreshed[1]?.name).toBe("Updated treasury");
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

  const proposalVariant = (
    index: number,
    overrides: Partial<Pick<MultisigProposalRecord, "call" | "state">>,
  ): MultisigProposalRecord => {
    const txId = `0x${(index + 1).toString(16)}`;
    return {
      ...proposal,
      id: multisigProposalId(record.id, txId) ?? "",
      txId,
      ...overrides,
    };
  };

  test("evicts settled and tracked proposals before live ones with stored calls", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    await registry.upsertMultisig(record);

    // One live proposal whose stored call is the only copy able to execute
    // it, buried under 99 executed ones, then two more inserts over the cap.
    await registry.upsertProposal(proposalVariant(0, {}));
    for (let index = 1; index <= 99; index += 1) {
      await registry.upsertProposal(proposalVariant(index, { state: "executed" }));
    }
    await registry.upsertProposal(proposalVariant(100, { call: null }));
    await registry.upsertProposal(proposalVariant(101, {}));

    const proposals = await registry.listProposals();
    expect(proposals).toHaveLength(100);
    // The oldest entry survives because it is live and call-bearing; the
    // executed ones were evicted first.
    const states = new Map(proposals.map((stored) => [stored.txId, stored]));
    expect(states.get("0x1")?.state).toBe("pending");
    expect(states.get("0x66")?.call).not.toBeNull();
    expect(proposals.filter((stored) => stored.state === "executed")).toHaveLength(97);
  });

  test("evicts tracked-by-id proposals before call-bearing ones when none are settled", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    await registry.upsertMultisig(record);

    await registry.upsertProposal(proposalVariant(0, { call: null }));
    for (let index = 1; index <= 100; index += 1) {
      await registry.upsertProposal(proposalVariant(index, {}));
    }

    const proposals = await registry.listProposals();
    expect(proposals).toHaveLength(100);
    // The tracked-by-id proposal was the eviction casualty: its state is
    // recoverable by re-tracking, unlike a stored call.
    expect(proposals.every((stored) => stored.call !== null)).toBe(true);
  });
});
