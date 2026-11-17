/**
 * Issue 644 copy, end to end: when the background refuses to store a Braavos
 * Ledger account, the picker shows the reader's sentence, never the raw
 * diagnostic. The real background handler answers the real Ledger runtime
 * client, and the real onboarding controller renders what it threw. The panel
 * is made to misjudge the row as active (the bug the background guard exists
 * for), so the refusal is what reaches the reader.
 */
import { describe, expect, test } from "bun:test";
import { NETWORK_RETRY_MESSAGE } from "@bramble/core/network-error";
import type { LedgerAccountRef } from "@bramble/wallet-model/accounts";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { createLedgerOnboardController } from "../../../packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/onboard-session";
import { createLedgerRuntimeClient } from "../../../packages/presentation/wallet-ui/src/sidepanel/journeys/ledger/runtime-client";
import {
  candidateAccount,
  onboardHarness,
  tick,
} from "../../../packages/presentation/wallet-ui/tests/support/ledger-onboard-harness";
import {
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

type Chain = Pick<RuntimeRpc, "getDeploymentStatus" | "getTokenBalances">;

const pickerMessageAfterAdding = async (chain: Chain): Promise<string | undefined> => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const stored: string[] = [];
  const atScheme = (account: LedgerAccountRef): LedgerAccountRef => ({
    ...account,
    derivation: {
      ...account.derivation,
      eip2645application: "argentx",
      path: ledgerAccountPath(account.derivation.accountIndex, "argentx"),
    },
  });
  const handler = createMessageHandler(
    {
      ...createWallet(),
      async addLedgerAccount() {
        stored.push("braavos");
        return atScheme(candidateAccount(0, "braavos"));
      },
      async deriveLedgerAccounts() {
        return [atScheme(candidateAccount(0, "braavos"))];
      },
    },
    testExtension,
    { runtimeRpc: makeRuntimeRpc(chain), session },
  );
  const client = createLedgerRuntimeClient((message) => handler(message, extensionSender));
  const h = onboardHarness({
    create: async (account) => {
      await client.addLedgerAccount(
        account.networkId,
        account.derivation.accountIndex,
        account.publicKeyX,
        account.accountContractType,
        account.derivation.eip2645application,
      );
    },
    derive: (entries, accountContractType) =>
      Promise.resolve(
        entries.map((entry) => atScheme(candidateAccount(entry.accountIndex, accountContractType))),
      ),
    // The panel bug: index 0's Braavos row reads as active, so it self-selects.
    describe: (account) =>
      Promise.resolve(
        account.accountContractType === "braavos" && account.derivation.accountIndex === 0
          ? { balance: "1 STRK", deployed: true, funded: true }
          : { balance: "0 STRK", deployed: false, funded: false },
      ),
  });
  const controller = createLedgerOnboardController(h.deps);
  controller.showChooser();
  controller.choose("restore-ready-ledger");
  controller.connect();
  await tick();
  controller.addSelected();
  await tick();
  await tick();
  expect(stored).toEqual([]);
  const final = h.views.at(-1);
  return final?.kind === "picker" ? final.message : undefined;
};

describe("Braavos Ledger refusals reach the picker as copy", () => {
  test("a key with no Braavos account says so", async () => {
    const message = await pickerMessageAfterAdding({
      getDeploymentStatus: async () => false,
      getTokenBalances: async () => [],
    });
    expect(message).toBe("No Braavos account found for this key.");
  });

  test("an unreadable chain asks for a retry with the shared network sentence", async () => {
    const message = await pickerMessageAfterAdding({
      getDeploymentStatus: () => Promise.reject(new Error("rpc down")),
      getTokenBalances: () => Promise.reject(new Error("rpc down")),
    });
    expect(message).toBe(NETWORK_RETRY_MESSAGE);
    expect(message).toBe("Couldn't reach the network, try again");
  });
});
