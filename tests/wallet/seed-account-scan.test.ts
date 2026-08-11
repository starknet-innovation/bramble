/**
 * Finding the accounts a restored recovery phrase already has on chain.
 *
 * Importing a phrase rebuilds only HD index 0, so a wallet that had used several
 * accounts came back looking empty. These pin the walk's contract: it reports a
 * position that is deployed OR funded, it keeps going across a gap rather than
 * stopping at the first unused position, it stops before probing a node twenty
 * times for the common single-account phrase, and an unreachable node fails
 * loudly instead of reading as "this phrase has no accounts".
 *
 * Chain answers come from a fixed probe — no RPC, no node, no device.
 */
import { describe, expect, test } from "bun:test";
import { deriveAccountRef } from "../../src/wallet/accounts";
import {
  SEED_SCAN_GAP_LIMIT,
  SEED_SCAN_MAX_INDEX,
  type SeedScanProbeResult,
  scanSeedAccounts,
} from "../../src/wallet/seed-account-scan";
import { fakeKms } from "../support/fake-kms";

const mnemonic = "test test test test test test test test test test test junk";

// The shared fake returns one constant keypair for every derivation, which would
// collapse all twenty HD positions onto a single address and make an
// index-sensitive walk untestable. Vary the key by account index so each
// position has its own address, exactly as real derivation does.
const indexedKms = () => {
  const base = fakeKms();
  return {
    ...base,
    async deriveStarknetKeypair(_mnemonic: string, _addressIndex: number, accountIndex: number) {
      return {
        privateKey: `0x${(0x123456 + accountIndex).toString(16)}`,
        publicKeyX: `0x${(0xabc + accountIndex).toString(16)}`,
        publicKeyY: `0x${(0xdef + accountIndex).toString(16)}`,
      };
    },
  };
};

// Answers by HD index rather than by address, so a case reads as the on-chain
// shape it models. Records every probed address so the walk's extent is visible.
const probeFor = (
  qualifying: Readonly<Record<number, SeedScanProbeResult>>,
  addressIndexes: Map<string, number>,
  probed: string[],
) => {
  return async (address: string): Promise<SeedScanProbeResult> => {
    probed.push(address);
    const index = addressIndexes.get(address);
    return (
      (index === undefined ? undefined : qualifying[index]) ?? { deployed: false, funded: false }
    );
  };
};

const addressesByIndex = async (
  kms: ReturnType<typeof indexedKms>,
): Promise<Map<string, number>> => {
  const map = new Map<string, number>();
  for (let index = 0; index <= SEED_SCAN_MAX_INDEX; index += 1) {
    const account = await deriveAccountRef(kms, {
      accountIndex: index,
      mnemonic,
      networkId: "SN_MAIN",
    });
    map.set(account.address, index);
  }
  return map;
};

const runScan = async (qualifying: Readonly<Record<number, SeedScanProbeResult>>) => {
  const kms = indexedKms();
  const probed: string[] = [];
  const found = await scanSeedAccounts(kms, mnemonic, {
    networkId: "SN_MAIN",
    probe: probeFor(qualifying, await addressesByIndex(kms), probed),
  });
  return { found: found.map((candidate) => candidate.accountIndex), probeCount: probed.length };
};

const deployed: SeedScanProbeResult = { deployed: true, funded: false };
const funded: SeedScanProbeResult = { deployed: false, funded: true };

describe("scanning a restored phrase for its on-chain accounts", () => {
  test("reports a position that is deployed, and one that only holds funds", async () => {
    const result = await runScan({ 0: deployed, 1: funded });

    expect(result.found).toEqual([0, 1]);
  });

  test("keeps walking across a gap of unused positions", async () => {
    // The case the gap limit exists for: a wallet that used 0, 3 and 7 and
    // abandoned everything between. Stopping at the first empty position would
    // report only account 0 and silently lose the other two.
    const result = await runScan({ 0: deployed, 3: deployed, 7: funded });

    expect(result.found).toEqual([0, 3, 7]);
  });

  test("stops after the gap limit rather than probing every position", async () => {
    const result = await runScan({ 0: deployed });

    expect(result.found).toEqual([0]);
    // Index 0 plus exactly the gap limit's worth of empty positions.
    expect(result.probeCount).toBe(1 + SEED_SCAN_GAP_LIMIT);
  });

  test("reports nothing for a phrase that was never used, without a full walk", async () => {
    const result = await runScan({});

    expect(result.found).toEqual([]);
    expect(result.probeCount).toBe(SEED_SCAN_GAP_LIMIT);
  });

  test("never probes past the bound, however many positions qualify", async () => {
    const everyIndex = Object.fromEntries(
      Array.from({ length: SEED_SCAN_MAX_INDEX + 1 }, (_value, index) => [index, deployed]),
    );
    const result = await runScan(everyIndex);

    expect(result.found).toHaveLength(SEED_SCAN_MAX_INDEX + 1);
    expect(result.probeCount).toBe(SEED_SCAN_MAX_INDEX + 1);
  });

  test("an unreachable node fails the scan instead of reporting an empty wallet", async () => {
    const kms = indexedKms();

    // Reporting "no accounts" because a node was down would invite the user to
    // conclude their accounts are gone.
    await expect(
      scanSeedAccounts(kms, mnemonic, {
        networkId: "SN_MAIN",
        probe: () => Promise.reject(new Error("node unreachable")),
      }),
    ).rejects.toThrow("node unreachable");
  });

  test("an empty phrase has no positions to walk", async () => {
    const kms = indexedKms();

    await expect(
      scanSeedAccounts(kms, "   ", { networkId: "SN_MAIN", probe: async () => deployed }),
    ).rejects.toThrow("No recovery phrase stored for this wallet");
  });
});
