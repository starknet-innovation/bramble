import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
  argentSignerGuid,
  normalizeArgentMultisigConfig,
} from "@bramble/starknet/account-contracts";
import { argentMultisigTransactionHash } from "@bramble/starknet/multisig-invoke";
import type { ActivityEntry } from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type {
  ArgentMultisigView,
  DiscoveredNft,
  PendingApproval,
  TokenBalance,
  WalletStatus,
} from "@bramble/wallet-ui/lab";

export const SOFTWARE_ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
export const LEDGER_ADDRESS = "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
export const SECOND_ADDRESS = "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
export const RECIPIENT_ADDRESS = "0x4567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
export const USDC_ADDRESS = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
export const NFT_CONTRACT = "0x31075ef90ad626dc13fb97cdc7e04499ee5fa1007f2c4e1a9439b22fc3755b9";

export const softwareAccount: AccountRef = {
  accountContractType: "openzeppelin",
  address: SOFTWARE_ADDRESS,
  classHash: "0x111",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${SOFTWARE_ADDRESS}`,
  networkId: "SN_MAIN",
  publicKeyX: "0x5f679dacd8278105bd3b84a15548fe84079068276b0e84d6cc093eb5430f063",
  publicKeyY: "0x311",
};

export const argentSoftwareAccount: AccountRef = {
  ...softwareAccount,
  accountContractType: "argent",
  address: "0x1434567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
  classHash: ARGENT_ACCOUNT_CONTRACT.classHash,
  deploymentSalt: softwareAccount.publicKeyX,
  id: "SN_MAIN:0x1434567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
};

export const ledgerAccount: AccountRef = {
  accountContractType: "openzeppelin",
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
  publicKeyX: "0x6509ed71b354b7125d61b6f3423cbfa33dd7a6b21f0878399a5713118f9e68e",
};

export const secondAccount: AccountRef = {
  ...softwareAccount,
  address: SECOND_ADDRESS,
  derivation: { accountIndex: 1, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${SECOND_ADDRESS}`,
  publicKeyX: "0x5114567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
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
      nostrPublicKey: "11".repeat(32),
      publicKeyX: "0x7334567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
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

// Two UTC days of varied rows so the feed shows every part of the row anatomy:
// counterparties, asset amounts (priced USDC and unpriced STRK), a swap pair,
// and token-less contract interactions.
const DAY_BEFORE = 1_785_171_200_000 - 86_400_000;

export const softwareActivity: readonly ActivityEntry[] = [
  {
    ...activity(softwareAccount, "0x701", "Sent 24 USDC to 0x4567…cdef", "accepted"),
    amount: "24",
    counterparty: RECIPIENT_ADDRESS,
    token: "USDC",
  },
  {
    ...activity(softwareAccount, "0x702", "Swapped 50 USDC for 186.4 STRK", "accepted"),
    amount: "50",
    kind: "invoke",
    token: "USDC",
  },
  {
    ...activity(softwareAccount, "0x703", "Unstaked 120 STRK", "accepted"),
    amount: "120",
    kind: "invoke",
    submittedAt: DAY_BEFORE,
    token: "STRK",
  },
  {
    ...activity(softwareAccount, "0x704", "Claimed staking rewards", "accepted"),
    kind: "invoke",
    submittedAt: DAY_BEFORE,
  },
  {
    ...activity(softwareAccount, "0x705", "Private transfer 20 USDC", "accepted"),
    amount: "20",
    kind: "invoke",
    submittedAt: DAY_BEFORE,
    token: "USDC",
  },
];

// A feed long enough to overflow the side panel, so the lab can render the one
// behavior this state exists for: the title bar holds its place while only the
// list moves. It reuses the row anatomy above; the amounts differ so rows are
// not byte-identical in a snapshot.
export const longActivity: readonly ActivityEntry[] = Array.from(
  { length: 12 },
  (_, index): ActivityEntry => {
    const day = Math.floor(index / 6);
    const nth = (index % 6) + 1;
    return {
      ...activity(
        softwareAccount,
        `0x9${day}${nth}`,
        index === 5
          ? "Swapped 1,234.5678 USDC for 18,640.1234 STRK via the AVNU router on Starknet mainnet"
          : `Sent ${nth} USDC to 0x4567…cdef`,
        "accepted",
      ),
      amount: String(nth),
      counterparty: RECIPIENT_ADDRESS,
      submittedAt: day === 0 ? 1_785_171_200_000 : DAY_BEFORE,
      token: "USDC",
    };
  },
);

export const secondActivity: readonly ActivityEntry[] = [
  activity(secondAccount, "0x801", "Supplied 200 USDC to Vesu", "pending"),
];

export const discoveredNft: DiscoveredNft = {
  attributes: [
    { traitType: "Network", value: "Starknet" },
    { traitType: "Edition", value: "Genesis" },
    { traitType: "Role", value: "Tester" },
  ],
  collection: "Bramble Test Collection",
  contract: NFT_CONTRACT,
  description: "A deterministic collectible used only inside the Bramble UI Lab.",
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
  origin: "https://terminal.bramble.test",
  reviewAssets: [
    { address: USDC_ADDRESS, symbol: "USDC" },
    { address: STRK_TOKEN_ADDRESS, symbol: "STRK" },
  ],
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

const argentSigners = normalizeArgentMultisigConfig({
  signerPublicKeys: [softwareAccount.publicKeyX, ledgerAccount.publicKeyX],
  threshold: 2,
});

export const argentMultisig: ArgentMultisigView = {
  authorityStatus: "available",
  config: {
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    signerGuids: argentSigners.signerPublicKeys.map(argentSignerGuid),
    threshold: argentSigners.threshold,
  },
  deployed: true,
  record: {
    accountContractType: "argent-multisig",
    address: "0x71234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    currentConfig: argentSigners,
    deployment: {
      salt: "0x0",
      signerPublicKeys: argentSigners.signerPublicKeys,
      threshold: argentSigners.threshold,
    },
    id: "SN_MAIN:0x71234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    name: "Operations treasury",
    networkId: "SN_MAIN",
  },
  unsupportedSigners: [],
};

const argentPrepared = {
  accountDeploymentData: [],
  calldata: [
    "0x1",
    "0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
    "0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e",
    "0x3",
    RECIPIENT_ADDRESS,
    "0x17d7840",
    "0x0",
  ],
  calls: [
    {
      calldata: [RECIPIENT_ADDRESS, "0x17d7840", "0x0"],
      contractAddress: "0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
      entrypoint: "transfer",
    },
  ],
  chainId: "0x534e5f4d41494e",
  feeDataAvailabilityMode: "L1" as const,
  nonce: "0x7",
  nonceDataAvailabilityMode: "L1" as const,
  paymasterData: [],
  resourceBounds: {
    l1DataGas: { maxAmount: "0x0", maxPricePerUnit: "0x0" },
    l1Gas: { maxAmount: "0x1", maxPricePerUnit: "0x886c98b760000" },
    l2Gas: { maxAmount: "0x0", maxPricePerUnit: "0x0" },
  },
  senderAddress: argentMultisig.record.address,
  tip: "0x0",
  transactionHash: "0x4b1aa1c77c968ac524cb4fd4a7bcf2c1999a770c5095397b82e4bcf14f3c4b6",
  version: "0x3" as const,
};

export const argentCollectingIntent: ArgentMultisigSigningIntent = {
  accountId: argentMultisig.record.id,
  configSnapshot: {
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    signerGuids: argentMultisig.config?.signerGuids ?? [],
    threshold: 2,
  },
  id: `${argentMultisig.record.id}:${argentPrepared.transactionHash}`,
  prepared: argentPrepared,
  signatures: [],
  state: "collecting",
  summary: "Send 25 USDC to Research treasury",
};

export const argentReadyIntent: ArgentMultisigSigningIntent = {
  ...argentCollectingIntent,
  signatures: argentSigners.signerPublicKeys.map((publicKey) =>
    publicKey === softwareAccount.publicKeyX
      ? {
          publicKey,
          r: "0x3ec43277e38eb646cc0a878a1e0cd255eb393522671a91dc31a9c8c0afb0e2f",
          s: "0x75a22a60ee673a9849ae7a0c85ff4985867f296267f7ce08899deb42fce4032",
        }
      : {
          publicKey,
          r: "0x7b6aaffb16aa1af37b306510173918811dcc6e7e30728f6ac24865c06bdae50",
          s: "0x3512e7d5d4b347e2fae55d8225de0e51cab4994533ad45e24de9c83c0d5f1ca",
        },
  ),
  state: "ready",
};

export const argentSubmittedIntent: ArgentMultisigSigningIntent = {
  ...argentReadyIntent,
  broadcastTransactionHash: argentReadyIntent.prepared.transactionHash,
  state: "submitted",
};

export const argentStaleIntent: ArgentMultisigSigningIntent = {
  ...argentReadyIntent,
  state: "stale",
};

const argentReplacementFields = {
  ...argentCollectingIntent.prepared,
  resourceBounds: {
    ...argentCollectingIntent.prepared.resourceBounds,
    l1Gas: { maxAmount: "0x2", maxPricePerUnit: "0x110d93016c0000" },
  },
};
const argentReplacementPrepared = {
  ...argentReplacementFields,
  transactionHash: argentMultisigTransactionHash(argentReplacementFields),
};
export const argentReplacementIntent: ArgentMultisigSigningIntent = {
  ...argentCollectingIntent,
  id: `${argentCollectingIntent.accountId}:${argentReplacementPrepared.transactionHash}`,
  prepared: argentReplacementPrepared,
  signatures: argentReadyIntent.signatures.slice(0, 1),
};
