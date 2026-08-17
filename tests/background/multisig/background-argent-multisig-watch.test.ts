/** Address-only discovery and local signer matching for watched Argent multisigs. */
import { describe, expect, test } from "bun:test";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import {
  HARNESS_KEYS,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

describe("Argent multisig watch", () => {
  test("records only a complete locally known signer set", async () => {
    const knownSigner = HARNESS_KEYS[0];
    if (!knownSigner) throw new Error("missing multisig signer fixture");
    const complete = await makeMultisigHarness();
    await expect(
      complete.handler(
        { address: "0xabc", networkId: "SN_MAIN", type: "wallet.addMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({
      multisig: {
        config: { threshold: 2 },
        record: { currentConfig: { signerPublicKeys: HARNESS_KEYS, threshold: 2 } },
      },
      ok: true,
    });

    const partial = await makeMultisigHarness({
      getConfig: () => ({
        classHash: ARGENT_MULTISIG_CONTRACT.classHash,
        signerGuids: ["0x1", argentSignerGuid(knownSigner)],
        threshold: 1,
      }),
    });
    await expect(
      partial.handler(
        { address: "0xabd", networkId: "SN_MAIN", type: "wallet.addMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({
      multisig: { config: { threshold: 1 }, record: { address: "0xabd" } },
      ok: true,
    });
    expect(
      (await partial.multisigStore.listMultisigs()).find((record) => record.address === "0xabd")
        ?.currentConfig,
    ).toBeUndefined();
  });
});
