/**
 * The label a paused or resumed task is named by. Presentation-only: navigation
 * still validates against `WALLET_VIEWS` in ./parts. Shadow accounts keep the
 * privacy journey's own title.
 */
import { t, type UiMessageKey } from "../../i18n/messages";
import { SHADOW_ACCOUNTS_TITLE } from "../journeys/privacy/shadow-accounts-copy";
import type { WalletView } from "./parts";

const WALLET_VIEW_LABELS: Readonly<
  Record<Exclude<WalletView, "shadow-accounts">, Extract<UiMessageKey, `shell.view.${string}`>>
> = {
  account: "shell.view.account",
  activity: "shell.view.activity",
  "address-book": "shell.view.addressBook",
  allowances: "shell.view.allowances",
  staking: "shell.view.staking",
  "advanced-network": "shell.view.advancedNetwork",
  appearance: "shell.view.appearance",
  language: "shell.view.language",
  backup: "shell.view.backup",
  "backup-export": "shell.view.backupExport",
  "backup-restore": "shell.view.backupRestore",
  "find-accounts": "shell.view.findAccounts",
  "connected-sites": "shell.view.connectedSites",
  "deploy-account": "shell.view.deployAccount",
  "privacy-unlock": "shell.view.privacyUnlock",
  home: "shell.view.home",
  "import-key": "shell.view.importKey",
  "import-phrase": "shell.view.importPhrase",
  multisigs: "shell.view.multisigs",
  "multisig-add": "shell.view.multisigAdd",
  "multisig-deploy": "shell.view.multisigDeploy",
  "multisig-detail": "shell.view.multisigDetail",
  "multisig-home": "shell.view.multisigHome",
  "multisig-propose": "shell.view.multisigPropose",
  "multisig-receive": "shell.view.multisigReceive",
  "multisig-signers": "shell.view.multisigSigners",
  "multisig-track": "shell.view.multisigTrack",
  "multisig-watch": "shell.view.multisigWatch",
  network: "shell.view.network",
  nfts: "shell.view.nfts",
  "nft-detail": "shell.view.nftDetail",
  "nft-hidden": "shell.view.nftHidden",
  "nft-send": "shell.view.nftSend",
  "nft-watch": "shell.view.nftWatch",
  privacy: "shell.view.privacy",
  receive: "shell.view.receive",
  requests: "shell.view.requests",
  "request-settings": "shell.view.requestSettings",
  reveal: "shell.view.reveal",
  send: "shell.view.send",
  settings: "shell.view.settings",
  swap: "shell.view.swap",
  tokens: "shell.view.tokens",
  "token-add": "shell.view.tokenAdd",
  "token-catalog": "shell.view.tokenCatalog",
  "token-detail": "shell.view.tokenDetail",
  "token-discover": "shell.view.tokenDiscover",
};

/**
 * Returns the stable human label used when a task is paused or resumed. This
 * mapping is presentation-only; navigation still validates against
 * {@link WALLET_VIEWS}.
 */
export const walletViewLabel = (view: WalletView): string =>
  view === "shadow-accounts" ? SHADOW_ACCOUNTS_TITLE : t(WALLET_VIEW_LABELS[view]);
