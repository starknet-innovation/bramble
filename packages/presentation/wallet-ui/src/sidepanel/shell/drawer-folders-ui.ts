/**
 * Drawer folder behaviour: dragging an account into a folder, collapsing a
 * folder, and creating one inline.
 *
 * A drop files the account through the same single-folder assignment the
 * settings screen uses, so membership stays exclusive and the drawer never
 * invents its own rule. Dropping an account back into the folder it is already
 * in does nothing rather than writing a no-op.
 *
 * Drag and drop is a pointer interaction; moving an account by keyboard is not
 * offered here yet, and remains the gap to close on this screen.
 */

import type { SidepanelWallet } from "../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../shared/dom";
import { INITIAL_COLLAPSED_FOLDERS } from "./drawer-folders";

/**
 * State accessors and services the drawer's folder controls close over. The
 * collapsed set and the open create field live in the entrypoint so both
 * survive the repaint that follows every write.
 */
export type DrawerFolderDeps = {
  readonly addFolderOpen: () => boolean;
  readonly app: Element | null;
  readonly collapsedFolders: () => readonly string[];
  /** Repaints the shell with fresh status after a write. */
  readonly render: (status: Awaited<ReturnType<SidepanelWallet["loadStatus"]>>) => Promise<void>;
  /**
   * Arms focus of the create field for the next bind that paints it. Only the
   * control that opens the field calls this; a later balance repaint must not.
   */
  readonly requestFolderNameFocus: () => void;
  readonly setAddFolderOpen: (open: boolean) => void;
  readonly setCollapsedFolders: (ids: readonly string[]) => void;
  /**
   * Consumes the one-shot focus request. False once the field is already open,
   * so binding again leaves focus on Add or Cancel.
   */
  readonly takeFolderNameFocus: () => boolean;
  readonly wallet: Pick<
    SidepanelWallet,
    "createGroup" | "loadStatus" | "setAccountInGroup" | "setActiveNetwork"
  >;
};

const DRAG_TYPE = "application/x-bramble-account";

const repaint = async (deps: DrawerFolderDeps): Promise<void> => {
  await deps.render(await deps.wallet.loadStatus());
};

const bindCollapse = (root: Element, deps: DrawerFolderDeps): void => {
  for (const head of root.querySelectorAll<HTMLButtonElement>("[data-folder-toggle]")) {
    head.addEventListener("click", () => {
      const id = head.dataset["folderToggle"];
      if (!id) {
        return;
      }
      const collapsed = deps.collapsedFolders();
      deps.setCollapsedFolders(
        collapsed.includes(id) ? collapsed.filter((open) => open !== id) : [...collapsed, id],
      );
      void repaint(deps);
    });
  }
};

const bindDragSources = (root: Element): void => {
  for (const row of root.querySelectorAll<HTMLElement>("[data-drag-account]")) {
    row.addEventListener("dragstart", (event) => {
      const accountId = row.dataset["dragAccount"];
      const transfer = (event as DragEvent).dataTransfer;
      if (!accountId || !transfer) {
        return;
      }
      transfer.setData(DRAG_TYPE, accountId);
      transfer.effectAllowed = "move";
      row.dataset["dragging"] = "true";
    });
    row.addEventListener("dragend", () => {
      delete row.dataset["dragging"];
    });
  }
};

// The account a drop carries. Read from the drag payload, falling back to the
// row still marked as dragging — `dragend` fires after `drop`, so the source row
// is a reliable second reading when a browser hands over an empty payload.
const draggedAccount = (root: Element, event: DragEvent): string | null =>
  event.dataTransfer?.getData(DRAG_TYPE) ||
  root.querySelector<HTMLElement>("[data-dragging]")?.dataset["dragAccount"] ||
  null;

const bindDropTargets = (root: Element, deps: DrawerFolderDeps): void => {
  for (const folder of root.querySelectorAll<HTMLElement>("[data-folder]")) {
    folder.addEventListener("dragover", (event) => {
      event.preventDefault();
      const transfer = (event as DragEvent).dataTransfer;
      if (transfer) {
        transfer.dropEffect = "move";
      }
      folder.dataset["dropTarget"] = "true";
    });
    folder.addEventListener("dragleave", (event) => {
      // Entering a heading or row inside this section fires dragleave on the
      // section itself. The pointer is still over the folder, so the highlight
      // stays until the drag actually leaves it.
      const next = (event as DragEvent).relatedTarget;
      if (next instanceof Node && folder.contains(next)) {
        return;
      }
      delete folder.dataset["dropTarget"];
    });
    folder.addEventListener("drop", (event) => {
      event.preventDefault();
      delete folder.dataset["dropTarget"];
      const groupId = folder.dataset["folder"];
      const accountId = draggedAccount(root, event as DragEvent);
      if (
        !groupId ||
        !accountId ||
        folder.contains(root.querySelector(`[data-drag-account="${CSS.escape(accountId)}"]`))
      ) {
        return;
      }
      void deps.wallet.setAccountInGroup(accountId, groupId, true).then(
        async () => {
          // The archive starts collapsed, and a user-collapsed folder stays
          // closed. Open the destination so the account that just landed
          // there is on screen.
          if (deps.collapsedFolders().includes(groupId)) {
            deps.setCollapsedFolders(deps.collapsedFolders().filter((id) => id !== groupId));
          }
          await repaint(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Could not move that account"), "error", folder);
        },
      );
    });
  }
};

const bindAddFolder = (root: Element, deps: DrawerFolderDeps): void => {
  root.querySelector<HTMLButtonElement>("#drawer-add-folder")?.addEventListener("click", () => {
    deps.setAddFolderOpen(true);
    deps.requestFolderNameFocus();
    void repaint(deps);
  });
  root.querySelector<HTMLButtonElement>("#drawer-folder-cancel")?.addEventListener("click", () => {
    deps.setAddFolderOpen(false);
    void repaint(deps);
  });
  const form = root.querySelector<HTMLFormElement>("#drawer-folder-form");
  const result = root.querySelector<HTMLElement>("#drawer-folder-result");
  const submit = form?.querySelector<HTMLButtonElement>("#drawer-folder-create");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = String(new FormData(form).get("folderName") ?? "").trim();
    if (name.length === 0) {
      if (result) result.textContent = "Name the folder before adding it.";
      return;
    }
    buttonBusy(submit, true);
    // Every folder made here takes the plain folder glyph; the icon is chosen
    // on the manage screen, which is where the rest of folder editing lives.
    void deps.wallet.createGroup(name, "folder").then(
      async () => {
        deps.setAddFolderOpen(false);
        await repaint(deps);
      },
      (error: unknown) => {
        buttonBusy(submit, false);
        if (result) result.textContent = errorMessage(error, "Could not add that folder");
      },
    );
  });
  // Focus the name only on the bind that follows opening the field. Later
  // binds leave the restored focus — the field, Add, or Cancel — where it is.
  if (form && deps.takeFolderNameFocus()) {
    root.querySelector<HTMLInputElement>("#drawer-folder-name")?.focus();
  }
};

// The drawer's network pill and the list it opens. Switching repaints the shell
// in place rather than navigating, so the drawer stays where the user left it.
const bindNetworkSwitch = (root: Element, deps: DrawerFolderDeps): void => {
  const toggle = root.querySelector<HTMLButtonElement>("[data-drawer-network-toggle]");
  const menu = root.querySelector<HTMLElement>(".drawer-network-menu");
  if (!toggle || !menu) {
    return;
  }
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    menu.toggleAttribute("hidden", open);
  });
  for (const option of root.querySelectorAll<HTMLButtonElement>("[data-drawer-network-id]")) {
    option.addEventListener("click", () => {
      const networkId = option.dataset["drawerNetworkId"];
      if (!networkId || option.getAttribute("aria-selected") === "true") {
        return;
      }
      buttonBusy(option, true);
      void deps.wallet.setActiveNetwork(networkId).then(
        async (status) => {
          await deps.render(status);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Network switch failed"), "error", option);
          buttonBusy(option, false);
        },
      );
    });
  }
};

/**
 * Binds the drawer's folder controls and its network pill. Safe to call on
 * every render; a drawer without folders (no account on this network) simply
 * has nothing to bind.
 */
export const bindDrawerFolders = (deps: DrawerFolderDeps): void => {
  const root = deps.app?.querySelector(".account-drawer");
  if (!root) {
    return;
  }
  bindCollapse(root, deps);
  bindDragSources(root);
  bindDropTargets(root, deps);
  bindAddFolder(root, deps);
  bindNetworkSwitch(root, deps);
};

/**
 * The drawer's own view state: which folders are collapsed, whether the
 * inline create field is showing, and the one-shot request to focus that
 * field when it opens. Held here rather than in the entrypoint so the
 * entrypoint carries one handle, and so the open field survives the repaint
 * that follows every write.
 */
export type DrawerFolderState = Pick<
  DrawerFolderDeps,
  | "addFolderOpen"
  | "collapsedFolders"
  | "requestFolderNameFocus"
  | "setAddFolderOpen"
  | "setCollapsedFolders"
  | "takeFolderNameFocus"
>;

/**
 * Creates the drawer's folder view state, with the archive collapsed.
 */
export const createDrawerFolderState = (): DrawerFolderState => {
  let collapsed = INITIAL_COLLAPSED_FOLDERS;
  let focusName = false;
  let open = false;
  return {
    addFolderOpen: () => open,
    collapsedFolders: () => collapsed,
    requestFolderNameFocus: () => {
      focusName = true;
    },
    setAddFolderOpen: (next) => {
      open = next;
      if (!next) {
        focusName = false;
      }
    },
    setCollapsedFolders: (ids) => {
      collapsed = ids;
    },
    takeFolderNameFocus: () => {
      const pending = focusName;
      focusName = false;
      return pending;
    },
  };
};
