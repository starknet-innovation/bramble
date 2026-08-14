/**
 * Strict privileged message grammar for Argent multisig.
 */
import { describe, expect, test } from "bun:test";
import {
  readAddMultisigInput,
  readPrepareIntentInput,
  readRemoveMultisigInput,
} from "../../../apps/extension/src/background/multisig/multisig-inputs";
import { HARNESS_KEYS, HARNESS_MULTISIG_ID, harnessAccountA } from "../../support/multisig-harness";

describe("Argent multisig message inputs", () => {
  test("requires explicit network, signer, current config, address, and bounded calls", () => {
    const add = {
      address: HARNESS_MULTISIG_ID.split(":")[1],
      networkId: "SN_MAIN",
      signerAccountId: harnessAccountA.id,
      signerPublicKeys: HARNESS_KEYS,
      threshold: 2,
      type: "wallet.addMultisig",
    };
    expect(readAddMultisigInput(add)).not.toBeNull();
    expect(readAddMultisigInput({ ...add, extra: true })).toBeNull();
    expect(readAddMultisigInput({ ...add, signerAccountId: undefined })).toBeNull();
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
});
