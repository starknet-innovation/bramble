/**
 * Wires the one shared Ledger onboarding overlay used by both entry points and
 * owns the first-run stash so `src/sidepanel/index.ts` stays within its size
 * budget. The DOM `mount` (an overlay outside `#app`, like the sign takeover, so
 * a dashboard repaint never resets an in-flight enumeration) is created by the
 * entrypoint and injected, keeping browser globals out of this module.
 *
 * The first-run "Set up with a Ledger" card stashes the captured network and
 * unlock passphrase here, so the shared `create` branches: with a stash present
 * it creates a brand-new Ledger-only vault via `createLedgerVault`; otherwise it
 * adds a keyless account to the already-unlocked wallet via `addLedgerAccount`.
 * No seed or key material is generated on either path — the vault holds none.
 * Per-candidate deployed/balance state comes from the background
 * `ledgerAccountStatus` query, degrading gracefully to "unavailable".
 */
import type { RenderData } from "../render-cache";
import type { SidepanelWallet } from "../runtime";
import { createLedgerOnboardRuntime } from "./onboard-runtime";
import type { LedgerConnector } from "./sign-session";

/**
 * The Ledger onboarding entry surface consumed by the panel shell: `bindTriggers`
 * re-wires the in-shell "Connect a Ledger" control each paint; `startLedgerSetup`
 * captures the first-run network + passphrase and opens the connect overlay.
 */
export type LedgerOnboardEntry = {
  readonly bindTriggers: (app: Element | null) => void;
  readonly startLedgerSetup: (networkId: string, vaultPassphrase: string) => void;
};

/**
 * Creates the shared Ledger onboarding overlay entry over an injected overlay
 * `mount` and device `connector` (the entrypoint passes the WebHID connector).
 * Reads live status through the render `cache` and drives account creation through
 * the panel `wallet`; `refresh` reloads the shell after a successful add so the
 * new account appears. Holds no secret beyond the transient first-run passphrase,
 * which is cleared as soon as the vault is created.
 */
export const createLedgerOnboardEntry = (deps: {
  readonly cache: RenderData;
  readonly connector: LedgerConnector;
  readonly mount: HTMLElement;
  readonly refresh: () => Promise<void>;
  readonly wallet: SidepanelWallet;
}): LedgerOnboardEntry => {
  const { cache, connector, mount, refresh, wallet } = deps;
  let ledgerSetup: { readonly networkId: string; readonly vaultPassphrase: string } | null = null;

  const runtime = createLedgerOnboardRuntime({
    connector,
    create: async (accountIndex, publicKeyX) => {
      const setup = ledgerSetup;
      if (setup) {
        await wallet.createLedgerVault(
          setup.networkId,
          accountIndex,
          publicKeyX,
          setup.vaultPassphrase,
        );
        ledgerSetup = null;
        return;
      }
      await wallet.addLedgerAccount(cache.status.networkId, accountIndex, publicKeyX);
    },
    describe: (address, networkId) => wallet.ledgerAccountStatus(address, networkId),
    existingIds: () => new Set(cache.status.accounts.map((stored) => stored.id)),
    mount,
    networkId: () => ledgerSetup?.networkId ?? cache.status.networkId,
    refresh,
    wallet,
  });

  return {
    bindTriggers: (app) => runtime.bindTriggers(app),
    startLedgerSetup: (networkId, vaultPassphrase) => {
      ledgerSetup = { networkId, vaultPassphrase };
      runtime.start();
    },
  };
};
