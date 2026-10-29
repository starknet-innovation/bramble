/**
 * Picker for a raw "Ready Account" key (issue 776). One key has a different
 * address under every Argent release, so before importing, the background lists
 * each release whose address is in use and the user ticks the ones to import.
 * A deployed row starts ticked; a funded-only row does not, because a few
 * tokens sent to an address prove nothing about who meant to use it. Shared by
 * the first-run key import and Settings → Import private key. Built with DOM
 * APIs and `textContent` only; the key never reaches this module.
 */

import { accountClassEntry } from "@bramble/wallet-model/account-families";
import type { ReadyKeyCandidate } from "../../../popup/responses/responses-onboarding";
import { accountLabel } from "../../shared/parts";

/** The mounted picker: what is ticked, and how to take it down. */
export type ReadyKeyPicker = {
  readonly picked: () => readonly string[];
  readonly remove: () => void;
};

// "argent 0.3.1" reads as "Argent 0.3.1"; an unknown class keeps its hash.
const releaseName = (classHash: string): string => {
  const label = accountClassEntry(classHash)?.label;
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : accountLabel(classHash);
};

const rowState = (candidate: ReadyKeyCandidate, duplicate: boolean): string => {
  if (duplicate) return "Already in this wallet";
  if (candidate.deployed) return "Deployed";
  const held = candidate.holdings.map(({ formatted, symbol }) => `${formatted} ${symbol}`);
  return `Not deployed · holds ${held.join(", ")}`;
};

/**
 * Mounts the picker just before `before`. Deployed rows start ticked, funded-only
 * rows unticked, and an account already in the wallet is shown locked.
 * `onChange` runs after every tick so the caller can gate its button.
 */
export const mountReadyKeyPicker = (
  before: Element,
  candidates: readonly ReadyKeyCandidate[],
  existingIds: ReadonlySet<string>,
  onChange: () => void,
): ReadyKeyPicker => {
  const doc = before.ownerDocument;
  const fieldset = doc.createElement("fieldset");
  fieldset.dataset["readyKeyPicker"] = "";
  const legend = doc.createElement("legend");
  legend.textContent = "Accounts using this key";
  const list = doc.createElement("ul");
  list.className = "allowance-list";
  const checks: { readonly box: HTMLInputElement; readonly classHash: string }[] = [];
  for (const candidate of candidates) {
    const duplicate = existingIds.has(candidate.accountId);
    const row = doc.createElement("li");
    row.className = "allowance-row";
    const label = doc.createElement("label");
    label.className = "select-row";
    const box = doc.createElement("input");
    box.className = "select-check";
    box.type = "checkbox";
    box.disabled = duplicate;
    // Deployed rows start ticked (owner decision, 2026-10-27, as for issue
    // 398): the evidence comes from the SNF-operated RPC by default, and a
    // lying custom RPC can at worst pre-tick an empty address this key itself
    // controls.
    box.checked = !duplicate && candidate.deployed;
    box.dataset["readyKeyClass"] = candidate.classHash;
    box.addEventListener("change", onChange);
    const copy = doc.createElement("span");
    copy.className = "allowance-copy";
    const title = doc.createElement("strong");
    title.textContent = `Account · ${releaseName(candidate.classHash)}`;
    const address = doc.createElement("code");
    address.textContent = accountLabel(candidate.address);
    address.title = candidate.address;
    const hint = doc.createElement("span");
    hint.className = "hint";
    hint.textContent = rowState(candidate, duplicate);
    copy.append(title, address, hint);
    label.append(box, copy);
    row.append(label);
    list.append(row);
    checks.push({ box, classHash: candidate.classHash });
  }
  fieldset.append(legend, list);
  before.before(fieldset);
  return {
    picked: () => checks.filter(({ box }) => box.checked).map(({ classHash }) => classHash),
    remove: () => fieldset.remove(),
  };
};
