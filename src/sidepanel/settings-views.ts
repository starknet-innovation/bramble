/**
 * Focused settings and security templates. The dock screen is only a map of
 * destinations; preference controls and recovery actions live on dedicated
 * screens so a security-sensitive task never competes with unrelated options.
 */
import type { WalletStatus } from "../popup/responses";
import type { WalletPreferences } from "../storage/preferences-store";
import { button, segmentedControl } from "../ui/controls";
import { selectField, textField } from "../ui/fields";
import { menuLink } from "../ui/navigation";
import { dockScreen, flowHeader, flowScreen, walletMenuRow } from "./parts";

/**
 * Renders the settings dock as a short, grouped destination map.
 */
export const settingsScreen = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string =>
  dockScreen(
    "settings",
    `<h2>Settings</h2>
    <section class="section">
      <p class="eyebrow">Wallet</p>
      <div class="menu-list" role="group" aria-label="Wallet settings">
        ${walletMenuRow("account", "Accounts & groups", "wallet")}
        ${walletMenuRow("network", "Network", "globe", status.network)}
        ${walletMenuRow("address-book", "Address book", "book")}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">Experience</p>
      <div class="menu-list" role="group" aria-label="Wallet experience">
        ${walletMenuRow(
          "appearance",
          "Appearance & currency",
          "settings",
          (preferences?.displayCurrency ?? "usd").toUpperCase(),
        )}
        ${walletMenuRow(
          "request-settings",
          "Wallet requests",
          "activity",
          (preferences?.approvalSurface ?? "side-panel") === "popup" ? "Popup" : "Side panel",
        )}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">Trust & recovery</p>
      <div class="menu-list" role="group" aria-label="Trust and recovery">
        ${walletMenuRow("security", "Security & permissions", "shield")}
      </div>
    </section>
    <section class="section">
      <div class="menu-list">
        ${menuLink({
          href: "https://github.com/mc-wallet/mc-wallet#readme",
          icon: "book",
          label: "Help & docs",
          target: "_blank",
        })}
      </div>
    </section>`,
  );

/**
 * Renders theme and display-currency controls on their own preference screen.
 */
export const appearanceFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string =>
  flowHeader("Appearance & currency", status, "How the wallet looks and values assets") +
  flowScreen(
    "appearance",
    `<section class="section">
      <p class="eyebrow">Theme</p>
      ${segmentedControl(
        "Theme",
        (["dark", "light"] as const).map((theme) => ({
          attributes: { "data-theme-id": theme },
          label: theme === "light" ? "Light" : "Dark",
          pressed: (preferences?.theme === "light" ? "light" : "dark") === theme,
        })),
      )}
    </section>
    <section class="section">
      <p class="eyebrow">Values</p>
      ${selectField({
        attributes: { id: "currency-select" },
        hint: "Prices and portfolio totals use this display currency. Token balances remain unchanged.",
        label: "Display currency",
        name: "displayCurrency",
        options: (["usd", "eur", "gbp"] as const).map((currency) => ({
          label: currency.toUpperCase(),
          value: currency,
        })),
        selected: preferences?.displayCurrency ?? "usd",
      })}
    </section>
    <p id="display-result" role="status"></p>`,
  );

/**
 * Renders the one request-surface preference with explicit behavior copy.
 */
export const requestSettingsFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string =>
  flowHeader("Wallet requests", status, "Where a dApp asks for approval") +
  flowScreen(
    "request-settings",
    `<section class="section">
      <p class="lede">New requests always take focus so they cannot hide behind another wallet screen.</p>
      ${segmentedControl(
        "Wallet request surface",
        (["side-panel", "popup"] as const).map((surface) => ({
          attributes: { "data-approval-surface": surface },
          label: surface === "side-panel" ? "Side panel" : "Toolbar popup",
          pressed: (preferences?.approvalSurface ?? "side-panel") === surface,
        })),
      )}
      <p class="hint">Side panel keeps the request beside the site. Popup opens a compact wallet window above the current tab.</p>
    </section>
    <p id="display-result" role="status"></p>`,
  );

/**
 * Renders the security hub as destinations grouped by what they protect.
 */
export const securityFlow = (status: WalletStatus): string =>
  flowHeader("Security & permissions", status, "Review access before recovery") +
  flowScreen(
    "security",
    `<section class="section">
      <p class="eyebrow">External access</p>
      <div class="menu-list" role="group" aria-label="External access">
        ${walletMenuRow("connected-sites", "Connected sites", "link")}
        ${walletMenuRow("allowances", "Token allowances", "coins")}
        ${walletMenuRow("multisigs", "Multisigs", "users")}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">Recovery</p>
      <div class="menu-list" role="group" aria-label="Recovery">
        ${walletMenuRow("backup", "Backup & restore", "shield")}
        ${walletMenuRow("reveal", "Reveal recovery secrets", "lock")}
      </div>
    </section>`,
  );

/**
 * Renders the backup choice before either export or restore changes state.
 */
export const backupHubFlow = (status: WalletStatus): string => {
  const hasLedgerAccount = status.accounts.some((account) => account.derivation.kind === "ledger");
  return (
    flowHeader("Backup & restore", status, "Choose one focused task") +
    flowScreen(
      "backup",
      `<section class="section">
        <div class="menu-list" role="group" aria-label="Backup and restore">
          ${walletMenuRow("backup-export", "Download wallet backup", "receive")}
          ${walletMenuRow("backup-restore", "Restore from a backup", "refresh")}
        </div>
        <p class="hint">Backups include preferences, labels, contacts, and tracked assets. They never include your recovery phrase or private keys.</p>
        ${
          hasLedgerAccount
            ? '<p class="review-flag" role="note">Ledger accounts are not restored by this backup or by MC Wallet’s recovery phrase. Recover them with the Ledger device and its Ledger recovery phrase.</p>'
            : ""
        }
      </section>`,
    )
  );
};

/**
 * Renders the non-secret preference export task.
 */
export const backupExportFlow = (status: WalletStatus): string =>
  flowHeader("Download backup", status, "Preferences and wallet organization") +
  flowScreen(
    "backup-export",
    `<section class="section">
      <p class="lede">Download an encrypted-vault-free JSON copy of tokens, contacts, labels, groups, and display settings.</p>
      <p class="hint">Recovery phrases, imported private keys, and Ledger key material are never included.</p>
      ${button({
        attributes: { id: "backup-export" },
        icon: "receive",
        label: "Download backup",
      })}
      <p id="backup-result" role="status"></p>
    </section>`,
  );

/**
 * Renders backup restore as an isolated replacement task.
 */
export const backupRestoreFlow = (status: WalletStatus): string =>
  flowHeader("Restore backup", status, "Replace preferences from a trusted file") +
  flowScreen(
    "backup-restore",
    `<section class="section">
      <p class="review-flag" role="note">Restoring replaces the wallet’s current preferences, labels, contacts, and tracked assets. It does not change accounts or signing keys.</p>
      ${textField({
        accept: "application/json",
        attributes: { id: "backup-file" },
        label: "Backup file",
        name: "backupFile",
        type: "file",
      })}
      ${button({
        attributes: { id: "backup-import" },
        icon: "check",
        label: "Restore this backup",
      })}
      <p id="backup-result" role="status"></p>
    </section>`,
  );
