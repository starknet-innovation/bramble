/**
 * Late-failure notices for multisig activity (Sherlock 221).
 *
 * Multisig transactions and deployments are journaled under the multisig's own
 * id, not the signing account's. `wallet.transactionAlerts` drains every
 * stored multisig on the active network as well as the active account, so a
 * reverted multisig transfer or deployment raises its alert like any other.
 */
import { expect, test } from "bun:test";
import { ARGENT_MULTISIG_CONTRACT } from "@bramble/starknet/account-contracts";
import { harnessExtensionSender, makeMultisigHarness } from "../../support/multisig-harness";

const storeMultisig = async (
  harness: Awaited<ReturnType<typeof makeMultisigHarness>>,
  networkId: "SN_MAIN" | "SN_SEPOLIA",
  address: string,
): Promise<string> => {
  const id = `${networkId}:${address}`;
  await harness.multisigStore.upsertMultisig({
    accountContractType: "argent-multisig",
    address,
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    id,
    networkId,
  });
  return id;
};

const failedEntry = async (
  harness: Awaited<ReturnType<typeof makeMultisigHarness>>,
  accountId: string,
  networkId: "SN_MAIN" | "SN_SEPOLIA",
  hash: string,
  summary: string,
): Promise<void> => {
  await harness.activity.record({ accountId, hash, kind: "invoke", networkId, summary });
  await harness.activity.updateStatuses(
    { [hash]: { failureNotice: "pending", status: "reverted" } },
    { accountId, networkId },
  );
};

const alerts = async (
  harness: Awaited<ReturnType<typeof makeMultisigHarness>>,
): Promise<readonly string[]> =>
  (
    (await harness.handler({ type: "wallet.transactionAlerts" }, harnessExtensionSender)) as {
      readonly alerts: readonly string[];
    }
  ).alerts;

test("drains a reverted multisig transaction's notice exactly once", async () => {
  const harness = await makeMultisigHarness();
  const multisig = await storeMultisig(harness, "SN_MAIN", "0x5a1");
  await failedEntry(harness, multisig, "SN_MAIN", "0xa11", "Multisig pays 1 ETH");

  const first = await alerts(harness);
  expect(first).toHaveLength(1);
  expect(first[0]).toContain('"Multisig pays 1 ETH"');
  expect(await alerts(harness)).toEqual([]);
});

test("leaves a multisig on another network for that network", async () => {
  const harness = await makeMultisigHarness();
  const sepolia = await storeMultisig(harness, "SN_SEPOLIA", "0x5e9");
  await failedEntry(harness, sepolia, "SN_SEPOLIA", "0xa12", "Sepolia multisig send");

  expect(await alerts(harness)).toEqual([]);
  expect((await harness.activity.list())[0]?.failureNotice).toBe("pending");
});
