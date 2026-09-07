import { badge, callout, emptyState, pill, toast } from "@bramble/ui-kit/content";
import type { Meta } from "@storybook/html-vite";
import {
  CATALOG_META,
  type CatalogArgs,
  type CatalogStory,
  catalogFrame,
} from "../../runtime/catalog-frame";
import { catalogGroup, catalogSample } from "../../runtime/catalog-markup";

const meta = {
  ...CATALOG_META,
  title: "Design system/03 Feedback",
} satisfies Meta<CatalogArgs>;

export default meta;

export const Callouts: CatalogStory = {
  render: (args) =>
    catalogFrame(
      "Callouts",
      "Callouts surface waiting, recovery, and trust context without turning every message into an alarm.",
      catalogGroup(
        "Information and action",
        "Copy states the condition and the next useful action.",
        `<div class="catalog-grid wide">
          ${catalogSample("Informational", callout({ body: "Review before any site can see your accounts.", icon: "link", title: "Connection request waiting" }))}
          ${catalogSample("Recoverable", callout({ action: { icon: "refresh", label: "Try again", size: "small", variant: "secondary" }, body: "The RPC did not return a fee estimate. Check the endpoint before signing.", icon: "alert", role: "alert", title: "Fee estimate unavailable" }))}
        </div>`,
      ),
      args.theme,
    ),
};

export const EmptyStates: CatalogStory = {
  name: "Empty states",
  render: (args) =>
    catalogFrame(
      "Empty states",
      "Empty and degraded states explain what is absent, whether that is expected, and where it can appear.",
      catalogGroup(
        "States",
        "Messages remain quiet until the user has a concrete recovery action.",
        `<div class="catalog-grid wide">
          ${catalogSample("Expected empty", emptyState("No activity yet. Transactions for this account appear here."))}
          ${catalogSample("Degraded", emptyState("On-chain history is unavailable. Showing transactions recorded on this device only.", "status"))}
        </div>`,
      ),
      args.theme,
    ),
};

export const PillsAndBadges: CatalogStory = {
  name: "Pills and badges",
  render: (args) =>
    catalogFrame(
      "Pills and badges",
      "Compact markers provide context without competing with the primary action.",
      catalogGroup(
        "Context markers",
        "Network, hardware provenance, status, and bounded counts use one visual vocabulary.",
        `<div class="catalog-row">
          ${pill("Starknet Mainnet", { dot: true })}
          ${pill("Hardware", { icon: "shield", tone: "hardware" })}
          ${pill("Deployed")}
          <span class="tab-icon">Activity${badge(3)}</span>
        </div>`,
      ),
      args.theme,
    ),
};

export const Toasts: CatalogStory = {
  render: (args) =>
    catalogFrame(
      "Toasts",
      "Transient feedback confirms completion or names a recoverable failure. Runtime timing and swipe behavior remain in the audited DOM boundary.",
      catalogGroup(
        "Semantic feedback",
        "Long errors wrap for readability while the copy action retains the complete diagnostic.",
        `<div class="catalog-stack catalog-card-limit">
          ${toast("Transaction submitted. Tracking confirmation now.", "success")}
          ${toast("Argent multisig intent nonce is no longer current", "error")}
          ${toast("Reached 1 of 2 co-signers. Share again to retry the remaining delivery.", "error")}
        </div>`,
      ),
      args.theme,
    ),
};
