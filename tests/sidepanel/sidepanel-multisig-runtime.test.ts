/**
 * Background-to-sidepanel multisig trust boundary: every client request shape,
 * success guard, and malformed-response fallback is exercised without loading
 * the extension entrypoint.
 */
import { describe, expect, test } from "bun:test";
import {
  isMultisigClassStatusResponse,
  isMultisigDeployResponse,
  isMultisigProposalResponse,
  isMultisigResponse,
  isMultisigsResponse,
  isOkResponse,
} from "../../src/popup/multisig-responses";
import { createMultisigClient } from "../../src/sidepanel/multisig-runtime";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  multisigId,
  multisigProposalId,
} from "../../src/storage/multisig-store";
import { account } from "../support/runtime-client-fixtures";

const address = "0x333333333333333333333333333333333333333333333333333333333333333";
const multisig: MultisigRecord = {
  address,
  id: multisigId("SN_MAIN", address) ?? "",
  networkId: "SN_MAIN",
  quorum: 1,
  signers: [account.address],
};
const proposal: MultisigProposalRecord = {
  call: null,
  confirmations: 0,
  confirmedBySigner: false,
  confirmedBySignerAddress: account.address,
  id: multisigProposalId(multisig.id, "0xabc") ?? "",
  multisigId: multisig.id,
  state: "pending",
  summary: "Shared proposal",
  txId: "0xabc",
};
const importedCall = {
  calldata: ["0x1"],
  contractAddress: address,
  entrypoint: "transfer",
  salt: "0x0",
} as const;

const responses: Readonly<Record<string, unknown>> = {
  "wallet.addMultisig": { multisig, ok: true },
  "wallet.confirmMultisigProposal": { ok: true, transactionHash: "0x123" },
  "wallet.declareMultisigClass": { ok: true, transactionHash: "0x123" },
  "wallet.deployMultisig": { address, ok: true, transactionHash: "0x123" },
  "wallet.executeMultisigProposal": { ok: true, transactionHash: "0x123" },
  "wallet.multisigClassStatus": { declarationPending: false, declared: true, ok: true },
  "wallet.multisigBalances": {
    accountId: multisig.id,
    balances: [],
    networkId: "SN_MAIN",
    ok: true,
  },
  "wallet.multisigs": { multisigs: [multisig], ok: true, proposals: [proposal] },
  "wallet.proposeMultisigTx": {
    ok: true,
    proposal,
    transactionHash: "0x123",
  },
  "wallet.refreshMultisig": { multisig, ok: true, proposals: [proposal] },
  "wallet.removeMultisig": { ok: true },
  "wallet.revokeMultisigConfirmation": { ok: true, transactionHash: "0x123" },
  "wallet.trackMultisigProposal": { ok: true, proposal },
};

describe("multisig response guards", () => {
  test("accepts exact responses and rejects extra or malformed fields", () => {
    expect(isMultisigsResponse(responses["wallet.multisigs"])).toBe(true);
    expect(isMultisigResponse(responses["wallet.addMultisig"])).toBe(true);
    expect(isMultisigProposalResponse(responses["wallet.proposeMultisigTx"])).toBe(true);
    expect(isMultisigClassStatusResponse(responses["wallet.multisigClassStatus"])).toBe(true);
    expect(isMultisigDeployResponse(responses["wallet.deployMultisig"])).toBe(true);
    expect(isOkResponse(responses["wallet.removeMultisig"])).toBe(true);

    expect(isMultisigsResponse({ multisigs: [], ok: true, proposals: [], debug: true })).toBe(
      false,
    );
    expect(isMultisigResponse({ multisig: { ...multisig, quorum: 0 }, ok: true })).toBe(false);
    expect(isMultisigProposalResponse({ ok: true, proposal, transactionHash: "bad" })).toBe(false);
    expect(isMultisigClassStatusResponse({ declared: "yes", ok: true })).toBe(false);
    expect(
      isMultisigClassStatusResponse({
        declarationPending: true,
        declared: false,
        ok: true,
        transactionHash: "0x123",
      }),
    ).toBe(true);
    expect(
      isMultisigClassStatusResponse({
        declarationPending: true,
        declared: true,
        ok: true,
      }),
    ).toBe(false);
    expect(isMultisigDeployResponse({ address: "bad", ok: true, transactionHash: "0x1" })).toBe(
      false,
    );
    expect(isOkResponse({ ok: true, extra: true })).toBe(false);
  });
});

describe("createMultisigClient", () => {
  test("shapes every request and accepts only guarded replies", async () => {
    const sent: unknown[] = [];
    const client = createMultisigClient({
      async sendMessage(message) {
        sent.push(message);
        const type =
          typeof message === "object" && message !== null && "type" in message
            ? String(message.type)
            : "";
        return responses[type];
      },
    });

    await client.addMultisig(address, "Treasury");
    expect(await client.confirmProposal(proposal.id, true)).toBe("0x123");
    expect(await client.declareClass()).toBe("0x123");
    expect(await client.deployMultisig([account.address], 1, "0x0")).toEqual({
      address,
      ok: true,
      transactionHash: "0x123",
    });
    expect(await client.executeProposal(proposal.id)).toBe("0x123");
    expect(await client.loadClassStatus()).toEqual({
      declarationPending: false,
      declared: true,
    });
    expect(await client.loadBalances(multisig.id)).toEqual({ balances: [] });
    expect(await client.loadMultisigs()).toEqual({
      multisigs: [multisig],
      proposals: [proposal],
    });
    expect(
      await client.proposeTransaction({
        calldata: ["0x1"],
        entrypoint: "transfer",
        multisigId: multisig.id,
        salt: "0x0",
        summary: "Pay",
        to: account.address,
      }),
    ).toBe("0x123");
    await client.refreshMultisig(multisig.id);
    await client.removeMultisig(multisig.id);
    expect(await client.revokeConfirmation(proposal.id, true)).toBe("0x123");
    await client.trackProposal(multisig.id, proposal.txId, "Shared", importedCall);

    expect(sent).toContainEqual({
      address,
      name: "Treasury",
      type: "wallet.addMultisig",
    });
    expect(sent).toContainEqual({
      proposalId: proposal.id,
      type: "wallet.confirmMultisigProposal",
      untrackedVerified: true,
    });
    expect(sent).toContainEqual({
      quorum: 1,
      salt: "0x0",
      signers: [account.address],
      type: "wallet.deployMultisig",
    });
    expect(sent).toContainEqual({ id: multisig.id, type: "wallet.refreshMultisig" });
    expect(sent).toContainEqual({ id: multisig.id, type: "wallet.multisigBalances" });
    expect(sent).toContainEqual({
      call: importedCall,
      multisigId: multisig.id,
      summary: "Shared",
      txId: proposal.txId,
      type: "wallet.trackMultisigProposal",
    });
  });

  test("reports list/status errors without replacing them with empty success", async () => {
    const malformed = createMultisigClient({
      async sendMessage() {
        return { ok: true };
      },
    });
    expect(await malformed.loadMultisigs()).toBe("error");
    expect(await malformed.loadBalances(multisig.id)).toEqual({
      error: "multisig balances unavailable",
    });
    expect(await malformed.loadClassStatus()).toBe("error");

    const rejected = createMultisigClient({
      async sendMessage() {
        throw new Error("runtime unavailable");
      },
    });
    expect(await rejected.loadMultisigs()).toBe("error");
    await expect(rejected.addMultisig(address, "")).rejects.toThrow("runtime unavailable");
  });
});
