/**
 * Wires the one shared Ledger onboarding overlay used by both entry points and
 * owns the first-run stash so the side-panel composition stays within its size
 * budget. The DOM `mount` (an overlay outside `#app`, like the sign takeover, so
 * a dashboard repaint never resets an in-flight enumeration) is created by the
 * entrypoint and injected, keeping browser globals out of this module.
 *
 * The first-run "Set up with a Ledger" card stashes the captured network and
 * unlock passphrase here, so the shared `create` branches: with a stash present
 * the FIRST selected account creates a brand-new Ledger-only vault via
 * `createLedgerVault` (dropping the passphrase immediately); every further
 * account in the same multi-select batch, and every add to an already-unlocked
 * wallet, goes through `addLedgerAccount`. The target network is always the
 * candidate account's own network (derived under the active network id), so a
 * multi-select batch never leaks onto the wrong network after the stash clears.
 * No seed or key material is generated on either path — the vault holds none.
 * Per-candidate deployed/balance state comes from the background
 * `ledgerAccountStatus` query, degrading gracefully to "unavailable".
 *
 * Both entry points are gated on the surface first. Every Ledger operation opens
 * a focused browser tab to reach Chrome's device chooser, and a toolbar popup
 * closes when it loses focus, so a flow started from the popup cannot finish.
 * Rather than offer a control that dies on its first click, the overlay explains
 * that and offers the switch. Gating here rather than at each caller means a new
 * entry point cannot forget it — and the first-run passphrase is never captured
 * on a surface that cannot complete the setup it was captured for.
 */
import type { AccountContractType, LedgerAccountRef } from "@bramble/wallet-model/accounts";
import type { RenderData } from "../../app/rendering/render-cache";
import type { SidepanelWallet } from "../../runtime/runtime";
import { errorMessage, isPopupSurface, renderFragment, showToast } from "../../shared/dom";
import { createLedgerOnboardRuntime } from "./onboard-runtime";
import { ledgerSurfaceNotice, ledgerSurfaceSwitched } from "./onboard-views";
import type { LedgerConnector } from "./sign-session";

/**
 * The Ledger onboarding entry surface consumed by the panel shell: `bindTriggers`
 * re-wires the in-shell "Connect a Ledger" control each paint; `startLedgerSetup`
 * captures the first-run network + passphrase and opens the connect overlay;
 * `startAddAccount` opens the add-account chooser for an unlocked wallet.
 */
export type LedgerOnboardEntry = {
  readonly bindTriggers: (app: Element | null) => void;
  readonly startAddAccount: () => void;
  readonly startLedgerSetup: (networkId: string, vaultPassphrase: string) => void;
};

/**
 * Creates the shared Ledger onboarding overlay entry over an injected overlay
 * `mount` and device `connector` (the entrypoint passes the browser Ledger connector).
 * Reads live status through the render `cache` and drives account creation
 * through the panel `wallet`; the injected `addHd` (derive the next HD account)
 * `openImport` (jump to the raw-key form), and `openMultisig` (guided shared
 * account setup) back the chooser's other routes. `refresh` reloads the shell
 * after a successful add so the new account appears. Holds no secret beyond the transient first-run passphrase,
 * which is cleared as soon as the vault is created.
 */
export const createLedgerOnboardEntry = (deps: {
  readonly addHd: (accountContractType: AccountContractType) => Promise<void>;
  readonly cache: RenderData;
  readonly connector: LedgerConnector;
  readonly mount: HTMLElement;
  readonly openImport: () => void;
  readonly openImportSeed: () => void;
  readonly openMultisig: () => void;
  readonly refresh: () => Promise<void>;
  readonly wallet: SidepanelWallet;
}): LedgerOnboardEntry => {
  const {
    addHd,
    cache,
    connector,
    mount,
    openImport,
    openImportSeed,
    openMultisig,
    refresh,
    wallet,
  } = deps;
  let ledgerSetup: {
    readonly networkId: string;
    readonly vaultPassphrase: string;
  } | null = null;

  const create = async (account: LedgerAccountRef): Promise<void> => {
    const setup = ledgerSetup;
    if (setup) {
      // First account of a first-run batch: create the Ledger-only vault, then
      // drop the passphrase so it never lingers past the moment it is needed.
      await wallet.createLedgerVault(
        account.networkId,
        account.derivation.accountIndex,
        account.publicKeyX,
        setup.vaultPassphrase,
        account.accountContractType,
        account.derivation.eip2645application,
      );
      ledgerSetup = null;
      return;
    }
    // The path scheme travels with the candidate so a Ready account is stored
    // at the path it was enumerated (and will be signed) at, never re-derived
    // under Bramble's default scheme.
    await wallet.addLedgerAccount(
      account.networkId,
      account.derivation.accountIndex,
      account.publicKeyX,
      account.accountContractType,
      account.derivation.eip2645application,
    );
  };

  const runtime = createLedgerOnboardRuntime({
    addHd,
    connector,
    create,
    describe: (address, networkId) => wallet.ledgerAccountStatus(address, networkId),
    existingIds: () => new Set(cache.status.accounts.map((stored) => stored.id)),
    mount,
    networkId: () => ledgerSetup?.networkId ?? cache.status.networkId,
    // Dismissing the overlay drops the captured first-run passphrase so a
    // cancelled setup never leaves it sitting in memory (add-account has no
    // stash, so this is a harmless no-op there).
    onCancel: () => {
      ledgerSetup = null;
    },
    openImport,
    openImportSeed,
    openMultisig,
    refresh,
    wallet,
  });

  const dismiss = (): void => {
    mount.replaceChildren();
    mount.hidden = true;
  };

  // Renders the surface notice into the shared overlay and wires its two
  // controls. Returns true when it took over, so callers stop before starting
  // anything — including before stashing a first-run passphrase.
  const blockedByPopupSurface = (): boolean => {
    if (!isPopupSurface(mount)) {
      return false;
    }
    renderFragment(mount, ledgerSurfaceNotice());
    mount.hidden = false;
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-onboard-cancel]")
      ?.addEventListener("click", dismiss);
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-surface-switch]")
      ?.addEventListener("click", () => {
        void wallet.setDisplay({ approvalSurface: "side-panel" }).then(
          () => {
            renderFragment(mount, ledgerSurfaceSwitched());
            mount
              .querySelector<HTMLButtonElement>("[data-ledger-onboard-cancel]")
              ?.addEventListener("click", dismiss);
          },
          (error: unknown) => {
            showToast(errorMessage(error, "Could not switch surface"), "error", mount);
          },
        );
      });
    return true;
  };

  return {
    bindTriggers: (app) => runtime.bindTriggers(app),
    startAddAccount: () => {
      if (blockedByPopupSurface()) {
        return;
      }
      runtime.startAddAccount();
    },
    startLedgerSetup: (networkId, vaultPassphrase) => {
      if (blockedByPopupSurface()) {
        return;
      }
      ledgerSetup = { networkId, vaultPassphrase };
      runtime.start();
    },
  };
};
