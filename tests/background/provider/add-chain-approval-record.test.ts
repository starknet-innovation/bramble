/**
 * The record an approved `wallet_addStarknetChain` hands the preferences store
 * (Sherlock audit 153). The store compacts too, so this checks the approval
 * layer on its own: it passes only the chain id, trimmed labels and the first
 * RPC URL, whatever lists the request carried.
 */
import { describe, expect, test } from "bun:test";
import type { WalletPreferences, WalletPreferencesStore } from "@bramble/settings/preferences";
import type { CustomNetwork } from "@bramble/wallet-model/custom-network";
import { executeAddChainApproval } from "../../../apps/extension/src/background/provider/add-chain-ops";

const capturingStore = () => {
  const added: CustomNetwork[] = [];
  const preferencesStore = {
    addCustomNetwork: async (network: CustomNetwork) => {
      added.push(network);
      return {} as WalletPreferences;
    },
  } as unknown as WalletPreferencesStore;
  return { added, preferencesStore };
};

describe("executeAddChainApproval", () => {
  test("hands the store one RPC URL and no explorer or icon lists", async () => {
    const { added, preferencesStore } = capturingStore();
    await expect(
      executeAddChainApproval(
        { preferencesStore },
        {
          chain: {
            blockExplorerUrls: ["https://explorer.katana.example"],
            chainId: "0x534e5f4b4154414e41",
            chainName: " Katana ",
            iconUrls: ["https://icons.katana.example/a.png"],
            id: " katana ",
            rpcUrls: ["https://rpc.katana.example", "https://rpc2.katana.example"],
          },
        },
      ),
    ).resolves.toEqual({ added: true, ok: true });
    expect(added).toEqual([
      {
        chainId: "0x534e5f4b4154414e41",
        id: "katana",
        name: "Katana",
        rpcUrls: ["https://rpc.katana.example"],
      },
    ]);
  });

  test("hands the store no RPC list when the request had none", async () => {
    const { added, preferencesStore } = capturingStore();
    await executeAddChainApproval(
      { preferencesStore },
      { chain: { chainId: "0x534e5f4b4154414e41", chainName: "Katana", id: "katana" } },
    );
    expect(added).toEqual([{ chainId: "0x534e5f4b4154414e41", id: "katana", name: "Katana" }]);
  });
});
