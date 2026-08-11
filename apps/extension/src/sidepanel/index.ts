/**
 * Browser-owned side-panel composition root. Hardware access is injected into
 * the presentation package so UI code cannot instantiate transports itself.
 */
import { ledgerConnector } from "@mc-wallet/ledger-browser/connector";
import { startWalletUi } from "@mc-wallet/wallet-ui/start";

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: Parameters<typeof startWalletUi>[1];
};

await startWalletUi(ledgerConnector, (globalThis as ExtensionGlobal).chrome);
