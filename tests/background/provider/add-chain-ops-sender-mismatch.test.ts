/**
 * Dapp add-chain sender gate: a well-formed wallet.addStarknetChain whose sender
 * origin does not match the claimed origin is rejected before any approval is
 * queued, closing the spoof where one page claims another's origin.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@mc-wallet/settings/preferences";
import { createMemoryStore } from "@mc-wallet/store/kv";
import {
  type AddChainOpsDeps,
  handleAddChainOps,
} from "../../../apps/extension/src/background/provider/add-chain-ops";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";

const ORIGIN = "https://dapp.example";

const deps = (): AddChainOpsDeps =>
  ({
    approvals: {} as AddChainOpsDeps["approvals"],
    extensionId: "extension-id",
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    waiters: {} as AddChainOpsDeps["waiters"],
  }) as AddChainOpsDeps;

const message = {
  chain: {
    chainId: "0x534e5f4b4154414e41",
    chainName: "Katana",
    id: "katana",
    rpcUrls: ["https://rpc.katana.example"],
  },
  origin: ORIGIN,
  type: "wallet.addStarknetChain" as const,
};

describe("handleAddChainOps sender gate", () => {
  test("rejects a request whose sender origin does not match the claimed origin", async () => {
    const spoofingSender: RuntimeSender = { id: "other", url: "https://evil.example/app" };
    const response = await handleAddChainOps(
      deps(),
      "wallet.addStarknetChain",
      message,
      spoofingSender,
    );
    expect(response).toEqual({ error: "sender origin mismatch" });
  });

  test("rejects a request with no sender at all", async () => {
    const response = await handleAddChainOps(deps(), "wallet.addStarknetChain", message, undefined);
    expect(response).toEqual({ error: "sender origin mismatch" });
  });
});
