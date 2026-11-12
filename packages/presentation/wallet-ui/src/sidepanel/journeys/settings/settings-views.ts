/**
 * Focused settings and security templates. The dock screen is only a map of
 * destinations; preference controls and recovery actions live on dedicated
 * screens so a security-sensitive task never competes with unrelated options.
 */

import { escapeHtml } from "@bramble/core/html";
import { nftsShown, type WalletPreferences } from "@bramble/settings/preferences";
import { stakingNetwork } from "@bramble/transactions/staking-networks";
import { button, segmentedControl } from "@bramble/ui-kit/controls";
import { checkboxField, selectField, textField } from "@bramble/ui-kit/fields";
import { menuLink } from "@bramble/ui-kit/navigation";
import { t, th } from "../../../i18n/messages";
import type { WalletStatus } from "../../../popup/responses/responses";
import { dockScreen, flowHeader, flowScreen, walletMenuRow } from "../../shared/parts";
import { type BuildInfo, buildInfo } from "../../shell/build-info";
import { SHADOW_ACCOUNTS_TITLE } from "../privacy/shadow-accounts-copy";
import { languageRowValue } from "./language-ui";
import { privacyUnlockTitle } from "./privacy-unlock";

// The build stamp under the menu: extension version, plus the source branch
// when the bundle was built from an unreleased branch. Empty outside a built
// bundle (unit tests), which hides the line entirely.
const buildStampLine = (build: BuildInfo): string =>
  build.version
    ? `<p class="hint" id="settings-build">${th("settings.dock.version", { version: build.version })}${
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
    `<h2>${th("settings.dock.title")}</h2>
    <section class="section">
      <p class="eyebrow">${th("settings.dock.accountsNetworks")}</p>
      <div class="menu-list" role="group" aria-label="${th("settings.dock.accountsNetworksLabel")}">
        ${walletMenuRow("account", t("settings.dock.accounts"), "wallet")}
        ${walletMenuRow("network", t("settings.dock.network"), "globe", status.network)}
        ${walletMenuRow("address-book", t("settings.dock.addressBook"), "book")}
        ${walletMenuRow("multisigs", t("settings.dock.multisigs"), "users")}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">${th("settings.dock.thisAccount")}</p>
      <div class="menu-list" role="group" aria-label="${th("settings.dock.thisAccount")}">
        ${walletMenuRow("deploy-account", t("settings.dock.deployAccount"), "rocket")}
        ${walletMenuRow("privacy-unlock", privacyUnlockTitle(), "lock")}
        ${stakingNetwork(status.networkId) ? walletMenuRow("staking", t("settings.dock.staking"), "trendingUp") : ""}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">${th("settings.dock.access")}</p>
      <div class="menu-list" role="group" aria-label="${th("settings.dock.accessLabel")}">
        ${walletMenuRow("connected-sites", t("settings.dock.connectedSites"), "link")}
        ${walletMenuRow("allowances", t("settings.dock.allowances"), "coins")}
        ${walletMenuRow("shadow-accounts", SHADOW_ACCOUNTS_TITLE, "shield")}
        ${walletMenuRow(
          "request-settings",
          t("settings.request.title"),
          "activity",
          (preferences?.approvalSurface ?? "side-panel") === "popup"
            ? t("settings.request.popup")
            : t("settings.request.sidePanel"),
        )}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">${th("settings.dock.backup")}</p>
      <div class="menu-list" role="group" aria-label="${th("settings.dock.backupLabel")}">
        ${walletMenuRow("backup", t("settings.backup.hubTitle"), "shield")}
        ${walletMenuRow("reveal", t("settings.reveal.title"), "lock")}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">${th("settings.dock.preferences")}</p>
      <div class="menu-list" role="group" aria-label="${th("settings.dock.preferencesLabel")}">
        ${walletMenuRow("language", t("settings.language.title"), "languages", languageRowValue(preferences))}
        ${walletMenuRow(
          "appearance",
          t("settings.appearance.title"),
          "settings",
          (preferences?.displayCurrency ?? "usd").toUpperCase(),
        )}
      </div>
    </section>
    <section class="section">
      <div class="menu-list">
        ${menuLink({
          href: "https://github.com/starknet-innovation/bramble#readme",
          icon: "book",
          label: t("settings.dock.help"),
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
  flowHeader(t("settings.appearance.title"), status) +
  flowScreen(
    "appearance",
    `<section class="section">
      <p class="eyebrow">${th("settings.appearance.theme")}</p>
      ${segmentedControl(
        t("settings.appearance.theme"),
        (["dark", "light"] as const).map((theme) => ({
          attributes: { "data-theme-id": theme },
          label: theme === "light" ? t("settings.appearance.light") : t("settings.appearance.dark"),
          pressed: (preferences?.theme === "light" ? "light" : "dark") === theme,
        })),
      )}
    </section>
    <section class="section">
      <p class="eyebrow">${th("settings.appearance.values")}</p>
      ${selectField({
        attributes: { id: "currency-select" },
        label: t("settings.appearance.currency"),
        name: "displayCurrency",
        options: (["usd", "eur", "gbp"] as const).map((currency) => ({
          label: currency.toUpperCase(),
          value: currency,
        })),
        selected: preferences?.displayCurrency ?? "usd",
      })}
    </section>
    <section class="section">
      <p class="eyebrow">${th("settings.appearance.home")}</p>
      ${checkboxField({
        attributes: { id: "vip-notice-toggle" },
        checked: preferences?.vipNotice !== false,
        name: "vipNotice",
        text: t("settings.appearance.showVip"),
      })}
      ${checkboxField({
        attributes: { id: "nfts-on-home" },
        checked: nftsShown(preferences),
        name: "collectiblesPreview",
        text: t("settings.appearance.showNfts"),
      })}
      <p class="hint">${th("settings.appearance.nftsHint")}</p>
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
  flowHeader(t("settings.request.title"), status, t("settings.request.subtitle")) +
  flowScreen(
    "request-settings",
    `<section class="section">
      ${segmentedControl(
        t("settings.request.surface"),
        (["side-panel", "popup"] as const).map((surface) => ({
          attributes: { "data-approval-surface": surface },
          label:
            surface === "side-panel"
              ? t("settings.request.panel")
              : t("settings.request.compactPopup"),
          pressed: (preferences?.approvalSurface ?? "side-panel") === surface,
        })),
      )}
    </section>
    <p id="display-result" role="status"></p>`,
  );

/**
 * Renders the backup choice before either export or restore changes state.
 */
export const backupHubFlow = (status: WalletStatus): string => {
  const hasLedgerAccount = status.accounts.some((account) => account.derivation.kind === "ledger");
  return (
    flowHeader(t("settings.backup.hubTitle"), status) +
    flowScreen(
      "backup",
      `<section class="section">
        <div class="menu-list" role="group" aria-label="${th("settings.backup.hubLabel")}">
          ${walletMenuRow("backup-export", t("settings.backup.exportTitle"), "receive")}
          ${walletMenuRow("backup-restore", t("settings.backup.restoreTitle"), "refresh")}
        </div>
        ${
          hasLedgerAccount
            ? `<p class="review-flag" role="note">${th("settings.backup.ledgerNote")}</p>`
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
  flowHeader(t("settings.backup.exportTitle"), status, t("settings.backup.exportSubtitle")) +
  flowScreen(
    "backup-export",
    `<section class="section">
      <p class="hint">${th("settings.backup.exportHint")}</p>
      ${button({
        attributes: { id: "backup-export" },
        icon: "receive",
        label: t("settings.backup.download"),
      })}
      <p id="backup-result" role="status"></p>
    </section>`,
  );

/**
 * Renders backup restore as an isolated replacement task.
 */
export const backupRestoreFlow = (status: WalletStatus): string =>
  flowHeader(t("settings.backup.restoreTitle"), status, t("settings.backup.restoreSubtitle")) +
  flowScreen(
    "backup-restore",
    `<section class="section">
      ${textField({
        accept: "application/json",
        attributes: { id: "backup-file" },
        label: t("settings.backup.file"),
        name: "backupFile",
        type: "file",
      })}
      ${button({
        attributes: { id: "backup-import" },
        icon: "check",
        label: t("settings.backup.restore"),
      })}
      <p id="backup-result" role="status"></p>
    </section>`,
  );
