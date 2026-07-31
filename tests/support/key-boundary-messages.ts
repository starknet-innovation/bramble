/**
 * Key-boundary scan catalog: one request payload per handled background message
 * type, plus a source-derived list of every wallet.* type the
 * background actually handles. The key-boundary suite asserts the catalog
 * covers the derived list, so new message types cannot bypass the secret scan.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeSender } from "../../src/background/senders";
import type { AccountRef } from "../../src/storage/vault-schema";

/**
 * Recognizable secrets salted into the stub vault; the scan greps serialized
 * responses for these exact strings.
 */
export const SECRET_PRIVATE_KEY =
  "0x7e57ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8";

/**
 * Vault passphrase used by the stub vault and secret scan.
 */
export const SECRET_PASSPHRASE = "correct horse battery staple";

/**
 * Recovery phrase stored in the stub vault.
 */
export const SECRET_MNEMONIC =
  "habit hope tip crystal because grunt nation idea electric witness alert like";

/**
 * The stub vault's single account.
 */
export const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

/**
 * Extension-page sender accepted for privileged messages.
 */
export const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

/**
 * Content-script sender for dapp-facing messages.
 */
export const contentSender: RuntimeSender = {
  id: "extension-id",
  url: "https://dapp.example/swap",
};

const MULTISIG = "0x111111111111111111111111111111111111111111111111111111111111111";
const ORIGIN = "https://dapp.example";

// Broadcast event envelope: emitted by the background, never handled as an
// inbound request, so it has no scan entry.
const OUTBOUND_ONLY = new Set(["wallet.event"]);

/**
 * Reads every wallet.* message type the background sources handle. Derived
 * from the literals in src/background so the scan's coverage is enforced by
 * construction rather than by memory.
 */
export const handledWalletMessages = async (): Promise<ReadonlySet<string>> => {
  const dir = "src/background";
  const handled = new Set<string>();
  for (const entry of await readdir(dir)) {
    if (!entry.endsWith(".ts")) {
      continue;
    }
    const source = await readFile(join(dir, entry), "utf8");
    for (const match of source.matchAll(/"(wallet\.[a-zA-Z0-9]+)"/g)) {
      const type = match[1] ?? "";
      if (type && !OUTBOUND_ONLY.has(type)) {
        handled.add(type);
      }
    }
  }
  return handled;
};

/** One request per handled message type. Payloads are best-effort valid so
 * responses exercise real handler paths; even rejected inputs are scanned,
 * since error strings must not echo secret material either.
 */
export const KEY_BOUNDARY_MESSAGES: readonly {
  readonly message: Record<string, unknown>;
  readonly sender: RuntimeSender;
}[] = [
  { message: { type: "wallet.status" }, sender: extensionSender },
  {
    message: { type: "wallet.unlock", vaultPassphrase: SECRET_PASSPHRASE },
    sender: extensionSender,
  },
  { message: { type: "wallet.getBalances" }, sender: extensionSender },
  { message: { type: "wallet.deploymentStatus" }, sender: extensionSender },
  { message: { type: "wallet.verifyClassHash" }, sender: extensionSender },
  { message: { type: "wallet.deployAccount" }, sender: extensionSender },
  { message: { type: "wallet.pendingApprovals" }, sender: extensionSender },
  { message: { type: "wallet.preferences" }, sender: extensionSender },
  { message: { origin: ORIGIN, type: "wallet.requestAccounts" }, sender: contentSender },
  { message: { origin: ORIGIN, type: "wallet.getGrantedAccounts" }, sender: contentSender },
  { message: { origin: ORIGIN, type: "wallet.getChainId" }, sender: contentSender },
  {
    message: {
      calls: [{ calldata: ["0x1"], contractAddress: "0x2", entrypoint: "transfer" }],
      origin: ORIGIN,
      type: "wallet.addInvokeTransaction",
    },
    sender: contentSender,
  },
  {
    message: { chainId: "0x534e5f4d41494e", origin: ORIGIN, type: "wallet.switchChain" },
    sender: contentSender,
  },
  { message: { accountId: account.id, type: "wallet.setActiveAccount" }, sender: extensionSender },
  { message: { networkId: "SN_MAIN", type: "wallet.setActiveNetwork" }, sender: extensionSender },
  {
    message: {
      accountId: account.id,
      messageHash: "0x1",
      type: "wallet.signHash",
      vaultPassphrase: SECRET_PASSPHRASE,
    },
    sender: extensionSender,
  },
  {
    message: { type: "wallet.revealSecrets", vaultPassphrase: SECRET_PASSPHRASE },
    sender: extensionSender,
  },
  {
    message: {
      accountId: account.id,
      amount: "1.0",
      recipient: account.address,
      tokenId: "SN_MAIN:ETH:0x1",
      type: "wallet.transfer",
    },
    sender: extensionSender,
  },
  { message: { type: "wallet.swapTokens" }, sender: extensionSender },
  {
    message: {
      amount: "0.1",
      buyTokenId: "SN_MAIN:STRK:0x2",
      sellTokenId: "SN_MAIN:ETH:0x1",
      type: "wallet.swapQuote",
    },
    sender: extensionSender,
  },
  {
    message: {
      amount: "0.1",
      buyAmount: "1283.4",
      buyTokenId: "SN_MAIN:STRK:0x2",
      quoteId: "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca",
      sellTokenId: "SN_MAIN:ETH:0x1",
      type: "wallet.swapPrepare",
    },
    sender: extensionSender,
  },
  {
    message: {
      preparationId: `sha256:${"a".repeat(64)}`,
      type: "wallet.swapExecute",
    },
    sender: extensionSender,
  },
  { message: { networkId: "SN_MAIN", type: "wallet.addAccount" }, sender: extensionSender },
  {
    message: {
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: account.publicKeyX,
      type: "wallet.addLedgerAccount",
    },
    sender: extensionSender,
  },
  {
    message: {
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: account.publicKeyX,
      type: "wallet.createLedgerVault",
      vaultPassphrase: SECRET_PASSPHRASE,
    },
    sender: extensionSender,
  },
  {
    message: {
      entries: [{ accountIndex: 0, publicKeyX: account.publicKeyX }],
      networkId: "SN_MAIN",
      type: "wallet.deriveLedgerAccounts",
    },
    sender: extensionSender,
  },
  {
    message: { address: account.address, networkId: "SN_MAIN", type: "wallet.ledgerAccountStatus" },
    sender: extensionSender,
  },
  { message: { type: "wallet.ledgerSignPending" }, sender: extensionSender },
  {
    message: { id: "ledger-sign-1", r: "0x1", s: "0x2", type: "wallet.completeLedgerSign" },
    sender: extensionSender,
  },
  {
    message: {
      networkId: "SN_MAIN",
      privateKey: SECRET_PRIVATE_KEY,
      type: "wallet.importAccount",
    },
    sender: extensionSender,
  },
  {
    message: {
      mnemonic: SECRET_MNEMONIC,
      type: "wallet.createAccount",
      vaultPassphrase: SECRET_PASSPHRASE,
    },
    sender: extensionSender,
  },
  { message: { type: "wallet.generateMnemonic" }, sender: extensionSender },
  {
    message: {
      mnemonic: SECRET_MNEMONIC,
      networkId: "SN_MAIN",
      type: "wallet.previewAccount",
    },
    sender: extensionSender,
  },
  {
    message: { accountId: account.id, origin: ORIGIN, type: "wallet.grantOrigin" },
    sender: extensionSender,
  },
  {
    message: { id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14", type: "wallet.approveOrigin" },
    sender: extensionSender,
  },
  {
    message: { id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14", type: "wallet.denyOrigin" },
    sender: extensionSender,
  },
  { message: { origin: ORIGIN, type: "wallet.revokeOrigin" }, sender: extensionSender },
  { message: { type: "wallet.connectedSites" }, sender: extensionSender },
  { message: { origin: ORIGIN, type: "wallet.getPermissions" }, sender: contentSender },
  {
    message: {
      accountId: account.id,
      amount: "1.0",
      recipient: account.address,
      tokenId: "SN_MAIN:ETH:0x1",
      type: "wallet.reviewTransfer",
    },
    sender: extensionSender,
  },
  {
    message: {
      contract: account.classHash,
      networkId: "SN_MAIN",
      recipient: account.address,
      tokenId: "1",
      type: "wallet.reviewNftTransfer",
    },
    sender: extensionSender,
  },
  {
    message: {
      contract: account.classHash,
      networkId: "SN_MAIN",
      recipient: account.address,
      tokenId: "1",
      type: "wallet.transferNft",
    },
    sender: extensionSender,
  },
  {
    message: { allowanceId: "SN_MAIN:0x1:0x2", type: "wallet.revokeAllowance" },
    sender: extensionSender,
  },
  { message: { type: "wallet.allowances" }, sender: extensionSender },
  { message: { type: "wallet.activity" }, sender: extensionSender },
  {
    message: {
      options: { address: account.classHash, decimals: 18, symbol: "TKN" },
      origin: ORIGIN,
      type: "wallet.watchAsset",
    },
    sender: contentSender,
  },
  { message: { address: account.classHash, type: "wallet.addToken" }, sender: extensionSender },
  { message: { type: "wallet.detectTokens" }, sender: extensionSender },
  { message: { type: "wallet.discoverNfts" }, sender: extensionSender },
  { message: { type: "wallet.loadWatchedNfts" }, sender: extensionSender },
  {
    message: { type: "wallet.setNftIndexerUrl", url: "https://indexer.example" },
    sender: extensionSender,
  },
  { message: { type: "wallet.prices" }, sender: extensionSender },
  { message: { address: account.classHash, type: "wallet.tokenChart" }, sender: extensionSender },
  {
    message: { accountId: account.id, label: "Main", type: "wallet.setAccountLabel" },
    sender: extensionSender,
  },
  { message: { displayCurrency: "usd", type: "wallet.setDisplay" }, sender: extensionSender },
  {
    message: { icon: "folder", name: "Trading", type: "wallet.createGroup" },
    sender: extensionSender,
  },
  {
    message: { id: "trading", name: "Savings", type: "wallet.renameGroup" },
    sender: extensionSender,
  },
  {
    message: { icon: "star", id: "trading", type: "wallet.setGroupIcon" },
    sender: extensionSender,
  },
  { message: { id: "trading", type: "wallet.removeGroup" }, sender: extensionSender },
  {
    message: {
      accountId: account.id,
      groupId: "trading",
      member: true,
      type: "wallet.setAccountInGroup",
    },
    sender: extensionSender,
  },
  {
    message: {
      origin: ORIGIN,
      typedData: { domain: {}, message: {}, primaryType: "X", types: {} },
      type: "wallet.signTypedData",
    },
    sender: contentSender,
  },
  { message: { type: "wallet.lock" }, sender: extensionSender },
  { message: { type: "wallet.status" }, sender: contentSender },
  {
    message: { type: "wallet.unlock", vaultPassphrase: "wrong passphrase!!" },
    sender: extensionSender,
  },
  { message: { type: "wallet.multisigs" }, sender: extensionSender },
  {
    message: { id: `SN_MAIN:${MULTISIG}`, type: "wallet.multisigBalances" },
    sender: extensionSender,
  },
  {
    message: { address: MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
    sender: extensionSender,
  },
  {
    message: {
      calldata: ["0x1"],
      entrypoint: "transfer",
      multisigId: `SN_MAIN:${MULTISIG}`,
      to: account.address,
      type: "wallet.proposeMultisigTx",
    },
    sender: extensionSender,
  },
  {
    message: { proposalId: `SN_MAIN:${MULTISIG}:0xabc`, type: "wallet.confirmMultisigProposal" },
    sender: extensionSender,
  },
  {
    message: {
      proposalId: `SN_MAIN:${MULTISIG}:0xabc`,
      type: "wallet.revokeMultisigConfirmation",
    },
    sender: extensionSender,
  },
  {
    message: { proposalId: `SN_MAIN:${MULTISIG}:0xabc`, type: "wallet.executeMultisigProposal" },
    sender: extensionSender,
  },
  {
    message: {
      multisigId: `SN_MAIN:${MULTISIG}`,
      txId: "0xdef",
      type: "wallet.trackMultisigProposal",
    },
    sender: extensionSender,
  },
  {
    message: { id: `SN_MAIN:${MULTISIG}`, type: "wallet.refreshMultisig" },
    sender: extensionSender,
  },
  {
    message: { id: `SN_MAIN:${MULTISIG}`, type: "wallet.removeMultisig" },
    sender: extensionSender,
  },
  { message: { type: "wallet.multisigClassStatus" }, sender: extensionSender },
  { message: { type: "wallet.declareMultisigClass" }, sender: extensionSender },
  {
    message: { quorum: 1, signers: [account.address], type: "wallet.deployMultisig" },
    sender: extensionSender,
  },
  {
    message: {
      compiledClassHash: "0x1",
      contractClass: { sierra_program: [] },
      origin: ORIGIN,
      type: "wallet.addDeclareTransaction",
    },
    sender: contentSender,
  },
  {
    message: {
      contract: account.classHash,
      label: "Art",
      networkId: "SN_MAIN",
      tokenId: "1",
      type: "wallet.addNft",
    },
    sender: extensionSender,
  },
  {
    message: {
      chain: { chainId: "0x534e5f4d41494e", chainName: "Custom", rpcUrls: ["https://rpc.example"] },
      origin: ORIGIN,
      type: "wallet.addStarknetChain",
    },
    sender: contentSender,
  },
  { message: { origin: ORIGIN, type: "wallet.deploymentData" }, sender: contentSender },
  { message: { data: "{}", type: "wallet.importPreferences" }, sender: extensionSender },
  { message: { id: "addr-1", type: "wallet.removeAddress" }, sender: extensionSender },
  { message: { id: "nft-1", type: "wallet.removeNft" }, sender: extensionSender },
  {
    message: {
      address: account.address,
      label: "Me",
      networkId: "SN_MAIN",
      type: "wallet.saveAddress",
    },
    sender: extensionSender,
  },
  { message: { id: "nft-1", spam: true, type: "wallet.setNftSpam" }, sender: extensionSender },
  {
    message: { networkId: "SN_MAIN", type: "wallet.setRpcOverride", url: "https://rpc.example" },
    sender: extensionSender,
  },
  {
    message: {
      config: {
        discoveryUrl: "https://discovery.example",
        poolAddress: "0x1",
        proverUrl: "https://prover.example",
        subaccountAnonymizerAddress: "0x2",
      },
      networkId: "SN_MAIN",
      type: "wallet.setStrk20NetworkConfig",
    },
    sender: extensionSender,
  },
  {
    message: { hidden: true, id: "tok-1", type: "wallet.setTokenHidden" },
    sender: extensionSender,
  },
  { message: { origin: ORIGIN, type: "wallet.strk20Balances" }, sender: contentSender },
  { message: { origin: ORIGIN, type: "wallet.strk20Register" }, sender: contentSender },
  {
    message: { origin: ORIGIN, params: {}, type: "wallet.strk20InvokeTransaction" },
    sender: contentSender,
  },
  {
    message: { origin: ORIGIN, params: {}, type: "wallet.strk20PrepareInvoke" },
    sender: contentSender,
  },
  {
    message: {
      dappName: "mc-terminal",
      origin: ORIGIN,
      type: "wallet.strk20SubaccountCommitment",
    },
    sender: contentSender,
  },
  { message: { type: "wallet.strk20State" }, sender: extensionSender },
  { message: { type: "wallet.strk20PrepareRegistration" }, sender: extensionSender },
  {
    message: { amount: "1", tokenId: "SN_MAIN:0x1", type: "wallet.strk20PrepareDeposit" },
    sender: extensionSender,
  },
  {
    message: {
      preparationId: `sha256:${"0".repeat(64)}`,
      type: "wallet.strk20Execute",
    },
    sender: extensionSender,
  },
  { message: { origin: ORIGIN, type: "wallet.supportedSpecs" }, sender: contentSender },
  { message: { origin: ORIGIN, type: "wallet.supportedWalletApi" }, sender: contentSender },
];
