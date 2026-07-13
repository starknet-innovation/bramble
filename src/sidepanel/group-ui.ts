/**
 * Behaviour for the shared account-groups controls rendered by
 * ./group-controls.ts. One `bindGroupControls` entry wires icon pickers,
 * create/edit forms, delete (two-tap) confirmation, per-account membership
 * toggles, and the collapsible assignment panels, so the left drawer and the
 * manage-accounts flow drive identical group behaviour without duplication.
 */
import { isAccountGroupIcon } from "../storage/account-groups";
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { SidepanelWallet } from "./runtime";

/**
 * State the group controls close over: the wallet client, a re-render callback
 * invoked after every successful mutation, and the manage-accounts bulk editor's
 * expanded-group accessor/mutator so a group's members editor can be opened
 * (e.g. right after creating it) and stay open across re-renders.
 */
export type GroupControlDeps = {
  readonly expandedGroup: () => string | null;
  readonly rerender: () => Promise<void>;
  readonly setExpandedGroup: (id: string | null) => void;
  readonly wallet: SidepanelWallet;
};

const selectedIcon = (form: Element) => {
  const raw = form.querySelector<HTMLInputElement>("[data-group-icon-value]")?.value;
  return isAccountGroupIcon(raw) ? raw : null;
};

const bindIconPickers = (root: Element): void => {
  root.querySelectorAll<HTMLElement>(".group-icon-picker").forEach((picker) => {
    const value = picker.querySelector<HTMLInputElement>("[data-group-icon-value]");
    const options = picker.querySelectorAll<HTMLButtonElement>("[data-group-icon]");
    options.forEach((option) => {
      option.addEventListener("click", () => {
        const glyph = option.dataset["groupIcon"];
        if (!glyph || !value) {
          return;
        }
        value.value = glyph;
        options.forEach((other) => {
          other.setAttribute("aria-pressed", String(other === option));
        });
      });
    });
  });
};

const bindCreateForms = (root: Element, deps: GroupControlDeps): void => {
  root.querySelectorAll<HTMLFormElement>(".new-group-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = form.querySelector<HTMLInputElement>("[data-group-name]")?.value.trim() ?? "";
      const glyph = selectedIcon(form);
      const button = form.querySelector<HTMLButtonElement>("[data-create-group]");
      if (!name || !glyph) {
        showToast("Enter a group name", "error");
        return;
      }
      buttonBusy(button, true);
      // The op returns the created group's deterministic id; open its bulk
      // members editor so the user can immediately bucket accounts into it.
      void deps.wallet.createGroup(name, glyph).then(
        async (id) => {
          deps.setExpandedGroup(id);
          showToast("Group created", "success");
          await deps.rerender();
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Group create failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });
};

const bindEditForms = (root: Element, deps: GroupControlDeps): void => {
  root.querySelectorAll<HTMLFormElement>(".edit-group-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const id = form.dataset["editGroup"];
      const name = form.querySelector<HTMLInputElement>("[data-group-name]")?.value.trim() ?? "";
      const glyph = selectedIcon(form);
      const button = form.querySelector<HTMLButtonElement>("[data-save-group]");
      if (!id || !name || !glyph) {
        showToast("Enter a group name", "error");
        return;
      }
      buttonBusy(button, true);
      void deps.wallet
        .renameGroup(id, name)
        .then(() => deps.wallet.setGroupIcon(id, glyph))
        .then(
          async () => {
            showToast("Group updated", "success");
            await deps.rerender();
          },
          (error: unknown) => {
            showToast(errorMessage(error, "Group update failed"), "error");
            buttonBusy(button, false);
          },
        );
    });
  });
};

const bindRemoveButtons = (root: Element, deps: GroupControlDeps): void => {
  root.querySelectorAll<HTMLButtonElement>("[data-remove-group]").forEach((button) => {
    const el = button;
    el.addEventListener("click", () => {
      const id = el.dataset["removeGroup"];
      if (!id) {
        return;
      }
      // First tap arms the delete; a second tap on the same control confirms.
      if (el.dataset["confirm"] !== "true") {
        el.dataset["confirm"] = "true";
        el.classList.add("is-confirming");
        el.setAttribute("title", "Tap again to delete");
        el.setAttribute("aria-label", "Tap again to delete");
        return;
      }
      buttonBusy(el, true);
      void deps.wallet.removeGroup(id).then(
        async () => {
          showToast("Group deleted", "success");
          await deps.rerender();
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Group delete failed"), "error");
          buttonBusy(el, false);
        },
      );
    });
  });
};

const bindAssignToggles = (root: Element, deps: GroupControlDeps): void => {
  root.querySelectorAll<HTMLButtonElement>("[data-group-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const groupId = button.dataset["groupToggle"];
      const accountId = button.dataset["account"];
      if (!groupId || !accountId) {
        return;
      }
      const member = button.getAttribute("aria-pressed") === "true";
      buttonBusy(button, true);
      void deps.wallet.setAccountInGroup(accountId, groupId, !member).then(
        async () => {
          showToast(member ? "Removed from group" : "Added to group", "success");
          await deps.rerender();
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Group update failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });
};

const bindAssignPanels = (root: Element): void => {
  root.querySelectorAll<HTMLButtonElement>("[data-assign-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const accountId = button.dataset["assignToggle"];
      if (!accountId) {
        return;
      }
      const panel = root.querySelector<HTMLElement>(`[data-group-assign="${accountId}"]`);
      if (!panel) {
        return;
      }
      const open = panel.hasAttribute("hidden");
      panel.toggleAttribute("hidden", !open);
      button.setAttribute("aria-expanded", String(open));
    });
  });
};

// Expand/collapse a group's bulk members editor in the manage-accounts Groups
// section. The open group is held in a module var (mirroring the drawer's group
// filter) so it survives full re-renders; clicking the open group's header
// collapses it. A re-render repaints the section with the right editor open.
const bindGroupExpanders = (root: Element, deps: GroupControlDeps): void => {
  root.querySelectorAll<HTMLButtonElement>("[data-group-expand]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["groupExpand"];
      if (!id) {
        return;
      }
      deps.setExpandedGroup(deps.expandedGroup() === id ? null : id);
      void deps.rerender();
    });
  });
};

/**
 * Wires every account-groups control found under `root`. Safe to call on each
 * render; regions without group controls are simply skipped.
 */
export const bindGroupControls = (root: Element | null, deps: GroupControlDeps): void => {
  if (!root) {
    return;
  }
  bindIconPickers(root);
  bindCreateForms(root, deps);
  bindEditForms(root, deps);
  bindRemoveButtons(root, deps);
  bindAssignToggles(root, deps);
  bindAssignPanels(root);
  bindGroupExpanders(root, deps);
};
