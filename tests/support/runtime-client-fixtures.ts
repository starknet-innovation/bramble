/**
 * Shared fixtures for the side-panel runtime message-client suites. The wrapper
 * tests are split across two files to stay under the file-size ceiling; the
 * canonical valid response shapes (each passing its isX guard) and the runtime
 * capture helper live here so both halves drive identical envelopes.
 */
import { createSidepanelRuntime } from "../../src/sidepanel/runtime";
import { defaultWalletPreferences } from "../../src/storage/preferences-store";

export const APPROVAL_ID = "123e4567-e89b-42d3-a456-426614174000";
const ON_CHAIN = "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3";

// A compact guard-valid account used by response-wrapper tests. It remains
// separate from the rendering fixture so these envelopes stay easy to read.
export const account = {
  address: "0x123",
  classHash: "0xabc",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_SEPOLIA:0x123",
  networkId: "SN_SEPOLIA" as const,
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};

// --- canonical valid response fixtures (each passes its isX guard) ---

export const createAccountResponse = { account, ok: true as const };

export const walletStatus = {
  accountCount: 1,
  activeAccountId: account.id,
  accounts: [account],
  hasVault: true,
  locked: false,
  network: "Starknet Sepolia",
  networkId: "SN_SEPOLIA",
  networks: [{ id: "SN_SEPOLIA", name: "Starknet Sepolia" }],
  ready: true,
};

export const tokenBalance = {
  address: "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  balance: "100",
  decimals: 6,
  formatted: "0.0001",
  id: "SN_SEPOLIA:USDC:0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  name: "USD Coin",
  networkId: "SN_SEPOLIA",
  symbol: "USDC",
};

export const balancesResponse = {
  accountId: account.id,
  balances: [tokenBalance],
  networkId: "SN_SEPOLIA",
  ok: true as const,
};

export const transferResponse = { ok: true as const, transactionHash: "0x123" };

export const deploymentStatusResponse = {
  accountId: account.id,
  deployed: true,
  ok: true as const,
};

export const classHashResponse = {
  accountId: account.id,
  ok: true as const,
  verification: { onChainClassHash: ON_CHAIN, status: "verified" as const },
};

export const connectedSitesResponse = {
  ok: true as const,
  sites: [{ accountCount: 1, origin: "https://example.com" }],
};

export const pendingApprovalsResponse = {
  ok: true as const,
  pending: [{ id: APPROVAL_ID, origin: "https://example.com" }],
};

export const accountsResponse = { accounts: [account], ok: true as const };

export const generateMnemonicResponse = {
  mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
  ok: true as const,
};

export const revealSecretsResponse = {
  mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
  ok: true as const,
  privateKey: "0x123456",
};

export const activityEntry = {
  accountId: account.id,
  hash: "0xabc",
  kind: "transfer" as const,
  networkId: "SN_SEPOLIA" as const,
  status: "accepted" as const,
  submittedAt: 1,
  summary: "Sent 1 ETH",
};

export const allowanceView = {
  accountId: account.id,
  amount: "1000",
  id: `${account.id}:0x49d3657:0x5abcdef1234`,
  networkId: "SN_SEPOLIA" as const,
  source: "wallet" as const,
  spender: "0x5abcdef1234",
  token: "0x49d3657",
};

export const discoveredNft = {
  collection: "CryptoPunks",
  contract: "0x511a2b3",
  id: "SN_MAIN:0x511a2b3:5",
  image: "",
  name: "Punk #5",
  networkId: "SN_MAIN" as const,
  tokenId: "5",
};

export const transferReviewResponse = {
  ok: true as const,
  review: {
    fee: { overallFee: "1000", unit: "WEI" },
    feeAffordability: "unknown" as const,
    feeEstimateFailed: false,
    flags: [{ code: "high-value", message: "Large transfer" }],
    requiresDeployment: false,
    summaries: ["Sends 1 ETH to 0xabc"],
  },
};

export const detectTokensResponse = { ok: true as const, suggestions: [tokenBalance] };

export const pricesResponse = {
  asOf: 1700000000,
  changes: { "0x49d3657": 1.5 },
  currency: "usd" as const,
  ok: true as const,
  prices: { "0x49d3657": 3200 },
  stale: false,
};

export const tokenChartResponse = {
  currency: "usd" as const,
  ok: true as const,
  points: [1, 2, 3],
};

export const preferencesResponse = { ok: true as const, preferences: defaultWalletPreferences() };

export const preferencesWithGroup = {
  ok: true as const,
  preferences: {
    ...defaultWalletPreferences(),
    groups: [{ accountIds: [], icon: "folder" as const, id: "work", name: "Work" }],
  },
};

export const errorEnvelope = { error: "boom" };

// A runtime that returns a fixed response and captures the last sent message so
// tests can assert the request envelope each wrapper builds.
export const captureRuntime = (response: unknown) => {
  const sent: unknown[] = [];
  const wallet = createSidepanelRuntime({
    async sendMessage(message: unknown) {
      sent.push(message);
      return response;
    },
  });
  return { sent, wallet };
};

export const runtimeReturning = (response: unknown) => captureRuntime(response).wallet;
