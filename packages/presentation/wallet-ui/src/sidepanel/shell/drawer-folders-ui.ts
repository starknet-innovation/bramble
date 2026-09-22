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
  readonly setAddFolderOpen: (open: boolean) => void;
  readonly setCollapsedFolders: (ids: readonly string[]) => void;
  readonly wallet: Pick<SidepanelWallet, "createGroup" | "loadStatus" | "setAccountInGroup">;
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
    folder.addEventListener("dragleave", () => {
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
  if (form) {
    root.querySelector<HTMLInputElement>("#drawer-folder-name")?.focus();
  }
};

/**
 * Binds the drawer's folder controls. Safe to call on every render; a drawer
 * without folders (no account on this network) simply has nothing to bind.
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
};

/**
 * The drawer's own view state: which folders are collapsed, and whether the
 * inline create field is showing. Held here rather than in the entrypoint so
 * the entrypoint carries one handle instead of two variables and four
 * accessors, and so both survive the repaint that follows every write.
 */
export type DrawerFolderState = Pick<
  DrawerFolderDeps,
  "addFolderOpen" | "collapsedFolders" | "setAddFolderOpen" | "setCollapsedFolders"
>;

/**
 * Creates the drawer's folder view state, with the archive collapsed.
 */
export const createDrawerFolderState = (): DrawerFolderState => {
  let collapsed = INITIAL_COLLAPSED_FOLDERS;
  let open = false;
  return {
    addFolderOpen: () => open,
    collapsedFolders: () => collapsed,
    setAddFolderOpen: (next) => {
      open = next;
    },
    setCollapsedFolders: (ids) => {
      collapsed = ids;
    },
  };
};
