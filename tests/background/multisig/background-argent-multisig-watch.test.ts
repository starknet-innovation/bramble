/** Address-only discovery and local signer matching for watched Argent multisigs. */
import { describe, expect, test } from "bun:test";
import {
  ARGENT_MULTISIG_CONTRACT,
  argentSignerGuid,
  normalizeArgentMultisigConfig,
} from "@bramble/starknet/account-contracts";
import {
  HARNESS_KEYS,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

describe("Argent multisig watch", () => {
  test("resolves a supported participant account on the active network", async () => {
    const harness = await makeMultisigHarness({
      resolveSignerAccount: () => ({
        accountContractType: "argent",
        address: "0x123",
        publicKeyX: "0x456",
      }),
    });
    await expect(
      harness.handler(
        { address: "0x123", networkId: "SN_MAIN", type: "wallet.resolveMultisigSigner" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      ok: true,
      signer: { accountContractType: "argent", address: "0x123", publicKeyX: "0x456" },
    });
    await expect(
      harness.handler(
        { address: "0x123", networkId: "SN_SEPOLIA", type: "wallet.resolveMultisigSigner" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "switch to the participant account network first" });
  });

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

  test("completes an address-only watch only with every fresh on-chain public signer", async () => {
    const knownSigner = HARNESS_KEYS[0];
    if (!knownSigner) throw new Error("missing multisig signer fixture");
    const publicConfig = normalizeArgentMultisigConfig({
      signerPublicKeys: [knownSigner, "0x999"],
      threshold: 1,
    });
    const harness = await makeMultisigHarness({
      getConfig: () => ({
        classHash: ARGENT_MULTISIG_CONTRACT.classHash,
        signerGuids: publicConfig.signerPublicKeys.map(argentSignerGuid),
        threshold: publicConfig.threshold,
      }),
    });
    const input = { address: "0xabe", networkId: "SN_MAIN", type: "wallet.addMultisig" } as const;
    await harness.handler(input, harnessExtensionSender);

    await expect(
      harness.handler(
        { ...input, signerPublicKeys: [knownSigner, "0x998"] },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error: "A supplied public key is not a current Stark signer for this multisig",
    });
    await expect(
      harness.handler(
        { ...input, signerPublicKeys: [knownSigner, "0x999"] },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({
      multisig: { record: { currentConfig: publicConfig } },
      ok: true,
    });
  });

  test("recovers a complete deployed signer set from verified linked events", async () => {
    const publicConfig = normalizeArgentMultisigConfig({
      signerPublicKeys: ["0x888", "0x999"],
      threshold: 2,
    });
    const harness = await makeMultisigHarness({
      getConfig: () => ({
        classHash: ARGENT_MULTISIG_CONTRACT.classHash,
        signerGuids: publicConfig.signerPublicKeys.map(argentSignerGuid),
        threshold: publicConfig.threshold,
      }),
      getSignerPublicKeys: () => ({
        signerPublicKeys: publicConfig.signerPublicKeys,
        unsupportedSigners: [],
      }),
    });

    await expect(
      harness.handler(
        { address: "0xabf", networkId: "SN_MAIN", type: "wallet.addMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({
      multisig: { record: { currentConfig: publicConfig } },
      ok: true,
    });
  });

  test("keeps supported non-Stark authorities watch-only without requesting Stark keys", async () => {
    const harness = await makeMultisigHarness({
      getConfig: () => ({
        classHash: ARGENT_MULTISIG_CONTRACT.classHash,
        signerGuids: ["0x123"],
        threshold: 1,
      }),
      getSignerPublicKeys: () => ({
        signerPublicKeys: [],
        unsupportedSigners: [{ guid: "0x123", type: "webauthn" }],
      }),
    });

    await expect(
      harness.handler(
        { address: "0xac0", networkId: "SN_MAIN", type: "wallet.addMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({
      multisig: {
        authorityStatus: "unsupported-signers",
        unsupportedSigners: [{ guid: "0x123", type: "webauthn" }],
      },
      ok: true,
    });
  });
});
