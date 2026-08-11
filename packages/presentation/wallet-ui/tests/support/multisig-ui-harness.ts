/**
 * Shared mount for multisig side-panel DOM tests: renders view HTML into a
 * detached app element and binds the real multisig UI handlers to it, so each
 * suite exercises the shipped bindings rather than a re-declared stub tree.
 */
import { bindMultisigs, type MultisigUiDeps } from "../../src/sidepanel/multisig-ui";

/**
 * Mounts view HTML with the real multisig bindings attached. `overrides`
 * replaces individual deps (typically `multisig` or `wallet`) so a test can
 * observe which client call a control makes.
 */
export const mountMultisigUi = (
  html: string,
  render: () => Promise<void> = async () => {},
  overrides: Partial<MultisigUiDeps> = {},
): HTMLElement => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.append(document.createRange().createContextualFragment(html));
  document.body.append(app);
  bindMultisigs({
    app,
    multisig: {},
    openDetail() {},
    openList() {},
    render,
    selectedMultisigId: () => null,
    wallet: {
      async loadStatus() {
        return {};
      },
    },
    ...overrides,
  } as unknown as MultisigUiDeps);
  return app;
};
