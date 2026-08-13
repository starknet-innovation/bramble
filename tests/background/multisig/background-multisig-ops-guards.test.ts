/**
 * Invalid-input and not-found branches of the registry multisig handlers,
 * driven through the shared message handler with malformed payloads and unknown
 * / cross-network multisig ids, plus direct unit calls for the two helpers whose
 * guard branches the handler wiring never reaches (the missing-RPC-surface throw
 * and the no-submit-hash short-circuit). Mirrors tests/background/multisig/background-multisig-messages.test.ts
 * and tests/support/multisig-harness.ts.
 */
import { describe, expect, test } from "bun:test";
import type { MultisigProposalRecord, MultisigRecord } from "@mc-wallet/multisig/repository";
import type { ProposeMultisigInput } from "../../../apps/extension/src/background/multisig/multisig-inputs";
import type { MultisigOpsDeps } from "../../../apps/extension/src/background/multisig/multisig-ops";
import {
  buildMultisigProposalRecord,
  defaultSummary,
  isProposalSubmitPending,
  multisigRpc,
} from "../../../apps/extension/src/background/multisig/multisig-ops";
import {
  HARNESS_MULTISIG,
  HARNESS_PROPOSED_TX_ID,
  HARNESS_TARGET,
  harnessAccount,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

describe("registry multisig handler guards", () => {
  test("rejects a multisigs list request carrying extra fields", async () => {
    const { handler } = makeMultisigHarness();
    await expect(
      handler({ debug: true, type: "wallet.multisigs" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "invalid multisigs request" });
  });

  test("rejects a malformed add-multisig request", async () => {
    const { handler } = makeMultisigHarness();
    await expect(handler({ type: "wallet.addMultisig" }, harnessExtensionSender)).resolves.toEqual({
      error: "invalid add multisig request",
    });
  });

  test("rejects an id-less remove request", async () => {
    const { handler } = makeMultisigHarness();
    await expect(
      handler({ type: "wallet.removeMultisig" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "invalid remove multisig request" });
  });

  test("rejects an id-less refresh request", async () => {
    const { handler } = makeMultisigHarness();
    await expect(
      handler({ type: "wallet.refreshMultisig" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "invalid refresh multisig request" });
  });
  test("rejects an id-less multisig balance request", async () => {
    const { handler } = makeMultisigHarness();
    await expect(
      handler({ type: "wallet.multisigBalances" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "invalid multisig balances request" });
  });

  test("rejects a malformed track-proposal request", async () => {
    const { handler } = makeMultisigHarness();
    await expect(
      handler({ type: "wallet.trackMultisigProposal" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "invalid track proposal request" });
  });

  test("reports 'multisig not found' when refreshing an unknown id", async () => {
    const { handler } = makeMultisigHarness();
    await expect(
      handler(
        { id: "SN_MAIN:0xdead:0xbeef", type: "wallet.refreshMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "multisig not found" });
  });

  test("returns a safe configuration diagnostic when the chain read fails", async () => {
    let fail = false;
    const { handler } = makeMultisigHarness({
      multisigConfig() {
        if (fail) {
          throw new Error("raw provider detail must not cross the boundary");
        }
        return { quorum: 1, signers: [harnessAccount.address] };
      },
    });
    const added = (await handler(
      { address: HARNESS_MULTISIG, type: "wallet.addMultisig" },
      harnessExtensionSender,
    )) as { multisig: { id: string } };
    fail = true;

    await expect(
      handler({ id: added.multisig.id, type: "wallet.refreshMultisig" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "multisig configuration unavailable" });
  });

  test("asks the user to switch networks for a multisig on another network", async () => {
    const { handler, multisigStore } = makeMultisigHarness();
    // A watched multisig that lives on Sepolia while the active account is on
    // mainnet: multisigContext finds it but refuses to act cross-network.
    const foreign: MultisigRecord = {
      address: "0xabc",
      id: "SN_SEPOLIA:0xabc",
      networkId: "SN_SEPOLIA",
      quorum: 1,
      signers: ["0xabc"],
    };
    await multisigStore.upsertMultisig(foreign);

    await expect(
      handler({ id: foreign.id, type: "wallet.refreshMultisig" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "switch to the multisig's network first" });

    // The track handler resolves through the same context helper, so it reports
    // the same guidance for a cross-network id.
    await expect(
      handler(
        { multisigId: foreign.id, txId: "0xdef", type: "wallet.trackMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "switch to the multisig's network first" });
  });
});

describe("multisig helper guards", () => {
  test("multisigRpc throws when the RPC surface is not wired", () => {
    const deps = { runtimeRpc: { multisig: undefined } } as unknown as MultisigOpsDeps;
    expect(() => multisigRpc(deps)).toThrow("multisig operations unavailable");
  });

  test("isProposalSubmitPending is false when the proposal has no submit hash", async () => {
    // No submitTransactionHash: the activity list is never consulted, so a bare
    // deps object suffices and the helper short-circuits to false.
    const deps = {} as unknown as MultisigOpsDeps;
    const proposal: MultisigProposalRecord = {
      call: null,
      confirmations: 0,
      id: "SN_MAIN:0x1:0x2",
      multisigId: "SN_MAIN:0x1",
      state: "pending",
      summary: "no hash",
      txId: "0x2",
    };
    expect(await isProposalSubmitPending(deps, proposal)).toBe(false);
  });

  test("isProposalSubmitPending fails closed when activity cannot be read", async () => {
    const deps = {
      activity: {
        async list() {
          throw new Error("storage unavailable");
        },
      },
    } as unknown as MultisigOpsDeps;
    const proposal: MultisigProposalRecord = {
      call: null,
      confirmations: 0,
      id: "SN_MAIN:0x1:0x2",
      multisigId: "SN_MAIN:0x1",
      state: "pending",
      submitTransactionHash: "0x3",
      summary: "pending submit",
      txId: "0x2",
    };
    expect(await isProposalSubmitPending(deps, proposal)).toBe(true);
  });
});

describe("multisig proposal builders", () => {
  const baseInput: ProposeMultisigInput = {
    calldata: ["0x5", "0x0"],
    entrypoint: "transfer",
    multisigId: "SN_MAIN:0xabc",
    salt: "0x0",
    to: HARNESS_TARGET,
  };

  test("defaultSummary keeps a caller-supplied summary verbatim", () => {
    expect(defaultSummary({ ...baseInput, summary: "Pay vendor" })).toBe("Pay vendor");
  });

  test("defaultSummary falls back to the entrypoint plus a shortened address", () => {
    const summary = defaultSummary(baseInput);
    expect(summary.startsWith("transfer on ")).toBe(true);
    // The fallback shortens the target address, so the ellipsis marker appears
    // and the full 65-character address does not.
    expect(summary).toContain("…");
    expect(summary).not.toContain(HARNESS_TARGET);
  });

  // Filed under the id `baseInput`'s call really hashes to: a record whose call
  // and id disagree is refused by the offline binding before any confirm,
  // revoke, or execute, so no fixture should model one as ordinary output.
  test("buildMultisigProposalRecord assembles an optimistic pending record", () => {
    const record = buildMultisigProposalRecord({
      id: `SN_MAIN:0xabc:${HARNESS_PROPOSED_TX_ID}`,
      input: baseInput,
      multisigId: "SN_MAIN:0xabc",
      submitTransactionHash: "0xhash",
      summary: "Pay vendor",
      txId: HARNESS_PROPOSED_TX_ID,
    });
    expect(record).toEqual({
      call: {
        calldata: ["0x5", "0x0"],
        contractAddress: HARNESS_TARGET,
        entrypoint: "transfer",
        salt: "0x0",
      },
      confirmations: 0,
      id: `SN_MAIN:0xabc:${HARNESS_PROPOSED_TX_ID}`,
      multisigId: "SN_MAIN:0xabc",
      state: "pending",
      submitTransactionHash: "0xhash",
      summary: "Pay vendor",
      txId: HARNESS_PROPOSED_TX_ID,
    });
  });
});
