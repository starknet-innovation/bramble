/**
 * `enrichMultisig` replaces a stored record but never adds one, so a read that
 * enriches a watch off the active-state lane cannot re-create a record the
 * user removed meanwhile (Sherlock 225).
 */
import { describe, expect, test } from "bun:test";
import { type ArgentMultisigRecord, memoryMultisigStore } from "@bramble/multisig/repository";
import {
  ARGENT_MULTISIG_CONTRACT,
  argentMultisigAddress,
  argentSignerGuid,
} from "@bramble/starknet/account-contracts";
import { ec } from "starknet";

const PUBLIC_A = `0x${ec.starkCurve.getStarkKey("0x123").replace(/^0x/, "")}`;
const PUBLIC_B = `0x${ec.starkCurve.getStarkKey("0x456").replace(/^0x/, "")}`;
const CONFIG = {
  signerPublicKeys: [PUBLIC_A, PUBLIC_B].sort((left, right) =>
    BigInt(argentSignerGuid(left)) < BigInt(argentSignerGuid(right)) ? -1 : 1,
  ),
  threshold: 2,
};
const ADDRESS = argentMultisigAddress(CONFIG, "0x0");

const addressOnly: ArgentMultisigRecord = {
  accountContractType: "argent-multisig",
  address: ADDRESS,
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  id: `SN_MAIN:${ADDRESS}`,
  networkId: "SN_MAIN",
};
const enriched: ArgentMultisigRecord = { ...addressOnly, currentConfig: CONFIG };

describe("enrichMultisig", () => {
  test("refuses a record that is not stored, and adds nothing", async () => {
    const registry = memoryMultisigStore();
    expect(await registry.enrichMultisig(enriched)).toBe("invalid");
    expect(await registry.listMultisigs()).toEqual([]);
  });

  test("enriches a stored address-only watch like upsertMultisig", async () => {
    const registry = memoryMultisigStore();
    expect(await registry.upsertMultisig(addressOnly)).toBe("stored");
    expect(await registry.enrichMultisig(enriched)).toBe("stored");
    expect(await registry.listMultisigs()).toEqual([enriched]);
  });

  test("refuses once it has lost authorization", async () => {
    const registry = memoryMultisigStore();
    await registry.upsertMultisig(addressOnly);
    expect(await registry.enrichMultisig(enriched, () => false)).toBe("unauthorized");
    expect(await registry.listMultisigs()).toEqual([addressOnly]);
  });
});
