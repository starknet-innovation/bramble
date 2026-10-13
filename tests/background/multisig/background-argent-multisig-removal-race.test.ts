/**
 * A watched multisig removed while a list or refresh read is in flight stays
 * removed (Sherlock 225). Those reads run off the active-state lane and enrich
 * an address-only watch with the configuration they read; the write is
 * update-only, so it cannot re-create a record the user removed meanwhile.
 */
import { describe, expect, test } from "bun:test";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@bramble/starknet/account-contracts";
import {
  HARNESS_KEYS,
  HARNESS_MULTISIG_ID,
  makeMultisigHarness,
  harnessExtensionSender as sender,
} from "../../support/multisig-harness";

const liveConfig = {
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  signerGuids: HARNESS_KEYS.map(argentSignerGuid),
  threshold: 2,
};

// An address-only watch whose first on-chain config read is held open until
// the test releases it, as a slow RPC would.
const watchWithSlowFirstRead = async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const harness = await makeMultisigHarness({
    async getConfig() {
      reads += 1;
      if (reads === 1) await gate;
      return liveConfig;
    },
    watchedOnly: true,
  });
  return { harness, reads: () => reads, release };
};

const raceRemoval = async (read: Record<string, unknown>) => {
  const { harness, reads, release } = await watchWithSlowFirstRead();
  const pending = harness.handler(read, sender);
  while (reads() === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  const removed = await harness.handler(
    { multisigId: HARNESS_MULTISIG_ID, type: "wallet.removeMultisig" },
    sender,
  );
  release();
  await pending;
  return { harness, removed };
};

describe("a multisig removed while a read is in flight", () => {
  test("stays removed after a late wallet.multisigs read", async () => {
    const { harness, removed } = await raceRemoval({ type: "wallet.multisigs" });

    expect(removed).toEqual({ ok: true });
    expect(await harness.multisigStore.listMultisigs()).toEqual([]);
    const cached = (await harness.handler({ cached: true, type: "wallet.multisigs" }, sender)) as {
      readonly multisigs: readonly unknown[];
    };
    expect(cached.multisigs).toEqual([]);
  });

  test("stays removed after a late wallet.refreshMultisig read", async () => {
    const { harness, removed } = await raceRemoval({
      multisigId: HARNESS_MULTISIG_ID,
      type: "wallet.refreshMultisig",
    });

    expect(removed).toEqual({ ok: true });
    expect(await harness.multisigStore.listMultisigs()).toEqual([]);
  });

  test("is still enriched when nothing removes it", async () => {
    const { harness, release } = await watchWithSlowFirstRead();
    release();
    await harness.handler({ type: "wallet.multisigs" }, sender);

    const [record] = await harness.multisigStore.listMultisigs();
    expect(record?.currentConfig).toEqual({ signerPublicKeys: HARNESS_KEYS, threshold: 2 });
  });
});
