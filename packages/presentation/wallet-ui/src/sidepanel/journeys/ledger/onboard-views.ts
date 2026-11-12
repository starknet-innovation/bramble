/**
 * Pure templates for the Ledger onboarding subflow: the add-account chooser
 * (HD / import / Connect Ledger), the connect
 * and reading device states, the onboarding error state, and the multi-index
 * account picker showing each candidate's address and on-chain status in the
 * recovery-phrase picker's words. Logic-free string builders; all dynamic text is escaped and all
 * bindings live in the onboarding UI binder.
 *
 * The chooser and the connect/reading/error states share one vertically-centred
 * overlay shell (`onboard-hero`) so they read as deliberate, evenly-spaced
 * screens instead of content bunched at the top; the picker keeps a top-aligned,
 * scrollable layout because its list can grow past the viewport. All spacing is
 * drawn from the scale tokens in the stylesheet — no inline pixel values here.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { menuRow } from "@bramble/ui-kit/navigation";
import {
  LEDGER_EIP2645_APPLICATION,
  type LedgerEip2645Application,
  READY_EIP2645_APPLICATION,
} from "@bramble/wallet-model/ledger-path";
import { t, th } from "../../../i18n/messages";
import { icon } from "../../shared/icons";
import { accountLabel, accountsDetectedText } from "../../shared/parts";
import type { LedgerOnboardAddKind } from "./onboard-session";
import {
  type LedgerCandidate,
  ledgerCandidateActive,
  ledgerCandidateSelectable,
} from "./onboard-types";
import type { LedgerDeviceChoice } from "./sign-session";

// The dismiss control rendered in every onboarding state so the full-screen
// overlay can always be exited (chooser / connect / reading / picker / error) —
// returning the user to the screen behind it (first-run choice or the account
// screen) and, on first run, clearing the captured setup unlock secret.
const ledgerOnboardCancel = (): string =>
  button({
    attributes: { "data-ledger-onboard-cancel": true },
    label: t("ledger.cancel"),
    size: "small",
    variant: "ghost",
  });

// The shared vertically-centred overlay shell: a brand chip, a heading block,
// and the state's actions, stacked with the overlay's scale-token rhythm and
// centred in the panel viewport.
const onboardHero = (chip: string, head: string, actions: string): string => `
  <div class="onboard-hero">
    <span class="gate-brand">${chip}</span>
    <div class="gate-head">${head}</div>
    <div class="onboard-actions">${actions}</div>
  </div>`;

// One chooser tile: a single click routes immediately — no separate
// select-then-confirm step. The chevron marks each tile as a direct action.
// Label and supporting text are plain catalog text, escaped here.
const chooserOption = (
  kind: LedgerOnboardAddKind,
  iconName: "book" | "link" | "shield" | "users" | "wallet",
  label: string,
  supportingText: string,
): string => `
    <button class="add-account-option" data-add-kind="${kind}" type="button">
      <span class="add-account-option-icon">${icon(iconName)}</span>
      <span class="add-account-option-copy"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(supportingText)}</span></span>
      <span class="add-account-option-check">${icon("chevronRight")}</span>
    </button>`;

/**
 * The shared add-account chooser used by both the account drawer and Manage
 * accounts. Each tile routes on its own click. `ledgerAvailable` false omits
 * the Ledger route on a runtime that cannot reach a device; it defaults to true
 * so a caller that does not report capability keeps the offered state.
 */
export const addAccountChooser = (ledgerAvailable = true): string => {
  return `
  <div class="onboard-hero add-account-hero">
    <header class="add-account-header">
      <h1>${th("ledger.add.title")}</h1>
      ${iconButton({
        attributes: { "data-ledger-onboard-cancel": true },
        icon: "x",
        label: t("ledger.add.close"),
        variant: "ghost",
      })}
    </header>
    <div class="add-account-chooser" role="group" aria-label="${th("ledger.add.group")}">
      ${chooserOption("regular", "wallet", t("ledger.add.regular"), t("ledger.add.regularHint"))}
      ${ledgerAvailable ? chooserOption("ledger", "shield", t("ledger.add.ledger"), t("ledger.add.ledgerHint")) : ""}
      ${chooserOption("multisig", "users", t("ledger.add.multisig"), t("ledger.add.multisigHint"))}
      ${chooserOption("import", "link", t("ledger.add.import"), t("ledger.add.importHint"))}
    </div>
  </div>`;
};

/**
 * The in-wallet second stage of "Import an existing account": a recovery
 * phrase (retained for later re-derivation, with its own scan), a single raw
 * private key, or a Ledger account created in Ready — all three bring over an
 * account the user already owns, which is what separates them from the tiles
 * that create one. The plain Ledger route stays on the chooser above, since it
 * also creates accounts on Bramble's own derivation path. `ledgerAvailable`
 * false omits the Ready Ledger route on a runtime that cannot reach a device.
 * `phraselessNote` is set when a wallet with no recovery phrase was sent here
 * from "Regular account": it says why, and the rescan, which needs that
 * phrase, is left out.
 */
export const importAccountChooser = (ledgerAvailable = true, phraselessNote?: string): string => {
  return `
  <div class="onboard-hero add-account-hero">
    <header class="add-account-header">
      <h1>${th("ledger.import.title")}</h1>
      ${iconButton({
        attributes: { "data-ledger-onboard-cancel": true },
        icon: "x",
        label: t("ledger.add.close"),
        variant: "ghost",
      })}
    </header>
    ${phraselessNote ? `<p class="hint" role="status">${escapeHtml(phraselessNote)}</p>` : ""}
    <div class="add-account-chooser" role="group" aria-label="${th("ledger.import.title")}">
      ${phraselessNote ? "" : chooserOption("find-accounts", "users", t("ledger.import.find"), t("ledger.import.findHint"))}
      ${chooserOption("import-phrase", "book", t("ledger.import.phrase"), t("ledger.import.phraseHint"))}
      ${chooserOption("import-key", "link", t("ledger.import.key"), t("ledger.import.keyHint"))}
      ${ledgerAvailable ? chooserOption("restore-ready-ledger", "shield", t("ledger.import.ready"), t("ledger.import.readyHint")) : ""}
    </div>
    <div class="onboard-actions">
      ${button({
        attributes: { "data-add-back": true },
        label: t("ledger.back"),
        variant: "ghost",
      })}
    </div>
  </div>`;
};

/**
 * The pre-picker connect state: it needs a user gesture (the browser's device
 * picker), so it leads with the primary connect action. Centred in the overlay
 * shell with a Cancel escape hatch.
 */
export const ledgerConnectPrompt = (): string =>
  onboardHero(
    icon("shield"),
    `<h1>${th("ledger.connect.title")}</h1>
      <p class="lede">${th("ledger.connect.lede")}</p>`,
    `${button({
      attributes: { "data-ledger-onboard-connect": true },
      icon: "shield",
      label: t("ledger.connect.title"),
    })}
      ${ledgerOnboardCancel()}`,
  );

/**
 * The silent enumeration progress state, centred in the overlay shell.
 */
export const ledgerReadingPrompt = (): string =>
  onboardHero(
    icon("shield"),
    `<h1>${th("ledger.reading.title")}</h1>
      <p class="lede">${th("ledger.reading.lede")}</p>`,
    ledgerOnboardCancel(),
  );

/**
 * Device chooser shown only when more than one origin-granted Ledger is
 * connected. Each button carries an opaque side-panel-local id; labels contain
 * device model/order only, never account or key material.
 */
export const ledgerDevicePicker = (devices: readonly LedgerDeviceChoice[]): string =>
  onboardHero(
    icon("shield"),
    `<h1>${th("ledger.device.title")}</h1>
      <p class="lede">${th("ledger.device.lede")}</p>`,
    `<div class="add-account-chooser" role="group" aria-label="${th("ledger.device.group")}">
      ${devices
        .map((device) =>
          menuRow({
            attributes: { "data-ledger-device": device.id },
            icon: "shield",
            label: device.label,
          }),
        )
        .join("")}
    </div>
    ${ledgerOnboardCancel()}`,
  );

/**
 * Shown instead of starting a Ledger flow when the wallet is running in the
 * toolbar popup. Connecting a Ledger opens a focused browser tab, which closes
 * the popup and strands the flow, so the overlay explains that and offers the
 * one action that fixes it rather than letting the user start something that
 * cannot complete.
 */
export const ledgerSurfaceNotice = (): string =>
  onboardHero(
    icon("lock"),
    `<h1>${th("ledger.surface.title")}</h1>
      <p class="hint">${th("ledger.surface.copy")}</p>`,
    `${button({
      attributes: { "data-ledger-surface-switch": true },
      icon: "link",
      label: t("ledger.surface.switch"),
    })}
      ${ledgerOnboardCancel()}`,
  );

/**
 * Confirms the surface switch. The popup cannot raise the side panel itself —
 * that needs a toolbar gesture — so this says what to do next rather than
 * leaving the user on a dead end.
 */
export const ledgerSurfaceSwitched = (): string =>
  onboardHero(
    icon("check"),
    `<h1>${th("ledger.surface.switchedTitle")}</h1>
      <p class="hint">${th("ledger.surface.switchedCopy")}</p>`,
    ledgerOnboardCancel(),
  );

/**
 * A device error during onboarding, with the catalog message and a retry,
 * centred in the overlay shell.
 */
export const ledgerOnboardError = (message: string): string =>
  onboardHero(
    icon("alert"),
    `<h1>${th("ledger.error.title")}</h1>
      <p class="review-flag">${escapeHtml(message)}</p>`,
    `${button({
      attributes: { "data-ledger-onboard-connect": true },
      icon: "refresh",
      label: t("ledger.error.tryAgain"),
      variant: "secondary",
    })}
      ${ledgerOnboardCancel()}`,
  );

// Row status in the recovery-phrase picker's words, so a Ledger scan and a
// phrase scan describe the same account the same way. `null` is still loading
// (or a degraded RPC). Only Bramble deploys a funded Bramble account itself.
const candidateState = (candidate: LedgerCandidate): string => {
  const type = candidate.account.accountContractType;
  if (candidate.duplicate) return t("onboarding.picker.alreadyAdded");
  if (candidate.deployed === null) return t("ledger.candidate.checking");
  if (candidate.deployed) return t("onboarding.picker.deployedOnStarknet");
  if (candidate.funded) {
    return type === "openzeppelin"
      ? t("onboarding.picker.fundedReady")
      : t("ledger.candidate.fundedNotDeployed");
  }
  // A failed balance read proves nothing: a funded account must not read as empty.
  if (candidate.funded === null) return t("ledger.candidate.balanceUnknown");
  if (type === "argent") {
    // Only Ready's own path holds Ready accounts; one at Bramble's path is an
    // Argent account on the key Bramble reads, not Ready's.
    return candidate.account.derivation.eip2645application === READY_EIP2645_APPLICATION
      ? t("onboarding.picker.noActivityReady")
      : t("ledger.candidate.noActivityArgent");
  }
  return type === "braavos"
    ? t("onboarding.picker.noActivityBraavos")
    : t("onboarding.picker.noActivity");
};

// An Argent account at Bramble's own path shares its index with the Ready
// account at Ready's path; name its path wherever both are listed together.
// (Bramble's path is also starknet.js's default Ledger path, so who created the
// account is not known — only where its key lives.)
const candidateMeta = (candidate: LedgerCandidate, atBramblePath = false): string => {
  const index = String(candidate.account.derivation.accountIndex);
  return `<strong>${atBramblePath ? th("ledger.candidate.accountBramblePath", { index }) : th("onboarding.picker.accountName", { index })}</strong>
      <code>${escapeHtml(accountLabel(candidate.account.address))}</code>
      <span class="hint">${escapeHtml(candidateState(candidate))}</span>`;
};

// Every row is a labelled checkbox keyed on its account id, as in the recovery
// picker. A duplicate (already in the vault) or an inactive Argent (Ready) or
// Braavos row keeps its checkbox but disabled: the first can never be picked twice, and
// importing the second would deploy a brand-new account of a family this wallet
// does not create. The row's status line says which.
const candidateRow = (
  candidate: LedgerCandidate,
  selected: readonly string[],
  atBramblePathLabel = false,
): string => {
  const id = candidate.account.id;
  const disabled = ledgerCandidateSelectable(candidate) ? "" : " disabled";
  const checked = !candidate.duplicate && selected.includes(id) ? " checked" : "";
  return `
  <li class="allowance-row${candidate.duplicate ? " is-duplicate" : ""}">
    <label class="select-row">
      <input class="select-check" type="checkbox" data-ledger-toggle="${escapeHtml(id)}"${checked}${disabled} />
      <span class="allowance-copy">${candidateMeta(candidate, atBramblePathLabel)}</span>
    </label>
  </li>`;
};

const candidateRows = (
  candidates: readonly LedgerCandidate[],
  selected: readonly string[],
  atBramblePathLabel: (candidate: LedgerCandidate) => boolean = () => false,
): string =>
  candidates.length === 0
    ? emptyState(t("ledger.picker.empty"))
    : `<ul class="allowance-list">${candidates.map((candidate) => candidateRow(candidate, selected, atBramblePathLabel(candidate))).join("")}</ul>`;

// The family name in each group heading ("{family} accounts"). Product names,
// never translated.
const GROUP_FAMILIES = {
  argent: "Argent",
  braavos: "Braavos",
  openzeppelin: "Bramble",
} as const;

// One contract-family group, laid out as the recovery-phrase picker's: a native
// disclosure whose summary carries the family name and its "N found" count. The
// runtime keeps each group's open/closed state across repaints and opens a
// group when activity appears. A family the route did not read has no rows and
// no group. Argent accounts at Bramble's own path are not Ready accounts (Ready
// reads the device at its own path), so the Argent group is called Ready only
// when it holds Ready's. When a scan spans both paths, an Argent account at
// Bramble's path joins the Ready group only once it shows activity, so an
// unused one does not double every Ready row with an unselectable twin. One
// whose balance read failed stays listed, so the failure is said, not hidden.
const candidateGroup = (
  contractType: keyof typeof GROUP_FAMILIES,
  candidates: readonly LedgerCandidate[],
  selected: readonly string[],
): string => {
  const family = candidates.filter(
    (candidate) => candidate.account.accountContractType === contractType,
  );
  if (family.length === 0) return "";
  const atBramblePath = (candidate: LedgerCandidate): boolean =>
    candidate.account.accountContractType === "argent" &&
    candidate.account.derivation.eip2645application !== READY_EIP2645_APPLICATION;
  const mixed = family.some((candidate) => !atBramblePath(candidate)) && family.some(atBramblePath);
  const rows = [
    ...(mixed
      ? family.filter(
          (candidate) =>
            !atBramblePath(candidate) ||
            ledgerCandidateActive(candidate) ||
            (candidate.deployed === false && candidate.funded === null),
        )
      : family),
  ].sort(
    (left, right) => left.account.derivation.accountIndex - right.account.derivation.accountIndex,
  );
  const detected = rows.filter(ledgerCandidateActive).length;
  const label = th("onboarding.scan.group", {
    family:
      contractType === "argent" && family.some((candidate) => !atBramblePath(candidate))
        ? "Ready"
        : GROUP_FAMILIES[contractType],
  });
  return `
  <details class="disclosure account-group" data-account-group="${contractType}">
    <summary>${label}<span class="eyebrow" data-detected="${detected}">${accountsDetectedText(detected)}</span></summary>
    <div class="disclosure-body">${candidateRows(rows, selected, (candidate) => mixed && atBramblePath(candidate))}</div>
  </details>`;
};

// The Ready-restore picker is one flat list — every candidate was read at
// Ready's path and derived to the Argent contract Ready deploys — with the
// detected count inline. Not a disclosure (no `data-account-group`), so the
// runtime's open/closed bookkeeping leaves it alone. Ready numbers a new Ledger
// account after every account already in that wallet, so a restored account
// often sits past the first page.
const readyCandidates = (
  candidates: readonly LedgerCandidate[],
  selected: readonly string[],
): string => {
  const detected = candidates.filter(ledgerCandidateActive).length;
  return `
  <div class="account-group" data-ready-accounts>
    <p class="hint">${th("onboarding.scan.group", { family: "Ready" })}${detected === 0 ? "" : ` · ${accountsDetectedText(detected)}`}</p>
    ${candidateRows(candidates, selected)}
  </div>`;
};

const pickerCopy = (
  application: LedgerEip2645Application,
): { readonly heading: string; readonly lede: string } =>
  application === READY_EIP2645_APPLICATION
    ? { heading: th("ledger.picker.readyTitle"), lede: th("ledger.picker.readyLede") }
    : { heading: th("ledger.picker.title"), lede: th("ledger.picker.lede") };

/**
 * The multi-select account picker: one row per enumerated candidate with its
 * address, on-chain status, and a selection checkbox (disabled on a duplicate
 * or an unused Ready or Braavos account). "Show more" reads the next page
 * of indices from the device; "Add selected" adds every checked index at once
 * and reflects a running selected-count. Callers stream candidates in as they
 * resolve. A Cancel control is always rendered so the picker stage can be
 * dismissed without adding anything. `application` is the path scheme the
 * candidates were read at: Bramble's (alone, or with Ready's on first run)
 * groups them into Bramble, Ready and Braavos accounts, Ready's alone shows the
 * single flat list of Ready accounts.
 */
export const ledgerAccountPicker = (
  candidates: readonly LedgerCandidate[],
  selected: readonly string[] = [],
  message?: string,
  application: LedgerEip2645Application = LEDGER_EIP2645_APPLICATION,
  loadingMore = false,
): string => {
  const list =
    application === READY_EIP2645_APPLICATION
      ? readyCandidates(candidates, selected)
      : candidates.length === 0
        ? emptyState(t("ledger.picker.empty"))
        : (["openzeppelin", "argent", "braavos"] as const)
            .map((family) => candidateGroup(family, candidates, selected))
            .join("");
  const copy = pickerCopy(application);
  const count = selected.length;
  const addLabel =
    count > 0
      ? t("ledger.picker.addSelectedCount", { count: String(count) })
      : t("ledger.picker.addSelected");
  return `
  <div class="onboard-picker">
    <div class="gate-head">
      <h1>${copy.heading}</h1>
      <p class="lede">${copy.lede}</p>
    </div>
    ${message ? `<p class="review-flag" role="alert">${escapeHtml(message)}</p>` : ""}
    ${list}
    ${button({
      attributes: { "data-ledger-load-more": true, ...(loadingMore ? { "data-busy": true } : {}) },
      disabled: loadingMore,
      icon: "plus",
      label: t("ledger.picker.showMore"),
      size: "small",
      variant: "ghost",
    })}
    <div class="onboard-actions">
      ${button({
        attributes: { "data-ledger-add-selected": true },
        disabled: count === 0,
        icon: "plus",
        label: addLabel,
      })}
      ${ledgerOnboardCancel()}
    </div>
  </div>`;
};
