/**
 * Ledger overlay mounts for the side panel.
 *
 * Both Ledger surfaces render into their own detached overlay rather than the
 * shell, so a full-shell repaint never tears down a device prompt mid-signature.
 * Creating the nodes and their runtimes together keeps that coupling in one
 * place; the panel entry point only wires the callbacks.
 */

import type { RenderData } from "../render-cache";
import type { SidepanelWallet } from "../runtime";
import { createLedgerOnboardEntry } from "./onboard-entry";
import { ledgerConnector } from "./sign-connector";
import { createLedgerSignRuntime } from "./sign-runtime";

/**
 * Collaborators the panel supplies to the Ledger overlays. Each callback is
 * owned by the entry point because it drives navigation, repaints, or toasts.
 */
export type LedgerMountDeps = {
  readonly addHd: () => Promise<void>;
  readonly cache: RenderData;
  readonly onSignatureReported: () => void;
  readonly openImport: () => void;
  readonly openMultisig: () => void;
  readonly refresh: () => Promise<void>;
  readonly wallet: SidepanelWallet;
};

/**
 * The live Ledger runtimes, already mounted into the document.
 */
export type LedgerMounts = {
  readonly onboard: ReturnType<typeof createLedgerOnboardEntry>;
  readonly sign: ReturnType<typeof createLedgerSignRuntime>;
};

const overlay = (className: string): HTMLDivElement => {
  const mount = document.createElement("div");
  mount.className = className;
  mount.hidden = true;
  document.body.append(mount);
  return mount;
};

/**
 * Creates both Ledger overlays and their runtimes, appending each mount to the
 * document body.
 */
export const createLedgerMounts = (deps: LedgerMountDeps): LedgerMounts => ({
  onboard: createLedgerOnboardEntry({
    addHd: deps.addHd,
    cache: deps.cache,
    connector: ledgerConnector,
    mount: overlay("ledger-onboard-overlay"),
    openImport: deps.openImport,
    openMultisig: deps.openMultisig,
    refresh: deps.refresh,
    wallet: deps.wallet,
  }),
  sign: createLedgerSignRuntime({
    connector: ledgerConnector,
    mount: overlay("ledger-sign-overlay"),
    onSignatureReported: deps.onSignatureReported,
    status: () => deps.cache.status,
    wallet: deps.wallet,
  }),
});
