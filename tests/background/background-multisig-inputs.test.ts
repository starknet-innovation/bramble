/**
 * Pure multisig message-input parsers. Complements the handler-level suites by
 * calling the parsers directly with both accepted and rejected payloads, so the
 * optional-field success paths and the null-returning guard branches are all
 * exercised. Mirrors tests/background/background-message-inputs.test.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  readAddMultisigInput,
  readConfirmMultisigProposalInput,
  readDeployMultisigInput,
  readMultisigIdInput,
  readMultisigProposalActionInput,
  readProposeMultisigInput,
  readTrackMultisigProposalInput,
} from "../../src/background/multisig-inputs";

const ADDR = "0x111111111111111111111111111111111111111111111111111111111111111";
const TARGET = "0x222222222222222222222222222222222222222222222222222222222222222";
const SIGNER_ACCOUNT_ID = `SN_MAIN:${ADDR}`;

describe("readAddMultisigInput", () => {
  test("accepts an add request carrying an optional name", () => {
    expect(
      readAddMultisigInput({ address: ADDR, name: "Treasury", type: "wallet.addMultisig" }),
    ).toEqual({ address: ADDR, name: "Treasury" });
  });

  test("accepts an add request without a name", () => {
    expect(readAddMultisigInput({ address: ADDR, type: "wallet.addMultisig" })).toEqual({
      address: ADDR,
    });
  });

  test("rejects a zero address, an empty name, and unknown fields", () => {
    expect(readAddMultisigInput({ address: "0x0", type: "wallet.addMultisig" })).toBeNull();
    expect(
      readAddMultisigInput({ address: ADDR, name: "", type: "wallet.addMultisig" }),
    ).toBeNull();
    expect(
      readAddMultisigInput({ address: ADDR, extra: 1, type: "wallet.addMultisig" }),
    ).toBeNull();
    expect(readAddMultisigInput({ type: "wallet.addMultisig" })).toBeNull();
    expect(readAddMultisigInput("nope")).toBeNull();
  });
});

describe("readMultisigIdInput", () => {
  test("accepts a well-formed id for the requested type", () => {
    expect(
      readMultisigIdInput(
        { id: "SN_MAIN:0x1:0x2", type: "wallet.removeMultisig" },
        "wallet.removeMultisig",
      ),
    ).toEqual({
      id: "SN_MAIN:0x1:0x2",
    });
  });

  test("rejects an empty id, a mismatched type, and extra fields", () => {
    expect(
      readMultisigIdInput({ id: "", type: "wallet.refreshMultisig" }, "wallet.refreshMultisig"),
    ).toBeNull();
    expect(
      readMultisigIdInput({ id: "x", type: "wallet.removeMultisig" }, "wallet.refreshMultisig"),
    ).toBeNull();
    expect(
      readMultisigIdInput(
        { id: "x", debug: true, type: "wallet.refreshMultisig" },
        "wallet.refreshMultisig",
      ),
    ).toBeNull();
  });
});

describe("readProposeMultisigInput", () => {
  test("accepts a proposal with an optional summary and defaults the salt", () => {
    expect(
      readProposeMultisigInput({
        calldata: ["0x5", "0x0"],
        entrypoint: "transfer",
        multisigId: "SN_MAIN:0x1",
        signerAccountId: SIGNER_ACCOUNT_ID,
        summary: "Pay vendor",
        to: TARGET,
        type: "wallet.proposeMultisigTx",
      }),
    ).toEqual({
      calldata: ["0x5", "0x0"],
      entrypoint: "transfer",
      multisigId: "SN_MAIN:0x1",
      salt: "0x0",
      signerAccountId: SIGNER_ACCOUNT_ID,
      summary: "Pay vendor",
      to: TARGET,
    });
  });

  test("accepts a proposal without a summary, carrying an explicit salt", () => {
    expect(
      readProposeMultisigInput({
        calldata: [],
        entrypoint: "approve",
        multisigId: "SN_MAIN:0x1",
        salt: "0x7",
        to: TARGET,
        type: "wallet.proposeMultisigTx",
      }),
    ).toEqual({
      calldata: [],
      entrypoint: "approve",
      multisigId: "SN_MAIN:0x1",
      salt: "0x7",
      to: TARGET,
    });
  });

  test("rejects a bad entrypoint, a zero target, non-felt calldata, and a bad salt", () => {
    const base = {
      calldata: ["0x5"],
      entrypoint: "transfer",
      multisigId: "SN_MAIN:0x1",
      to: TARGET,
      type: "wallet.proposeMultisigTx" as const,
    };
    expect(readProposeMultisigInput({ ...base, entrypoint: "Bad!" })).toBeNull();
    expect(readProposeMultisigInput({ ...base, to: "0x0" })).toBeNull();
    expect(readProposeMultisigInput({ ...base, calldata: ["not-a-felt"] })).toBeNull();
    expect(readProposeMultisigInput({ ...base, salt: "not-a-felt" })).toBeNull();
    expect(readProposeMultisigInput({ ...base, summary: "x".repeat(200) })).toBeNull();
    expect(readProposeMultisigInput({ ...base, signerAccountId: "bad" })).toBeNull();
  });
});

describe("readConfirmMultisigProposalInput", () => {
  test("accepts each explicit mode with signer and acknowledgement", () => {
    expect(
      readConfirmMultisigProposalInput(
        {
          mode: "confirm-and-execute",
          proposalId: "SN_MAIN:0x1:0x2",
          signerAccountId: SIGNER_ACCOUNT_ID,
          type: "wallet.confirmMultisigProposal",
          untrackedVerified: true,
        },
        "wallet.confirmMultisigProposal",
      ),
    ).toEqual({
      mode: "confirm-and-execute",
      proposalId: "SN_MAIN:0x1:0x2",
      signerAccountId: SIGNER_ACCOUNT_ID,
      untrackedVerified: true,
    });
    expect(
      readConfirmMultisigProposalInput(
        {
          mode: "confirm-only",
          proposalId: "SN_MAIN:0x1:0x2",
          signerAccountId: SIGNER_ACCOUNT_ID,
          type: "wallet.prepareMultisigConfirmation",
        },
        "wallet.prepareMultisigConfirmation",
      ),
    ).toEqual({
      mode: "confirm-only",
      proposalId: "SN_MAIN:0x1:0x2",
      signerAccountId: SIGNER_ACCOUNT_ID,
    });
  });

  test("rejects absent/unknown modes, mismatched types, and malformed optional fields", () => {
    expect(
      readConfirmMultisigProposalInput(
        { proposalId: "x", type: "wallet.confirmMultisigProposal" },
        "wallet.confirmMultisigProposal",
      ),
    ).toBeNull();
    expect(
      readConfirmMultisigProposalInput(
        { mode: "both", proposalId: "x", type: "wallet.confirmMultisigProposal" },
        "wallet.confirmMultisigProposal",
      ),
    ).toBeNull();
    expect(
      readConfirmMultisigProposalInput(
        { mode: "confirm-only", proposalId: "x", type: "wallet.prepareMultisigConfirmation" },
        "wallet.confirmMultisigProposal",
      ),
    ).toBeNull();
    expect(
      readConfirmMultisigProposalInput(
        {
          mode: "confirm-only",
          proposalId: "x",
          type: "wallet.confirmMultisigProposal",
          untrackedVerified: false,
        },
        "wallet.confirmMultisigProposal",
      ),
    ).toBeNull();
    expect(
      readConfirmMultisigProposalInput(
        {
          mode: "confirm-only",
          proposalId: "x",
          signerAccountId: "bad",
          type: "wallet.confirmMultisigProposal",
        },
        "wallet.confirmMultisigProposal",
      ),
    ).toBeNull();
  });
});

describe("readMultisigProposalActionInput", () => {
  test("accepts execute and revoke inputs", () => {
    expect(
      readMultisigProposalActionInput(
        { proposalId: "SN_MAIN:0x1:0x2", type: "wallet.executeMultisigProposal" },
        "wallet.executeMultisigProposal",
      ),
    ).toEqual({ proposalId: "SN_MAIN:0x1:0x2" });
    expect(
      readMultisigProposalActionInput(
        {
          proposalId: "SN_MAIN:0x1:0x2",
          signerAccountId: SIGNER_ACCOUNT_ID,
          type: "wallet.revokeMultisigConfirmation",
          untrackedVerified: true,
        },
        "wallet.revokeMultisigConfirmation",
      ),
    ).toEqual({
      proposalId: "SN_MAIN:0x1:0x2",
      signerAccountId: SIGNER_ACCOUNT_ID,
      untrackedVerified: true,
    });
  });

  test("rejects confirmation-only fields and malformed acknowledgements", () => {
    expect(
      readMultisigProposalActionInput(
        { mode: "confirm-only", proposalId: "x", type: "wallet.revokeMultisigConfirmation" },
        "wallet.revokeMultisigConfirmation",
      ),
    ).toBeNull();
    expect(
      readMultisigProposalActionInput(
        { proposalId: "x", type: "wallet.revokeMultisigConfirmation", untrackedVerified: "yes" },
        "wallet.revokeMultisigConfirmation",
      ),
    ).toBeNull();
  });
});

describe("readTrackMultisigProposalInput", () => {
  test("accepts a track request with and without a summary", () => {
    expect(
      readTrackMultisigProposalInput({
        multisigId: "SN_MAIN:0x1",
        summary: "Shared",
        txId: "0xabc",
        type: "wallet.trackMultisigProposal",
      }),
    ).toEqual({ multisigId: "SN_MAIN:0x1", summary: "Shared", txId: "0xabc" });
    expect(
      readTrackMultisigProposalInput({
        call: {
          calldata: ["0x1"],
          contractAddress: TARGET,
          entrypoint: "transfer",
          salt: "0x2",
        },
        multisigId: "SN_MAIN:0x1",
        txId: "0xabc",
        type: "wallet.trackMultisigProposal",
      }),
    ).toEqual({
      call: {
        calldata: ["0x1"],
        contractAddress: TARGET,
        entrypoint: "transfer",
        salt: "0x2",
      },
      multisigId: "SN_MAIN:0x1",
      txId: "0xabc",
    });
  });

  test("rejects a non-felt txId and unknown fields", () => {
    expect(
      readTrackMultisigProposalInput({
        multisigId: "SN_MAIN:0x1",
        txId: "not-a-felt",
        type: "wallet.trackMultisigProposal",
      }),
    ).toBeNull();
    expect(
      readTrackMultisigProposalInput({
        call: {
          calldata: ["not-a-felt"],
          contractAddress: TARGET,
          entrypoint: "transfer",
          salt: "0x1",
        },
        multisigId: "SN_MAIN:0x1",
        txId: "0xabc",
        type: "wallet.trackMultisigProposal",
      }),
    ).toBeNull();
    expect(
      readTrackMultisigProposalInput({
        multisigId: "SN_MAIN:0x1",
        type: "wallet.trackMultisigProposal",
      }),
    ).toBeNull();
  });
});

describe("readDeployMultisigInput", () => {
  test("accepts a deploy request and defaults the salt", () => {
    expect(
      readDeployMultisigInput({
        quorum: 1,
        signers: [ADDR],
        type: "wallet.deployMultisig",
      }),
    ).toEqual({ quorum: 1, salt: "0x0", signers: [ADDR] });
  });

  test("rejects out-of-range quorums, empty/zero signers, and unknown fields", () => {
    expect(
      readDeployMultisigInput({ quorum: 2, signers: [ADDR], type: "wallet.deployMultisig" }),
    ).toBeNull();
    expect(
      readDeployMultisigInput({ quorum: 0, signers: [ADDR], type: "wallet.deployMultisig" }),
    ).toBeNull();
    expect(
      readDeployMultisigInput({ quorum: 1, signers: [], type: "wallet.deployMultisig" }),
    ).toBeNull();
    expect(
      readDeployMultisigInput({ quorum: 1, signers: ["0x0"], type: "wallet.deployMultisig" }),
    ).toBeNull();
    expect(
      readDeployMultisigInput({
        name: "x",
        quorum: 1,
        signers: [ADDR],
        type: "wallet.deployMultisig",
      }),
    ).toBeNull();
  });
});
