/**
 * The app directory screen (mc-wallet issue 749): Starknet apps Bramble lists
 * for the active network, with a search box, a category filter, and a marker
 * on apps this wallet is already connected to. Every entry is bundled data; an
 * app opens at its listed origin in a new tab, never inside the wallet, and
 * the screen fetches nothing.
 *
 * Hidden while the active network has no listed app: its menu row is withheld
 * and navigating here anyway shows the empty state.
 */
import { escapeHtml } from "@bramble/core/html";
import {
  APP_CATEGORIES,
  APP_DIRECTORY,
  type AppCategory,
  type AppDirectory,
  type ListedApp,
} from "@bramble/permissions/app-directory";
import { emptyState } from "@bramble/ui-kit/content";
import { selectField, textField } from "@bramble/ui-kit/fields";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { ConnectedSitesState } from "../../app/screens/support-flows";
import { icon } from "../../shared/icons";
import { flowHeader, flowScreen } from "../../shared/parts";

/** The directory's name everywhere it is shown. */
export const APP_DIRECTORY_TITLE = "App directory";

const CATEGORY_LABELS: Readonly<Record<AppCategory, string>> = {
  defi: "DeFi",
  gaming: "Gaming",
  infrastructure: "Infrastructure",
  nft: "NFTs",
  payments: "Payments",
  social: "Social",
};

/** Whether the active network has a listed app, which is when the menu offers the screen. */
export const hasListedApps = (
  networkId: StarknetNetworkId,
  directory: AppDirectory = APP_DIRECTORY,
): boolean => directory.appsFor(networkId).length > 0;

const hostOf = (origin: string): string => new URL(origin).host;

const appRow = (app: ListedApp, connected: boolean): string => `
  <li data-app-row data-app-category="${escapeHtml(app.category)}" data-app-search="${escapeHtml(`${app.name} ${hostOf(app.origin)}`.toLowerCase())}">
    <a class="app-entry" href="${escapeHtml(app.origin)}" target="_blank" rel="noopener noreferrer">
      <span class="app-entry-copy">
        <strong>${escapeHtml(app.name)}</strong>
        <span class="hint">${escapeHtml(CATEGORY_LABELS[app.category])} · ${escapeHtml(hostOf(app.origin))}</span>
      </span>
      ${connected ? `<span class="app-connected">${icon("link")}Connected</span>` : ""}
      ${icon("externalLink")}
    </a>
  </li>`;

const connectedOrigins = (sites: ConnectedSitesState): ReadonlySet<string> =>
  new Set(Array.isArray(sites) ? sites.map((site) => site.origin) : []);

const filters = (apps: readonly ListedApp[]): string => {
  const present = APP_CATEGORIES.filter((category) =>
    apps.some((app) => app.category === category),
  );
  return `<div class="app-filters">
    ${textField({
      autocomplete: "off",
      label: "Search apps",
      labelHidden: true,
      name: "app-search",
      placeholder: "Search",
      spellcheck: false,
    })}
    ${selectField({
      label: "Category",
      name: "app-category",
      options: [
        { label: "All", value: "" },
        ...present.map((category) => ({ label: CATEGORY_LABELS[category], value: category })),
      ],
      selected: "",
    })}
  </div>`;
};

/**
 * The app directory screen for the active network. `sites` marks connected
 * apps once the connected-sites read has landed; a pending or failed read
 * marks none rather than guessing.
 */
export const appDirectoryFlow = (
  status: WalletStatus,
  sites: ConnectedSitesState,
  directory: AppDirectory = APP_DIRECTORY,
): string => {
  const apps = directory.appsFor(status.networkId);
  const connected = connectedOrigins(sites);
  return (
    flowHeader(
      APP_DIRECTORY_TITLE,
      status,
      apps.length === 0 ? undefined : `${apps.length} listed`,
    ) +
    flowScreen(
      "apps",
      `<section class="section">
        ${
          apps.length === 0
            ? emptyState("No apps are listed for this network yet.")
            : `<p class="hint">Apps Bramble reviewed for this network. Each opens in a new tab.</p>
              ${filters(apps)}
              <ul class="app-list">${apps.map((app) => appRow(app, connected.has(app.origin))).join("")}</ul>
              <p class="hint" data-app-none hidden>No listed app matches.</p>`
        }
      </section>`,
    )
  );
};
