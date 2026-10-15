/**
 * Shadow accounts screen checkpoints (issue 443, PR 5): the recorded scopes
 * from the vault, one scope after the user asked for balances, and a scope
 * recorded under an anonymizer the network no longer uses. The bindings run
 * against a fixture client, so no checkpoint reaches a network.
 */
import { bindShadowAccounts } from "@bramble/wallet-ui/lab";
import { walletDashboard } from "../runtime/scenario-dashboard";
import type { FrameContext, ScenarioCheckpoint } from "../runtime/types";

const ANONYMIZER = "0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7";
const scopes = [
  {
    anonymizer: ANONYMIZER,
    current: true,
    label: "Private Market",
    nonces: ["0x0", "0x9"],
    origin: "https://market.example",
  },
  {
    anonymizer: "0x2",
    current: false,
    label: "Old Market",
    nonces: ["0x1"],
    origin: "https://old.example",
  },
];

const fixtureWallet = {
  executePrivacyPreparation: async () => "0x5ee",
  loadShadowAccountBalances: async () => ({
    accounts: [
      {
        address: "0x6d9c1b8f0a3e47c2b5d18e9f04a7c3b6d2e1f09a8b7c6d5e4f3a2b1c0d9e8f7",
        balances: [
          {
            balance: "0x2faf080",
            formatted: "50",
            symbol: "USDC",
            tokenId:
              "SN_MAIN:USDC:0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
          },
        ],
        deployed: true,
        nonce: "0x9",
        recorded: true,
      },
    ],
    unlisted: [],
  }),
  loadShadowAccounts: async () => scopes,
  prepareShadowSweep: async () => {
    throw new Error("the lab fixture does not sweep");
  },
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const bind = async ({ app }: FrameContext, checkBalances: boolean): Promise<void> => {
  bindShadowAccounts({ app, wallet: fixtureWallet });
  await settle();
  if (checkBalances) {
    [...app.querySelectorAll("button")]
      .find((node) => node.textContent === "Check balances")
      ?.click();
    await settle();
  }
};

/** The Shadow accounts checkpoints, grouped with the privacy journey. */
export const shadowAccountCheckpoints: readonly ScenarioCheckpoint[] = [
  {
    content: () => walletDashboard({ view: "shadow-accounts" }),
    id: "shadow-accounts",
    label: "Shadow accounts",
    narrative:
      "Recorded scopes list from the vault alone; the network is read only when the user asks, and the screen says why.",
    prepare: (context) => bind(context, false),
    state: { network: "not read", scopes: 2 },
  },
  {
    content: () => walletDashboard({ view: "shadow-accounts" }),
    id: "shadow-accounts-balances",
    label: "Shadow account balances",
    narrative:
      "After the user asks, one scope lists its shadow accounts, what each holds, and a sweep.",
    prepare: (context) => bind(context, true),
    state: { network: "read on request", sweep: "offered" },
  },
];
