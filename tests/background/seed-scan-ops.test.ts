/**
 * The privileged recovery-phrase scan at the message boundary.
 *
 * A restored phrase rebuilds only HD index 0, so this walk is what lets a
 * restored wallet offer back the accounts it already had. These pin the boundary
 * properties rather than the walk itself (covered in tests/wallet): the network
 * and passphrase come from wallet state and never from the message, a locked
 * wallet is refused before any read, only public metadata comes back, an account
 * the wallet already holds is marked rather than hidden, and a deployed candidate
 * costs no balance reads.
 *
 * No node, no vault, no device: the RPC and vault service are stubs.
 */
import { describe, expect, test } from "bun:test";
import { handleSeedScanOps, type SeedScanOpsDeps } from "../../src/background/seed-scan-ops";
import { createUnlockSession } from "../../src/background/session";
import type { SeedAccountCandidate } from "../../src/wallet/seed-account-scan";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const vaultPassphrase = "correct horse battery staple";

const candidate = (accountIndex: number, address: string): SeedAccountCandidate => ({
  account: {
    address,
    classHash: "0x111111",
    derivation: { accountIndex, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
    publicKeyX: "0xabc",
    publicKeyY: "0xdef",
  },
  accountIndex,
  deployed: true,
  funded: false,
});

const harness = (
  options: {
    readonly balances?: readonly { readonly balance: string }[];
    readonly deployed?: boolean;
    readonly existingIds?: readonly string[];
    readonly locked?: boolean;
    readonly scan?: SeedScanOpsDeps["wallet"]["scanSeedAccounts"];
  } = {},
) => {
  const probedForBalances: string[] = [];
  const scanInputs: { readonly networkId: string }[] = [];
  const session = createUnlockSession();
  if (!options.locked) {
    session.unlock(vaultPassphrase);
  }
  const deps = {
    preferencesStore: {
      async read() {
        return { activeNetworkId: "SN_MAIN" as const, rpcOverrides: {} };
      },
    },
    runtimeRpc: makeRuntimeRpc({
      async getDeploymentStatus() {
        return options.deployed ?? true;
      },
      async getTokenBalances({ accountAddress }) {
        probedForBalances.push(accountAddress);
        return (options.balances ?? []).map((entry) => ({
          address: "0x1",
          balance: entry.balance,
          decimals: 18,
          formatted: "0",
          id: "SN_MAIN:ETH:0x1",
          name: "Ether",
          networkId: "SN_MAIN" as const,
          symbol: "ETH",
        }));
      },
    }),
    session,
    wallet: {
      async readVault() {
        return { accounts: (options.existingIds ?? []).map((id) => ({ id })) };
      },
      // Stands in for the walk, which is covered in tests/wallet. It reports the
      // probe's own verdict rather than a fixed one, so a case here exercises the
      // real chain: chain reads → qualification → response.
      scanSeedAccounts:
        options.scan ??
        (async (input: {
          readonly networkId: string;
          readonly probe: (address: string) => Promise<{
            readonly deployed: boolean;
            readonly funded: boolean;
          }>;
        }) => {
          scanInputs.push({ networkId: input.networkId });
          return [{ ...candidate(0, "0xaaa"), ...(await input.probe("0xaaa")) }];
        }),
    },
  } as unknown as SeedScanOpsDeps;
  return { deps, probedForBalances, scanInputs };
};

const scan = (deps: SeedScanOpsDeps) =>
  handleSeedScanOps(deps, "wallet.scanSeedAccounts", { type: "wallet.scanSeedAccounts" });

describe("recovery-phrase account scan", () => {
  test("returns null for another message type", async () => {
    const { deps } = harness();

    expect(await handleSeedScanOps(deps, "wallet.status", { type: "wallet.status" })).toBeNull();
  });

  test("refuses a message carrying anything beyond its type", async () => {
    const { deps } = harness();

    // The network and passphrase are taken from wallet state, so a caller
    // supplying either must be refused rather than quietly ignored.
    expect(
      await handleSeedScanOps(deps, "wallet.scanSeedAccounts", {
        networkId: "SN_SEPOLIA",
        type: "wallet.scanSeedAccounts",
      }),
    ).toEqual({ error: "invalid seed scan request" });
  });

  test("refuses a locked wallet before reading anything", async () => {
    const { deps, scanInputs } = harness({ locked: true });

    expect(await scan(deps)).toEqual({ error: "wallet locked" });
    expect(scanInputs).toEqual([]);
  });

  test("scans the active network and returns public metadata only", async () => {
    const { deps, scanInputs } = harness();

    const response = await scan(deps);

    expect(scanInputs).toEqual([{ networkId: "SN_MAIN" }]);
    expect(response).toEqual({
      candidates: [
        { accountIndex: 0, address: "0xaaa", alreadyAdded: false, deployed: true, funded: false },
      ],
      ok: true,
    });
  });

  test("marks a candidate this wallet already holds instead of hiding it", async () => {
    const { deps } = harness({ existingIds: ["SN_MAIN:0xaaa"] });

    const response = await scan(deps);

    // Hiding it would read as "the scan lost my account"; the picker needs to
    // show it as already present.
    expect(response).toMatchObject({ candidates: [{ alreadyAdded: true }] });
  });

  test("reads no balances for a deployed candidate", async () => {
    const { deps, probedForBalances } = harness({ deployed: true });

    await scan(deps);

    // Deployment alone qualifies, so a balance read per token would be pure cost.
    expect(probedForBalances).toEqual([]);
  });

  test("qualifies an undeployed candidate only on a non-zero balance", async () => {
    const empty = harness({ balances: [{ balance: "0" }], deployed: false });
    const funded = harness({ balances: [{ balance: "5" }], deployed: false });

    expect(await scan(empty.deps)).toMatchObject({ candidates: [{ funded: false }] });
    expect(empty.probedForBalances).toEqual(["0xaaa"]);
    expect(await scan(funded.deps)).toMatchObject({ candidates: [{ funded: true }] });
  });

  test("surfaces a failed scan instead of reporting no accounts", async () => {
    const { deps } = harness({
      scan: () => Promise.reject(new Error("node unreachable")),
    });

    expect(await scan(deps)).toEqual({ error: "node unreachable" });
  });

  test("fails closed when the vault service is unavailable", async () => {
    const { deps } = harness();
    const withoutScan = { ...deps, wallet: { ...deps.wallet, scanSeedAccounts: undefined } };

    expect(await scan(withoutScan as unknown as SeedScanOpsDeps)).toEqual({
      error: "wallet unavailable",
    });
  });
});
