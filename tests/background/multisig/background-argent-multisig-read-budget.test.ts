/** Argent multisig registry reads keep their multi-call RPC fan-out bounded. */
import { expect, test } from "bun:test";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@bramble/starknet/account-contracts";
import {
  HARNESS_KEYS,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

test("bounds watched-account authority reads", async () => {
  let activeReads = 0;
  let maximumReads = 0;
  const harness = await makeMultisigHarness({
    async getConfig() {
      activeReads += 1;
      maximumReads = Math.max(maximumReads, activeReads);
      await Promise.resolve();
      activeReads -= 1;
      return {
        classHash: ARGENT_MULTISIG_CONTRACT.classHash,
        signerGuids: HARNESS_KEYS.map(argentSignerGuid),
        threshold: 2,
      };
    },
    watchedOnly: true,
  });
  for (let index = 1; index <= 8; index += 1) {
    await harness.multisigStore.upsertMultisig({
      accountContractType: "argent-multisig",
      address: `0x${(index + 100).toString(16)}`,
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      id: `SN_MAIN:0x${(index + 100).toString(16)}`,
      networkId: "SN_MAIN",
    });
  }

  await harness.handler({ type: "wallet.multisigs" }, harnessExtensionSender);
  expect(maximumReads).toBe(4);
});
