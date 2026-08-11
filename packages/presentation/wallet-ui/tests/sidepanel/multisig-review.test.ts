/**
 * Independent Multisig review tests cover strict public-package parsing,
 * decoded token effects, and offline QR payload capacity.
 */
import { describe, expect, test } from "bun:test";
import type {
  MultisigProposalCall,
  MultisigProposalRecord,
  MultisigRecord,
} from "@mc-wallet/multisig/repository";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { account } from "@mc-wallet/testkit/sidepanel";
import {
  multisigProposalEffect,
  multisigProposalQrPayload,
  parseMultisigReviewPackage,
  serializeMultisigReviewPackage,
} from "../../src/sidepanel/multisig-model";
import { qrMatrix } from "../../src/sidepanel/qr";

const multisig: MultisigRecord = {
  address: "0x333333333333333333333333333333333333333333333333333333333333333",
  id: "SN_MAIN:0x333333333333333333333333333333333333333333333333333333333333333",
  name: "Treasury",
  networkId: "SN_MAIN",
  quorum: 1,
  signers: ["0x123"],
};

const preferences = defaultWalletPreferences();
const token = preferences.tokens[0];
if (!token) throw new Error("Default token fixture missing");

const proposalCall: MultisigProposalCall = {
  calldata: ["0x123", "0x1", "0x0"],
  contractAddress: token.address,
  entrypoint: "transfer",
  salt: "0x0",
};

const proposal: MultisigProposalRecord = {
  call: proposalCall,
  confirmations: 0,
  confirmedBySigner: false,
  confirmedBySignerAddress: "0x123",
  id: `${multisig.id}:0xabc`,
  multisigId: multisig.id,
  state: "pending",
  summary: "Pay contributor",
  txId: "0xabc",
};

describe("Multisig independent review", () => {
  test("round-trips the strict secret-free package", () => {
    const serialized = serializeMultisigReviewPackage(multisig, proposal);
    expect(parseMultisigReviewPackage(serialized)).toEqual({
      kind: "mc-wallet-multisig-proposal",
      multisig,
      proposal,
      version: 1,
    });
    expect(parseMultisigReviewPackage(serialized.replace('"version":1', '"version":2'))).toBeNull();
    expect(parseMultisigReviewPackage('{"kind":"mc-wallet-multisig-proposal"}')).toBeNull();
  });

  test("labels a tracked token and decodes its transfer effect", () => {
    const effect = multisigProposalEffect(proposalCall, account, preferences);
    expect(effect.targetKind).toBe("Tracked ERC-20");
    expect(effect.targetLabel).toBe(token.symbol);
    expect(effect.summary).toContain(token.symbol);
    expect(effect.summary).toContain("Send");
  });

  test("keeps a full felt proposal id inside the bundled QR capacity", () => {
    const full = {
      ...proposal,
      txId: `0x${"a".repeat(64)}`,
    };
    const payload = multisigProposalQrPayload(full);
    expect(payload).toContain(full.txId);
    expect(qrMatrix(payload).length).toBeGreaterThan(0);
  });
});
