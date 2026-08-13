import { multisigTransactionId } from "@mc-wallet/multisig/chain";
import type { MultisigProposalRecord, MultisigRecord } from "@mc-wallet/multisig/repository";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import type { ActivityEntry } from "@mc-wallet/transactions/activity";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import type {
  DiscoveredNft,
  PendingApproval,
  TokenBalance,
  WalletStatus,
} from "@mc-wallet/wallet-ui/lab";

export const SOFTWARE_ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
export const LEDGER_ADDRESS = "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
export const SECOND_ADDRESS = "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
export const RECIPIENT_ADDRESS = "0x4567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
export const USDC_ADDRESS = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
export const NFT_CONTRACT = "0x31075ef90ad626dc13fb97cdc7e04499ee5fa1007f2c4e1a9439b22fc3755b9";

export const softwareAccount: AccountRef = {
  address: SOFTWARE_ADDRESS,
  classHash: "0x111",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${SOFTWARE_ADDRESS}`,
  networkId: "SN_MAIN",
  publicKeyX: "0x211",
  publicKeyY: "0x311",
};

export const ledgerAccount: AccountRef = {
  address: LEDGER_ADDRESS,
  classHash: "0x111",
  derivation: {
    accountIndex: 0,
    eip2645application: LEDGER_EIP2645_APPLICATION,
    kind: "ledger",
    path: ledgerAccountPath(0),
  },
  id: `SN_MAIN:${LEDGER_ADDRESS}`,
  networkId: "SN_MAIN",
  publicKeyX: "0x411",
};

export const secondAccount: AccountRef = {
  ...softwareAccount,
  address: SECOND_ADDRESS,
  derivation: { accountIndex: 1, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${SECOND_ADDRESS}`,
  publicKeyX: "0x511",
  publicKeyY: "0x611",
};

export const statusFor = (account: AccountRef = softwareAccount): WalletStatus => ({
  accountCount: 3,
  accounts: [softwareAccount, ledgerAccount, secondAccount],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_SEPOLIA", name: "Starknet Sepolia" },
  ],
  ready: true,
});

const usdcToken = {
  address: USDC_ADDRESS,
  decimals: 6,
  id: `SN_MAIN:USDC:${USDC_ADDRESS}`,
  name: "USD Coin",
  networkId: "SN_MAIN" as const,
  symbol: "USDC",
};

export const nftId = `SN_MAIN:${NFT_CONTRACT}:342`;

export const preferences: WalletPreferences = {
  accountLabels: {
    [softwareAccount.id]: "Daily account",
    [ledgerAccount.id]: "Ledger vault",
    [secondAccount.id]: "Trading account",
  },
  activeNetworkId: "SN_MAIN",
  addressBook: [
    {
      address: RECIPIENT_ADDRESS,
      id: `SN_MAIN:${RECIPIENT_ADDRESS}`,
      label: "Research treasury",
      networkId: "SN_MAIN",
    },
  ],
  approvalSurface: "side-panel",
  displayCurrency: "usd",
  nfts: [
    {
      contract: NFT_CONTRACT,
      id: nftId,
      label: "Proof of Participation #342",
      networkId: "SN_MAIN",
      tokenId: "342",
    },
  ],
  schemaVersion: 1,
  theme: "dark",
  tokens: [usdcToken],
};

export const balances: readonly TokenBalance[] = [
  {
    ...usdcToken,
    balance: "428650000",
    formatted: "428.65",
  },
];

const activity = (
  account: AccountRef,
  hash: string,
  summary: string,
  status: ActivityEntry["status"],
): ActivityEntry => ({
  accountId: account.id,
  hash,
  kind: "transfer",
  networkId: "SN_MAIN",
  status,
  submittedAt: 1_785_171_200_000,
  summary,
});

export const softwareActivity: readonly ActivityEntry[] = [
  activity(softwareAccount, "0x701", "Sent 24 USDC", "accepted"),
  activity(softwareAccount, "0x702", "Swapped 50 USDC for STRK", "accepted"),
];

export const secondActivity: readonly ActivityEntry[] = [
  activity(secondAccount, "0x801", "Supplied 200 USDC to Vesu", "pending"),
];

export const discoveredNft: DiscoveredNft = {
  attributes: [
    { traitType: "Network", value: "Starknet" },
    { traitType: "Edition", value: "Genesis" },
    { traitType: "Role", value: "Tester" },
  ],
  collection: "MC Test Collection",
  contract: NFT_CONTRACT,
  description: "A deterministic collectible used only inside the MC Wallet UI Lab.",
  id: nftId,
  image: "/nft-fixture.svg",
  name: "Proof of Participation #342",
  networkId: "SN_MAIN",
  tokenId: "342",
};

export const invokeApproval: PendingApproval = {
  context: {
    accountId: softwareAccount.id,
    chainId: "0x534e5f4d41494e",
    networkId: "SN_MAIN",
    payloadDigest: `sha256:${"a".repeat(64)}`,
  },
  flags: [],
  id: "00000000-0000-4000-8000-000000000134",
  kind: "invoke",
  origin: "https://terminal.mcwallet.dev",
  summaries: ["Swap 75 USDC for at least 186 STRK", "Approve 75 USDC to Ekubo router"],
};

export const watchAssetApproval: PendingApproval = {
  id: "00000000-0000-4000-8000-000000000136",
  kind: "watch-asset",
  origin: "https://app.vesu.xyz",
  token: {
    address: "0x06f4",
    decimals: 6,
    name: "Vesu USDC receipt",
    networkId: "SN_MAIN",
    symbol: "VUSDC",
  },
};

export const multisig: MultisigRecord = {
  address: "0x71234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
  id: "SN_MAIN:0x71234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
  name: "Operations treasury",
  networkId: "SN_MAIN",
  quorum: 2,
  signers: [softwareAccount.address, ledgerAccount.address, secondAccount.address],
};

const pendingProposalCall = {
  calldata: [RECIPIENT_ADDRESS, "0x5f5e100", "0x0"],
  contractAddress: USDC_ADDRESS,
  entrypoint: "transfer",
  salt: "0x2",
} as const;
const pendingProposalId = multisigTransactionId(pendingProposalCall, pendingProposalCall.salt);

export const pendingProposal: MultisigProposalRecord = {
  call: pendingProposalCall,
  confirmations: 1,
  confirmedBySigner: false,
  confirmedBySignerAddress: softwareAccount.address,
  id: `${multisig.id}:${pendingProposalId}`,
  multisigId: multisig.id,
  state: "pending",
  summary: "Pay 100 USDC to research treasury",
  txId: pendingProposalId,
};
