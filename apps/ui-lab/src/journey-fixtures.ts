import type {
  ConnectedSite,
  PendingApproval,
  TokenBalance,
  WalletStatus,
} from "../../../src/popup/responses";
import type { AllowanceView } from "../../../src/starknet/allowance-discovery";
import { DEFAULT_TOKENS } from "../../../src/starknet/networks";
import type { AccountGroups } from "../../../src/storage/account-groups";
import { allowanceId } from "../../../src/storage/allowance-store";
import { withTokenId } from "../../../src/storage/preferences-entries";
import type { WalletPreferences } from "../../../src/storage/preferences-store";
import type { AccountRef } from "../../../src/storage/vault-schema";
import { ledgerAccount, preferences, softwareAccount, statusFor, USDC_ADDRESS } from "./fixtures";

const mainnetToken = (symbol: "ETH" | "STRK") => {
  const token = DEFAULT_TOKENS.find(
    (candidate) => candidate.networkId === "SN_MAIN" && candidate.symbol === symbol,
  );
  if (!token) {
    throw new Error(`Missing production ${symbol} token fixture`);
  }
  return withTokenId(token);
};

export const ETH_TOKEN = mainnetToken("ETH");
export const STRK_TOKEN = mainnetToken("STRK");
export const SPAM_TOKEN = withTokenId({
  address: "0x099999",
  decimals: 6,
  name: "USD Coin reward",
  networkId: "SN_MAIN",
  symbol: "USDC",
});

const usdcToken = preferences.tokens[0];
if (!usdcToken) {
  throw new Error("Missing production USDC fixture");
}

export const groups: AccountGroups = [
  {
    accountIds: [softwareAccount.id, ledgerAccount.id],
    icon: "briefcase",
    id: "operations",
    name: "Operations",
  },
  {
    accountIds: [],
    icon: "piggyBank",
    id: "long-term",
    name: "Long term",
  },
];

export const journeyPreferences: WalletPreferences = {
  ...preferences,
  groups,
  hiddenTokens: [STRK_TOKEN.id],
  nftIndexerUrl: "https://fixtures.invalid/nfts",
  rpcOverrides: { SN_MAIN: "https://fixtures.invalid/rpc" },
  strk20ProverUrl: "https://fixtures.invalid/prover",
  tokens: [ETH_TOKEN, STRK_TOKEN, usdcToken, SPAM_TOKEN],
};

export const journeyBalances: readonly TokenBalance[] = [
  {
    ...ETH_TOKEN,
    balance: "1250000000000000000",
    formatted: "1.25",
  },
  {
    ...STRK_TOKEN,
    balance: "2845000000000000000000",
    formatted: "2845",
  },
  {
    ...usdcToken,
    balance: "428650000",
    formatted: "428.65",
  },
  {
    ...SPAM_TOKEN,
    balance: "500000000",
    formatted: "500",
  },
];

export const journeyPrices: Readonly<Record<string, number>> = {
  [ETH_TOKEN.address]: 3_584.42,
  [STRK_TOKEN.address]: 0.231,
  [USDC_ADDRESS]: 1,
};

export const journeyChanges: Readonly<Record<string, number>> = {
  [ETH_TOKEN.address]: 2.8,
  [STRK_TOKEN.address]: -1.4,
  [USDC_ADDRESS]: 0.01,
};

export const connectedSites: readonly ConnectedSite[] = [
  { accountCount: 2, origin: "https://terminal.mcwallet.dev" },
  { accountCount: 1, origin: "https://app.vesu.xyz" },
];

const EKUBO_ROUTER = "0x0404";
const VESU_POOL = "0x0505";

const allowance = (
  token: string,
  spender: string,
  amount: string,
  source: AllowanceView["source"],
): AllowanceView => {
  const input = {
    accountId: softwareAccount.id,
    amount,
    networkId: "SN_MAIN" as const,
    spender,
    token,
  };
  const id = allowanceId(input);
  if (!id) {
    throw new Error("Invalid UI Lab allowance fixture");
  }
  return { ...input, id, source };
};

export const allowances: readonly AllowanceView[] = [
  allowance(USDC_ADDRESS, EKUBO_ROUTER, (1n << 128n).toString(), "wallet"),
  allowance(STRK_TOKEN.address, VESU_POOL, "500000000000000000000", "external"),
];

export const emptyWalletStatus: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: false,
  locked: true,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: statusFor().networks,
  ready: true,
};

export const lockedStatus: WalletStatus = {
  ...statusFor(),
  locked: true,
};

export const emptyNetworkStatus: WalletStatus = {
  ...statusFor(),
  activeAccountId: null,
  network: "Starknet Sepolia",
  networkId: "SN_SEPOLIA",
};

export const importedAccount: AccountRef = {
  address: "0x6234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
  classHash: "0x111",
  derivation: { kind: "imported-raw-key" },
  id: "SN_MAIN:0x6234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
  networkId: "SN_MAIN",
  publicKeyX: "0x711",
};

export const importedStatus: WalletStatus = {
  ...statusFor(),
  accountCount: 4,
  accounts: [...statusFor().accounts, importedAccount],
  activeAccountId: importedAccount.id,
};

const approvalContext = {
  accountId: softwareAccount.id,
  chainId: "0x534e5f4d41494e",
  networkId: "SN_MAIN",
  payloadDigest: `sha256:${"c".repeat(64)}`,
};

const approvalId = (suffix: string): string => `00000000-0000-4000-8000-000000000${suffix}`;

export const approvalFixtures: Readonly<Record<string, PendingApproval>> = {
  addChain: {
    id: approvalId("141"),
    kind: "add-chain",
    origin: "https://network.example",
    summaries: ["Add Starknet Research Network", "RPC https://rpc.example"],
  },
  blocked: {
    blocked: true,
    id: approvalId("142"),
    insights: ["This origin resembles a frequently used wallet site."],
    kind: "connect",
    origin: "https://mcwa11et.example",
  },
  connect: {
    id: approvalId("143"),
    kind: "connect",
    origin: "https://app.vesu.xyz",
  },
  declare: {
    context: approvalContext,
    declaration: {
      abiEntryCount: 18,
      accountDeployment: "deployed",
      classHash: "0x1234",
      compiledClassHash: "0x5678",
      deploymentFee: null,
      deploymentFeeEstimateFailed: false,
      entryPointCount: 6,
      fee: { overallFee: "4200000000000000", unit: "FRI" },
      feeEstimateFailed: false,
      sierraProgramLength: 1_284,
    },
    id: approvalId("144"),
    kind: "declare",
    origin: "https://terminal.mcwallet.dev",
  },
  sign: {
    context: approvalContext,
    id: approvalId("145"),
    kind: "sign-typed-data",
    origin: "https://terminal.mcwallet.dev",
    typedData: {
      domain: { chainId: "SN_MAIN", name: "MC Terminal", revision: "1" },
      message: { action: "Follow market", market: "ETH-USD" },
      primaryType: "Intent",
      types: {
        Intent: [
          { name: "action", type: "felt" },
          { name: "market", type: "felt" },
        ],
        StarknetDomain: [
          { name: "name", type: "felt" },
          { name: "revision", type: "felt" },
          { name: "chainId", type: "felt" },
        ],
      },
    },
  },
  strk20: {
    context: approvalContext,
    id: approvalId("146"),
    insights: ["Private balance proofs remain fixture-only in this lab."],
    kind: "strk20-invoke",
    origin: "https://private.example",
    summaries: ["Deposit 25 STRK", "Transfer private note to recipient"],
  },
  switchChain: {
    id: approvalId("147"),
    kind: "switch-chain",
    origin: "https://sepolia.example",
    summaries: ["Switch from Starknet Mainnet to Starknet Sepolia"],
  },
};
