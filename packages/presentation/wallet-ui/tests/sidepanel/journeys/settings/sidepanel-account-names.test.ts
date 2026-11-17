/**
 * The "Account names" section of the manage-accounts view: every account on the
 * active network is listed with its name editable in place, rather than one form
 * for whichever account happens to be active. Covers the listing and its
 * network scope, the generated name showing through as the placeholder, folder
 * membership on each row, the empty case, and the repaint behaviour a list of
 * same-named fields makes possible — a half-typed name must come back to the row
 * it was typed in and to no other.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { AccountGroups } from "@bramble/settings/groups";
import { preferences } from "@bramble/testkit/sidepanel";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  captureRepaintFocus,
  restoreRepaintFocus,
} from "../../../../src/sidepanel/app/rendering/focus-memo";
import { accountFlow } from "../../../../src/sidepanel/app/screens/flows";
import { friendlyAccountName } from "../../../../src/sidepanel/shared/parts";
import {
  acctA,
  acctB,
  group,
  registerDom,
  status,
  unregisterDom,
} from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const render = (prefs = preferences, accounts: readonly AccountRef[] = status.accounts): string =>
  accountFlow({ ...status, accounts }, prefs);

// Paints the screen into a fresh #app whose children are replaced (never
// innerHTML), so each paint yields new nodes exactly like the real shell swap.
const paintApp = (html: string): HTMLElement => {
  let app = document.querySelector<HTMLElement>("#app");
  if (!app) {
    app = document.createElement("div");
    app.id = "app";
    document.body.append(app);
  }
  app.replaceChildren(document.createRange().createContextualFragment(html));
  return app;
};

const nameField = (app: HTMLElement, accountId: string): HTMLInputElement => {
  const input = app.querySelector<HTMLInputElement>(`[data-account-name="${accountId}"]`);
  if (!input) {
    throw new Error(`name field missing for ${accountId}`);
  }
  return input;
};

describe("account names section", () => {
  test("lists one editable name per account on the active network", () => {
    const html = render();

    for (const stored of [acctA, acctB]) {
      expect(html).toContain(`data-account-name-form="${stored.id}"`);
      expect(html).toContain(`data-account-name="${stored.id}"`);
    }
    // Every row saves on its own, so a name is never written to the wrong
    // account by whichever one is active.
    expect(html.split("data-account-name-form=").length - 1).toBe(2);
    // ...and each save control names the account it saves, so the list does not
    // read as a column of identical "Save" buttons.
    expect(html).toContain(`aria-label="Save name for ${friendlyAccountName(acctA.address)}"`);
    expect(html).toContain(`aria-label="Save name for ${friendlyAccountName(acctB.address)}"`);
  });

  test("shows the generated name as the placeholder and a stored label as the value", () => {
    const html = render({ ...preferences, accountLabels: { [acctA.id]: "Daily" } });

    // The named account shows what the user chose...
    expect(html).toContain('value="Daily"');
    // ...and the unnamed one shows the name the wallet falls back to everywhere
    // else, instead of an empty box that hides it.
    expect(html).toContain(`placeholder="${friendlyAccountName(acctB.address)}"`);
    expect(html).toContain(`Name for ${friendlyAccountName(acctB.address)}`);
  });

  test("leaves out accounts on another network", () => {
    const elsewhere: AccountRef = { ...acctA, id: "SN_SEPOLIA:0x7f", networkId: "SN_SEPOLIA" };
    const html = render(preferences, [...status.accounts, elsewhere]);

    expect(html).not.toContain(`data-account-name-form="${elsewhere.id}"`);
  });

  test("shows which folder an account is filed in, without offering to change it here", () => {
    const groups: AccountGroups = [
      { ...group("briefcase", "work", "Work"), accountIds: [acctA.id] },
    ];
    const html = render({ ...preferences, groups });

    const row = html.slice(
      html.indexOf(`data-account-name-form="${acctA.id}"`),
      html.indexOf(`data-account-name-form="${acctB.id}"`),
    );
    expect(row).toContain('aria-label="Folders: Work"');
    // Filing still happens by dragging in the drawer or in the Folders
    // accordion; the name row only reports it.
    expect(row).not.toContain("data-group-toggle");
  });

  test("says so when the network has no accounts yet", () => {
    const html = render(preferences, []);

    expect(html).not.toContain("data-account-name-form");
    expect(html).toContain("No account on");
    // "Add account" stays reachable from the empty state.
    expect(html).toContain('id="new-account"');
  });

  test("offers a Hide control on each visible row", () => {
    const html = render();

    expect(html).toContain(`data-hide-account="${acctA.id}"`);
    expect(html).toContain(`aria-label="Hide ${friendlyAccountName(acctA.address)}"`);
  });

  test("lists hidden accounts separately, with the control that brings them back", () => {
    const html = render({ ...preferences, hiddenAccountIds: [acctB.id] });

    // The hidden account leaves the naming list...
    expect(html).not.toContain(`data-account-name-form="${acctB.id}"`);
    expect(html.split("data-account-name-form=").length - 1).toBe(1);
    // ...and reappears below with the control that shows it again.
    expect(html).toContain(`data-reveal-account="${acctB.id}"`);
    expect(html).toContain(`aria-label="Show ${friendlyAccountName(acctB.address)}"`);
    expect(html).toContain("Hidden accounts");
  });

  test("renders no Hidden accounts section when nothing is hidden", () => {
    expect(render()).not.toContain("Hidden accounts");
  });

  test("returns a half-typed name to the row it was typed in, and to no other", () => {
    const app = paintApp(render());
    const editing = nameField(app, acctB.id);
    editing.focus();
    // Typed past the (empty) stored value and not yet saved.
    editing.value = "Travel";
    editing.setSelectionRange(6, 6);
    const focus = captureRepaintFocus();

    // A streaming repaint tears every row down and re-renders them from the
    // unchanged stored labels.
    paintApp(render());
    restoreRepaintFocus(app, focus);

    const restored = nameField(app, acctB.id);
    expect(document.activeElement).toBe(restored);
    expect(restored.value).toBe("Travel");
    expect(restored.selectionStart).toBe(6);
    // Every row's field is `name="label"`: without keying the memo on the
    // account id, the draft would land on the first row instead.
    expect(nameField(app, acctA.id).value).toBe("");
  });
});
