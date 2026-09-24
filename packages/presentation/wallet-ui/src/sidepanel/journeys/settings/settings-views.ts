/**
 * Focused settings and security templates. The dock screen is only a map of
 * destinations; preference controls and recovery actions live on dedicated
 * screens so a security-sensitive task never competes with unrelated options.
 */

import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { button, segmentedControl } from "@bramble/ui-kit/controls";
import { selectField, textField } from "@bramble/ui-kit/fields";
import { menuLink } from "@bramble/ui-kit/navigation";
import type { WalletStatus } from "../../../popup/responses/responses";
import { dockScreen, flowHeader, flowScreen, walletMenuRow } from "../../shared/parts";
import { type BuildInfo, buildInfo } from "../../shell/build-info";

// The build stamp under the menu: extension version, plus the source branch
// when the bundle was built from an unreleased branch. Empty outside a built
// bundle (unit tests), which hides the line entirely.
const buildStampLine = (build: BuildInfo): string =>
  build.version
    ? `<p class="hint" id="settings-build">Version ${escapeHtml(build.version)}${
        build.branch ? ` · ${escapeHtml(build.branch)}` : ""
      }</p>`
    : "";

/**
 * Renders the settings dock as a short, grouped destination map.
 */
export const settingsScreen = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  build: BuildInfo = buildInfo(),
): string =>
  dockScreen(
    "settings",
    `<h2>Settings</h2>
    <section class="section">
      <p class="eyebrow">Accounts & networks</p>
      <div class="menu-list" role="group" aria-label="Accounts and networks">
        ${walletMenuRow("account", "Accounts & groups", "wallet")}
        ${walletMenuRow("network", "Network", "globe", status.network)}
        ${walletMenuRow("address-book", "Address book", "book")}
        ${walletMenuRow("multisigs", "Multisig accounts", "users")}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">Access & permissions</p>
      <div class="menu-list" role="group" aria-label="Access and permissions">
        ${walletMenuRow("security", "Security & permissions", "lock")}
        ${walletMenuRow("connected-sites", "Connected sites", "link")}
        ${walletMenuRow("allowances", "Token allowances", "coins")}
        ${walletMenuRow(
          "request-settings",
          "Request display",
          "activity",
          (preferences?.approvalSurface ?? "side-panel") === "popup" ? "Popup" : "Side panel",
        )}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">Backup & recovery</p>
      <div class="menu-list" role="group" aria-label="Backup and recovery">
        ${walletMenuRow("backup", "Backup & restore", "shield")}
        ${walletMenuRow("reveal", "Reveal recovery secrets", "lock")}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">Preferences</p>
      <div class="menu-list" role="group" aria-label="Wallet preferences">
        ${walletMenuRow(
          "appearance",
          "Appearance & currency",
          "settings",
          (preferences?.displayCurrency ?? "usd").toUpperCase(),
        )}
      </div>
    </section>
    <section class="section">
      <div class="menu-list">
        ${menuLink({
          href: "https://github.com/starknet-innovation/mc-wallet#readme",
          icon: "book",
          label: "Help & docs",
          target: "_blank",
        })}
      </div>
      ${buildStampLine(build)}
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
  flowHeader("Request display", status, "Where a site asks for approval") +
  flowScreen(
    "request-settings",
    `<section class="section">
      ${segmentedControl(
        "Wallet request surface",
        (["side-panel", "popup"] as const).map((surface) => ({
          attributes: { "data-approval-surface": surface },
          label: surface === "side-panel" ? "Wallet panel" : "Compact popup",
          pressed: (preferences?.approvalSurface ?? "side-panel") === surface,
        })),
      )}
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
        ${walletMenuRow("multisigs", "Multisig accounts", "users")}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">This account</p>
      <div class="menu-list" role="group" aria-label="This account">
        ${walletMenuRow("deploy-account", "Deploy account", "rocket")}
      </div>
      <p class="hint">Deploy your account manually</p>
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
        ${
          hasLedgerAccount
            ? '<p class="review-flag" role="note">Ledger accounts are not restored by this backup or by Bramble’s recovery phrase. Recover them with the Ledger device and its Ledger recovery phrase.</p>'
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
