/**
 * Browser-owned side-panel composition root. Hardware access and the wall
 * clock are injected into the presentation package so UI code cannot
 * instantiate transports or read time itself.
 */
import { ledgerConnector } from "@bramble/ledger-browser/connector";
import { startWalletUi } from "@bramble/wallet-ui/start";
import { resolveExtensionApi } from "../extension-api";

await startWalletUi(
  ledgerConnector,
  resolveExtensionApi<NonNullable<Parameters<typeof startWalletUi>[1]>>(),
  () => Date.now(),
);
