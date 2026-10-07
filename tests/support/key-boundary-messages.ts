/**
 * Key-boundary scan catalog: one request payload per handled background message
 * type, plus a source-derived list of every wallet.* type the background
 * actually handles. The key-boundary suite asserts the catalog covers the
 * derived list, so new message types cannot bypass the secret scan.
 *
 * Payloads are written to reach a real handler, not merely to parse: an entry
 * that bounces off its input validator or a missing collaborator produces an
 * `{ error }` the secret scan would pass trivially, which is why the suite also
 * asserts every entry answers live unless it carries an explicit `negative`
 * reason. Identifiers the background mints at run time (approvals, proposals,
 * one-time preparations) are filled in by the harness through `live`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import {
  account,
  contentSender,
  extensionSender,
  KEY_BOUNDARY_NFT_CONTRACT,
  KEY_BOUNDARY_ORIGIN,
  KEY_BOUNDARY_RECIPIENT,
  KEY_BOUNDARY_TOKENS,
  SECRET_MNEMONIC,
  SECRET_PASSPHRASE,
  SECRET_PRIVATE_KEY,
} from "./key-boundary-fixtures";
import { MULTISIG_KEY_BOUNDARY_MESSAGES } from "./key-boundary-multisig-messages";
import { RECOVERY_KEY_BOUNDARY_MESSAGES } from "./key-boundary-recovery-messages";
import { STRK20_KEY_BOUNDARY_MESSAGES } from "./key-boundary-strk20-messages";
import { TOKEN_KEY_BOUNDARY_MESSAGES } from "./key-boundary-token-messages";
import type { KeyBoundaryMessage } from "./key-boundary-types";

const ETH_TOKEN_ID = KEY_BOUNDARY_TOKENS.eth.id;
const STRK_TOKEN_ID = KEY_BOUNDARY_TOKENS.strk.id;
const ETH_TOKEN_ADDRESS = KEY_BOUNDARY_TOKENS.eth.address;
const NFT_CONTRACT = KEY_BOUNDARY_NFT_CONTRACT;

// A well-formed SNIP-12 typed message that hashes cleanly, so the sign path
// reaches its approval instead of stopping at the hash.
const TYPED_DATA = {
  domain: { chainId: "0x534e5f4d41494e", name: "Example", revision: "1", version: "1" },
  message: { contents: "hello" },
  primaryType: "Mail",
  types: {
    Mail: [{ name: "contents", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "felt" },
      { name: "version", type: "felt" },
      { name: "chainId", type: "felt" },
    ],
  },
};

// Broadcast event envelope: emitted by the background, never handled as an
// inbound request, so it has no scan entry.
const OUTBOUND_ONLY = new Set(["wallet.event"]);

/**
 * Reads every wallet.* message type the background sources handle. Derived
 * from the literals under `apps/extension/src/background` so the scan's
 * coverage is enforced by construction rather than by memory.
 *
 * The walk recurses deliberately: the background surface is split across
 * per-capability directories, so a listing that only read the top level would
 * derive an almost-empty set and turn the coverage assertion this feeds into a
 * no-op — exactly the inert scan MCW-V09-111 closed. A new handler directory
 * is therefore picked up without anyone remembering to register it.
 */
export const handledWalletMessages = async (): Promise<ReadonlySet<string>> => {
  const handled = new Set<string>();
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue;
      }
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(/"(wallet\.[a-zA-Z0-9]+)"/g)) {
        const type = match[1] ?? "";
        if (type && !OUTBOUND_ONLY.has(type)) {
          handled.add(type);
        }
      }
    }
  };
  await visit("apps/extension/src/background");
  return handled;
};

/** One live request per handled type; the response of each is secret-scanned. */
export const KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  { message: { type: "wallet.status" }, sender: extensionSender },
  {
    message: { type: "wallet.unlock", vaultPassphrase: SECRET_PASSPHRASE },
    sender: extensionSender,
  },
  { message: { type: "wallet.getBalances" }, sender: extensionSender },
  { message: { type: "wallet.accountSignability" }, sender: extensionSender },
  { message: { type: "wallet.deploymentStatus" }, sender: extensionSender },
  { message: { type: "wallet.verifyClassHash" }, sender: extensionSender },
  {
    message: { origin: KEY_BOUNDARY_ORIGIN, type: "wallet.deploymentData" },
    sender: contentSender,
  },
  { message: { type: "wallet.deployAccount" }, sender: extensionSender },
  { message: { type: "wallet.pendingApprovals" }, sender: extensionSender },
  {
    live: async (ids) => ({ id: await ids.invokeApprovalId() }),
    message: { id: "", type: "wallet.retryApprovalFee" },
    sender: extensionSender,
  },
  { message: { type: "wallet.preferences" }, sender: extensionSender },
  { message: { type: "wallet.diagnostics" }, sender: extensionSender },
  {
    message: { origin: KEY_BOUNDARY_ORIGIN, type: "wallet.requestAccounts" },
    sender: contentSender,
  },
  {
    message: { origin: KEY_BOUNDARY_ORIGIN, type: "wallet.getGrantedAccounts" },
    sender: contentSender,
  },
  { message: { origin: KEY_BOUNDARY_ORIGIN, type: "wallet.getChainId" }, sender: contentSender },
  {
    message: {
      calls: [{ calldata: ["0x1"], contractAddress: ETH_TOKEN_ADDRESS, entrypoint: "transfer" }],
      origin: KEY_BOUNDARY_ORIGIN,
      type: "wallet.addInvokeTransaction",
    },
    sender: contentSender,
  },
  {
    message: {
      chainId: "0x534e5f4d41494e",
      origin: KEY_BOUNDARY_ORIGIN,
      type: "wallet.switchChain",
    },
    sender: contentSender,
  },
  { message: { accountId: account.id, type: "wallet.setActiveAccount" }, sender: extensionSender },
  { message: { networkId: "SN_MAIN", type: "wallet.setActiveNetwork" }, sender: extensionSender },
  {
    message: { type: "wallet.revealSecrets", vaultPassphrase: SECRET_PASSPHRASE },
    sender: extensionSender,
  },
  {
    message: {
      accountId: account.id,
      amount: "1.0",
      recipient: KEY_BOUNDARY_RECIPIENT,
      reviewedFee: { overallFee: "1", unit: "FRI" },
      tokenId: ETH_TOKEN_ID,
      type: "wallet.transfer",
    },
    sender: extensionSender,
  },
  { message: { type: "wallet.swapTokens" }, sender: extensionSender },
  {
    message: {
      amount: "0.01",
      buyTokenId: STRK_TOKEN_ID,
      sellTokenId: ETH_TOKEN_ID,
      type: "wallet.swapQuote",
    },
    sender: extensionSender,
  },
  {
    message: {
      amount: "0.01",
      buyAmount: "12.5",
      buyTokenId: STRK_TOKEN_ID,
      quoteId: "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca",
      sellTokenId: ETH_TOKEN_ID,
      type: "wallet.swapPrepare",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ preparationId: await ids.swapPreparationId() }),
    message: { preparationId: "", type: "wallet.swapExecute" },
    sender: extensionSender,
  },
  {
    message: {
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      type: "wallet.addAccount",
    },
    sender: extensionSender,
  },
  ...RECOVERY_KEY_BOUNDARY_MESSAGES,
  {
    message: {
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: account.publicKeyX,
      type: "wallet.addLedgerAccount",
    },
    sender: extensionSender,
  },
  {
    message: {
      accountContractType: "openzeppelin",
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
      accountContractType: "openzeppelin",
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
    live: async (ids) => ({ id: await ids.ledgerSignId() }),
    message: { id: "", r: "0x1", s: "0x2", type: "wallet.completeLedgerSign" },
    sender: extensionSender,
  },
  {
    message: {
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      privateKey: SECRET_PRIVATE_KEY,
      type: "wallet.importAccount",
    },
    sender: extensionSender,
  },
  {
    message: {
      accountContractType: "openzeppelin",
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
      type: "wallet.validateMnemonic",
    },
    sender: extensionSender,
  },
  {
    message: {
      accountContractType: "openzeppelin",
      mnemonic: SECRET_MNEMONIC,
      networkId: "SN_MAIN",
      type: "wallet.previewAccount",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ id: await ids.connectApprovalId() }),
    message: { id: "", type: "wallet.approveOrigin" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ id: await ids.connectApprovalId() }),
    message: { id: "", type: "wallet.denyOrigin" },
    sender: extensionSender,
  },
  {
    message: { origin: KEY_BOUNDARY_ORIGIN, type: "wallet.revokeOrigin" },
    sender: extensionSender,
  },
  { message: { type: "wallet.connectedSites" }, sender: extensionSender },
  {
    message: { origin: KEY_BOUNDARY_ORIGIN, type: "wallet.getPermissions" },
    sender: contentSender,
  },
  {
    message: {
      accountId: account.id,
      amount: "1.0",
      recipient: KEY_BOUNDARY_RECIPIENT,
      tokenId: ETH_TOKEN_ID,
      type: "wallet.reviewTransfer",
    },
    sender: extensionSender,
  },
  {
    message: {
      contract: NFT_CONTRACT,
      networkId: "SN_MAIN",
      recipient: KEY_BOUNDARY_RECIPIENT,
      tokenId: "1",
      type: "wallet.reviewNftTransfer",
    },
    sender: extensionSender,
  },
  {
    message: {
      contract: NFT_CONTRACT,
      networkId: "SN_MAIN",
      recipient: KEY_BOUNDARY_RECIPIENT,
      reviewedFee: { overallFee: "1", unit: "FRI" },
      tokenId: "1",
      type: "wallet.transferNft",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ id: ids.allowanceId }),
    message: { id: "", type: "wallet.revokeAllowance" },
    sender: extensionSender,
  },
  { message: { type: "wallet.allowances" }, sender: extensionSender },
  { message: { type: "wallet.activity" }, sender: extensionSender },
  { message: { type: "wallet.transactionAlerts" }, sender: extensionSender },
  {
    message: {
      asset: { address: NFT_CONTRACT, decimals: 18, symbol: "TKN" },
      origin: KEY_BOUNDARY_ORIGIN,
      type: "wallet.watchAsset",
    },
    sender: contentSender,
  },
  ...TOKEN_KEY_BOUNDARY_MESSAGES,
  { message: { type: "wallet.discoverNfts" }, sender: extensionSender },
  { message: { type: "wallet.loadWatchedNfts" }, sender: extensionSender },
  {
    message: { type: "wallet.setNftIndexerUrl", url: "https://indexer.example" },
    sender: extensionSender,
  },
  {
    message: { relayUrl: "wss://relay.example", type: "wallet.setNostrRelayUrl" },
    sender: extensionSender,
  },
  {
    message: { accountId: account.id, label: "Main", type: "wallet.setAccountLabel" },
    sender: extensionSender,
  },
  {
    message: { accountId: account.id, hidden: false, type: "wallet.setAccountHidden" },
    sender: extensionSender,
  },
  { message: { displayCurrency: "usd", type: "wallet.setDisplay" }, sender: extensionSender },
  {
    message: { icon: "folder", name: "Savings", type: "wallet.createGroup" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ id: ids.groupId }),
    message: { id: "", name: "Renamed", type: "wallet.renameGroup" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ id: ids.groupId }),
    message: { icon: "star", id: "", type: "wallet.setGroupIcon" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ groupId: ids.groupId }),
    message: {
      accountId: account.id,
      groupId: "",
      member: true,
      type: "wallet.setAccountInGroup",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ id: ids.groupId }),
    message: { id: "", type: "wallet.removeGroup" },
    sender: extensionSender,
  },
  {
    message: {
      origin: KEY_BOUNDARY_ORIGIN,
      typedData: TYPED_DATA,
      type: "wallet.signTypedData",
    },
    sender: contentSender,
  },
  {
    message: {
      declare: { compiledClassHash: "0x1", contractClass: { sierra_program: ["0x1"] } },
      origin: KEY_BOUNDARY_ORIGIN,
      type: "wallet.addDeclareTransaction",
    },
    sender: contentSender,
  },
  {
    message: {
      contract: NFT_CONTRACT,
      label: "Art",
      networkId: "SN_MAIN",
      tokenId: "2",
      type: "wallet.addNft",
    },
    sender: extensionSender,
  },
  {
    message: {
      chain: {
        chainId: "0x534e5f4d41494e",
        chainName: "Custom",
        id: "custom-main",
        rpcUrls: ["https://rpc.example"],
      },
      origin: KEY_BOUNDARY_ORIGIN,
      type: "wallet.addStarknetChain",
    },
    sender: contentSender,
  },
  {
    message: {
      preferences: { ...defaultWalletPreferences(), theme: "light" },
      type: "wallet.importPreferences",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ id: ids.addressBookId }),
    message: { id: "", type: "wallet.removeAddress" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ id: ids.nftId, spam: true }),
    message: { id: "", spam: true, type: "wallet.setNftSpam" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ id: ids.nftId }),
    message: { id: "", type: "wallet.removeNft" },
    sender: extensionSender,
  },
  {
    message: {
      address: KEY_BOUNDARY_RECIPIENT,
      label: "Desk",
      networkId: "SN_MAIN",
      type: "wallet.saveAddress",
    },
    sender: extensionSender,
  },
  {
    message: {
      apiUrl: "https://explorer.example/v1",
      enabled: false,
      networkId: "SN_MAIN",
      type: "wallet.setExplorerFallback",
    },
    sender: extensionSender,
  },
  {
    message: { networkId: "SN_MAIN", rpcUrl: "https://rpc.example", type: "wallet.setRpcOverride" },
    sender: extensionSender,
  },
  ...MULTISIG_KEY_BOUNDARY_MESSAGES,
  ...STRK20_KEY_BOUNDARY_MESSAGES,
  {
    message: { origin: KEY_BOUNDARY_ORIGIN, type: "wallet.supportedSpecs" },
    sender: contentSender,
  },
  {
    message: { origin: KEY_BOUNDARY_ORIGIN, type: "wallet.supportedWalletApi" },
    sender: contentSender,
  },
  // Negative entries, last so the state they tear down or refuse cannot starve
  // an entry above. Each one is here because refusal is the response being
  // scanned: an error path leaks secrets just as easily as a success path.
  { message: { type: "wallet.lock" }, sender: extensionSender },
  {
    message: { type: "wallet.status" },
    negative: "a content script may not read privileged wallet status",
    sender: contentSender,
  },
  {
    message: { type: "wallet.unlock", vaultPassphrase: "wrong passphrase!!" },
    negative: "a wrong passphrase must not unlock, and must not echo the vault",
    sender: extensionSender,
  },
];
