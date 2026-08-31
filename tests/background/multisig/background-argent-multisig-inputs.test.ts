/**
 * Strict privileged message grammar for Argent multisig.
 */
import { describe, expect, test } from "bun:test";
import {
  readAddMultisigInput,
  readMultisigIdInput,
  readPrepareIntentInput,
  readRemoveIntentInput,
  readRemoveMultisigInput,
  readResolveMultisigSignerInput,
} from "../../../apps/extension/src/background/multisig/multisig-inputs";
import { HARNESS_MULTISIG_ID, harnessAccountA } from "../../support/multisig-harness";

describe("Argent multisig message inputs", () => {
  test("accepts address-only multisig discovery and bounded calls", () => {
    const address = HARNESS_MULTISIG_ID.split(":")[1];
    if (!address) throw new Error("missing multisig address fixture");
    const add = {
      address,
      networkId: "SN_MAIN",
      type: "wallet.addMultisig",
    };
    expect(readAddMultisigInput(add)).not.toBeNull();
    expect(readAddMultisigInput({ ...add, signerPublicKeys: ["0x123", "0x456"] })).toEqual({
      address: add.address,
      networkId: "SN_MAIN",
      signerPublicKeys: ["0x123", "0x456"],
    });
    expect(readAddMultisigInput({ ...add, signerPublicKeys: [] })).toBeNull();
    expect(readAddMultisigInput({ ...add, extra: true })).toBeNull();
    expect(readAddMultisigInput({ ...add, signerAccountId: harnessAccountA.id })).toBeNull();
    const prepare = {
      calls: [{ calldata: [], contractAddress: "0x222", entrypoint: "transfer" }],
      multisigId: HARNESS_MULTISIG_ID,
      type: "wallet.prepareArgentMultisigIntent",
    };
    expect(readPrepareIntentInput(prepare)).not.toBeNull();
    expect(readPrepareIntentInput({ ...prepare, summary: "untrusted caller prose" })).toBeNull();
    expect(
      readPrepareIntentInput({
        calls: [],
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      }),
    ).toBeNull();
  });

  test("requires explicit acknowledgement before terminal history removal", () => {
    expect(
      readRemoveMultisigInput({ multisigId: HARNESS_MULTISIG_ID, type: "wallet.removeMultisig" }),
    ).toEqual({ confirmHistoryRemoval: false, multisigId: HARNESS_MULTISIG_ID });
    expect(
      readRemoveMultisigInput({
        confirmHistoryRemoval: false,
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.removeMultisig",
      }),
    ).toBeNull();
  });

  test("accepts only one exact bounded intent deletion", () => {
    const input = { intentId: "SN_MAIN:0x123:0x456", type: "wallet.removeArgentMultisigIntent" };
    expect(readRemoveIntentInput(input)).toEqual({ intentId: input.intentId });
    expect(readRemoveIntentInput({ ...input, extra: true })).toBeNull();
    expect(readRemoveIntentInput({ ...input, intentId: "" })).toBeNull();
  });

  test("accepts only an exact participant address lookup", () => {
    const input = {
      address: "0x123",
      networkId: "SN_MAIN",
      type: "wallet.resolveMultisigSigner",
    };
    expect(readResolveMultisigSignerInput(input)).toEqual({
      address: "0x123",
      networkId: "SN_MAIN",
    });
    expect(readResolveMultisigSignerInput({ ...input, address: "0x0123" })).toBeNull();
    expect(readResolveMultisigSignerInput({ ...input, extra: true })).toBeNull();
  });

  test("scopes secure co-signer sync to one exact multisig", () => {
    const input = {
      multisigId: HARNESS_MULTISIG_ID,
      type: "wallet.syncArgentMultisigIntents" as const,
    };
    expect(readMultisigIdInput(input, input.type)).toEqual({ multisigId: HARNESS_MULTISIG_ID });
    expect(readMultisigIdInput({ type: input.type }, input.type)).toBeNull();
    expect(readMultisigIdInput({ ...input, extra: true }, input.type)).toBeNull();
  });
});
