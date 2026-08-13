/**
 * EXT-L05 / EXT-L06 — what one durable proposal-action claim covers.
 *
 * A MultisigComponent transaction id hashes `(call, salt)` and nothing else, so
 * two watched multisigs can hold the same id for two entirely different live
 * proposals. Claims are therefore namespaced by the owning contract: an action
 * on one must never wedge the other. Within one `(signer, multisig, txId)` the
 * claim is kind-blind instead — an execute and a revoke broadcast from the same
 * stale chain read contradict each other and both pay a fee, so the second one
 * waits until the first settles (and is admitted again once it fails). A
 * missing transaction hash is still kind-blind: it may mean the worker died
 * after broadcast but before bookkeeping, and treating that ambiguity as proof
 * that nothing reached the wire reopens the race.
 */
import { describe, expect, test } from "bun:test";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  multisigId,
  multisigOperationId,
  multisigProposalId,
} from "@mc-wallet/multisig/repository";
import { type ActivityLog, memoryActivityLog } from "@mc-wallet/transactions/activity";
import {
  HARNESS_MULTISIG,
  HARNESS_SUBMIT_HASH,
  HARNESS_TARGET,
  harnessAccount,
  harnessExtensionSender,
  harnessTxId,
  makeMultisigHarness,
} from "../support/multisig-harness";

const proposalCall = {
  calldata: ["0x5"],
  contractAddress: HARNESS_TARGET,
  entrypoint: "transfer",
  salt: "0x0",
} as const;

// One id, derived once: both fixtures below file the identical (call, salt)
// under it, which is exactly how two treasuries paying the same vendor the same
// amount collide — the propose form defaults the salt to 0x0.
const SHARED_TX_ID = harnessTxId(proposalCall);

const SECOND_MULTISIG = "0x333333333333333333333333333333333333333333333333333333333333333";

const watched = (address: string): MultisigRecord => ({
  address,
  id: multisigId("SN_MAIN", address) ?? "",
  networkId: "SN_MAIN",
  quorum: 2,
  signers: [harnessAccount.address, HARNESS_TARGET],
});

const proposalOn = (
  record: MultisigRecord,
  confirmedBySigner: boolean,
): MultisigProposalRecord => ({
  call: proposalCall,
  confirmations: 1,
  ...(confirmedBySigner
    ? { confirmedBySigner: true, confirmedBySignerAddress: harnessAccount.address }
    : {}),
  id: multisigProposalId(record.id, SHARED_TX_ID) ?? "",
  multisigId: record.id,
  state: "pending",
  summary: "Pay vendor",
  txId: SHARED_TX_ID,
});

const seed = async (options: {
  readonly activity?: ActivityLog;
  readonly addresses: readonly string[];
  readonly confirmedBySigner: boolean;
  readonly state?: "confirmed" | "pending";
}) => {
  const harness = makeMultisigHarness({
    ...(options.activity ? { activity: options.activity } : {}),
    multisigConfig: () => ({ quorum: 2, signers: [harnessAccount.address, HARNESS_TARGET] }),
    proposalStatus: () => ({
      confirmations: 1,
      confirmedBySigner: options.confirmedBySigner,
      state: options.state ?? "pending",
    }),
  });
  const records = options.addresses.map(watched);
  for (const record of records) {
    await harness.multisigStore.upsertMultisig(record);
    await harness.multisigStore.upsertProposal(proposalOn(record, options.confirmedBySigner));
  }
  return { ...harness, records };
};

// A claim written before broadcast, whose transaction hash never arrived: the
// RPC answered but `setOperationHash` failed, or the service worker was torn
// down in between. Nothing in the claim path can release it.
// `ownerId` undefined writes the legacy, un-namespaced key an upgrade inherits.
const orphanClaim = async (
  store: Awaited<ReturnType<typeof seed>>["multisigStore"],
  kind: "confirm" | "execute" | "revoke",
  ownerId?: string,
): Promise<void> => {
  const id = multisigOperationId(kind, "SN_MAIN", harnessAccount.id, SHARED_TX_ID, ownerId);
  expect(id).not.toBeNull();
  await store.claimOperation({
    accountId: harnessAccount.id,
    id: id ?? "",
    kind,
    ...(ownerId === undefined ? {} : { multisigId: ownerId }),
    networkId: "SN_MAIN",
    target: SHARED_TX_ID,
  });
};

describe("multisig proposal claim scope", () => {
  test("keys one signer's claim by the multisig contract as well as the id", () => {
    const first = multisigOperationId(
      "confirm",
      "SN_MAIN",
      harnessAccount.id,
      SHARED_TX_ID,
      multisigId("SN_MAIN", HARNESS_MULTISIG) ?? "",
    );
    const second = multisigOperationId(
      "confirm",
      "SN_MAIN",
      harnessAccount.id,
      SHARED_TX_ID,
      multisigId("SN_MAIN", SECOND_MULTISIG) ?? "",
    );

    expect(first).not.toBeNull();
    expect(first).not.toEqual(second);
    // A claim written before the namespace existed keeps its original key, so
    // an upgrade does not free a live claim by renaming it.
    expect(multisigOperationId("confirm", "SN_MAIN", harnessAccount.id, SHARED_TX_ID)).toEqual(
      `confirm:SN_MAIN:${harnessAccount.id}:${SHARED_TX_ID}`,
    );
  });

  test("confirming on one multisig does not block the same id on another", async () => {
    const { handler, invokeCalls, records } = await seed({
      addresses: [HARNESS_MULTISIG, SECOND_MULTISIG],
      confirmedBySigner: false,
    });

    for (const record of records) {
      await expect(
        handler(
          {
            mode: "confirm-only",
            proposalId: multisigProposalId(record.id, SHARED_TX_ID) ?? "",
            type: "wallet.confirmMultisigProposal",
          },
          harnessExtensionSender,
        ),
      ).resolves.toMatchObject({ ok: true });
    }

    expect(invokeCalls.flat()).toMatchObject([
      { contractAddress: HARNESS_MULTISIG, entrypoint: "confirm_transaction" },
      { contractAddress: SECOND_MULTISIG, entrypoint: "confirm_transaction" },
    ]);
  });

  test("an unmined action blocks the opposite action on the same proposal", async () => {
    const activity = memoryActivityLog(() => 1);
    const { handler, invokeCalls, records } = await seed({
      activity,
      addresses: [HARNESS_MULTISIG],
      confirmedBySigner: true,
      state: "confirmed",
    });
    const proposalId = multisigProposalId(records[0]?.id ?? "", SHARED_TX_ID) ?? "";

    await expect(
      handler({ proposalId, type: "wallet.executeMultisigProposal" }, harnessExtensionSender),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handler({ proposalId, type: "wallet.revokeMultisigConfirmation" }, harnessExtensionSender),
    ).resolves.toEqual({
      error: `this signer already has a proposal action in progress — wait for it to settle (${HARNESS_SUBMIT_HASH})`,
    });
    expect(invokeCalls.flat()).toMatchObject([{ entrypoint: "execute_transaction" }]);

    // Serializing must not wedge the signer: once the execute is known to have
    // failed, the opposite action is admitted again.
    await activity.updateStatuses(
      { [HARNESS_SUBMIT_HASH]: { status: "reverted" } },
      { accountId: records[0]?.id ?? "", networkId: "SN_MAIN" },
    );
    await expect(
      handler({ proposalId, type: "wallet.revokeMultisigConfirmation" }, harnessExtensionSender),
    ).resolves.toMatchObject({ ok: true });
    expect(invokeCalls.flat()).toMatchObject([
      { entrypoint: "execute_transaction" },
      { calldata: [SHARED_TX_ID], entrypoint: "revoke_confirmation" },
    ]);
  });

  test("a hashless claim blocks the opposite action because broadcast is ambiguous", async () => {
    const { handler, invokeCalls, multisigStore, records } = await seed({
      addresses: [HARNESS_MULTISIG],
      confirmedBySigner: true,
    });
    const ownerId = records[0]?.id ?? "";
    await orphanClaim(multisigStore, "confirm", ownerId);

    // A hashless claim is indistinguishable from a successful broadcast whose
    // bookkeeping write was interrupted. Fail closed rather than signing a
    // contradictory action from stale chain state.
    await expect(
      handler(
        {
          proposalId: multisigProposalId(ownerId, SHARED_TX_ID) ?? "",
          type: "wallet.revokeMultisigConfirmation",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error: "this signer already has a proposal action in progress — wait for it to settle",
    });
    expect(invokeCalls).toEqual([]);
  });

  test("a claim that never reached the wire still deduplicates its own kind", async () => {
    const { handler, invokeCalls, multisigStore, records } = await seed({
      addresses: [HARNESS_MULTISIG],
      confirmedBySigner: true,
    });
    const ownerId = records[0]?.id ?? "";
    // Legacy shape deliberately: an un-namespaced claim keys differently from
    // the one this action would write, so the store's own uniqueness check
    // cannot catch it and only the kind match here keeps the upgrade window
    // from broadcasting the same revocation twice.
    await orphanClaim(multisigStore, "revoke");

    // The double-click race the claim exists for: a second revoke may be racing
    // the first one's broadcast, so it waits with no hash to report.
    await expect(
      handler(
        {
          proposalId: multisigProposalId(ownerId, SHARED_TX_ID) ?? "",
          type: "wallet.revokeMultisigConfirmation",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error: "this signer already has a proposal action in progress — wait for it to settle",
    });
    expect(invokeCalls.flat()).toEqual([]);
  });

  test("an accepted confirmation can be retried after a fresh read proves it was revoked", async () => {
    const activity = memoryActivityLog(() => 1);
    const { handler, invokeCalls, records } = await seed({
      activity,
      addresses: [HARNESS_MULTISIG],
      confirmedBySigner: false,
    });
    const proposalId = multisigProposalId(records[0]?.id ?? "", SHARED_TX_ID) ?? "";

    await expect(
      handler(
        { mode: "confirm-only", proposalId, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    await activity.updateStatuses(
      { [HARNESS_SUBMIT_HASH]: { status: "accepted" } },
      { accountId: records[0]?.id ?? "", networkId: "SN_MAIN" },
    );

    await expect(
      handler(
        { mode: "confirm-only", proposalId, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(invokeCalls.flat()).toMatchObject([
      { entrypoint: "confirm_transaction" },
      { entrypoint: "confirm_transaction" },
    ]);
  });

  test("a settled inverse action does not strand the next action", async () => {
    const activity = memoryActivityLog(() => 1);
    const { handler, invokeCalls, records } = await seed({
      activity,
      addresses: [HARNESS_MULTISIG],
      confirmedBySigner: true,
      state: "confirmed",
    });
    const proposalId = multisigProposalId(records[0]?.id ?? "", SHARED_TX_ID) ?? "";

    await expect(
      handler({ proposalId, type: "wallet.executeMultisigProposal" }, harnessExtensionSender),
    ).resolves.toMatchObject({ ok: true });
    await activity.updateStatuses(
      { [HARNESS_SUBMIT_HASH]: { status: "accepted" } },
      { accountId: records[0]?.id ?? "", networkId: "SN_MAIN" },
    );

    await expect(
      handler({ proposalId, type: "wallet.revokeMultisigConfirmation" }, harnessExtensionSender),
    ).resolves.toMatchObject({ ok: true });
    expect(invokeCalls.flat()).toMatchObject([
      { entrypoint: "execute_transaction" },
      { entrypoint: "revoke_confirmation" },
    ]);
  });

  test("concurrent execute and revoke atomically admit exactly one broadcast", async () => {
    const { handler, invokeCalls, records } = await seed({
      addresses: [HARNESS_MULTISIG],
      confirmedBySigner: true,
      state: "confirmed",
    });
    const proposalId = multisigProposalId(records[0]?.id ?? "", SHARED_TX_ID) ?? "";

    const results = await Promise.all([
      handler({ proposalId, type: "wallet.executeMultisigProposal" }, harnessExtensionSender),
      handler({ proposalId, type: "wallet.revokeMultisigConfirmation" }, harnessExtensionSender),
    ]);

    expect(results.filter((result) => "ok" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result)).toEqual([
      { error: expect.stringContaining("proposal action in progress") },
    ]);
    expect(invokeCalls).toHaveLength(1);
    const entrypoint = (invokeCalls[0]?.[0] as { readonly entrypoint?: string } | undefined)
      ?.entrypoint;
    expect(entrypoint).toBeDefined();
    expect(["execute_transaction", "revoke_confirmation"]).toContain(entrypoint ?? "");
  });
});
