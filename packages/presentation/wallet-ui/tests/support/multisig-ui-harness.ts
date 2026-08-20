/**
 * Shared mount for multisig side-panel DOM tests: renders view HTML into a
 * detached app element and binds the real multisig UI handlers to it, so each
 * suite exercises the shipped bindings rather than a re-declared stub tree.
 */

import type { MultisigClient } from "../../src/sidepanel/journeys/multisig/multisig-runtime";
import {
  bindMultisigs,
  type MultisigUiDeps,
} from "../../src/sidepanel/journeys/multisig/multisig-ui";
import { makeArgentMultisigFixture } from "./argent-multisig-fixtures";

/** Creates one manually resolvable promise for ordered async UI tests. */
export const deferredMultisigUi = <T>() => {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((next) => {
      resolve = next;
    }),
    resolve,
  };
};

/** Flushes the bounded promise chain used by multisig DOM binders. */
export const flushMultisigUi = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
};

/** Renders the minimum valid deployment form for binding tests. */
export const multisigDeploymentForm = (signerAccountId: string, publicKey: string): string => `
  <form id="multisig-deploy-form">
    <input name="name" value="Treasury" />
    <input name="signerPublicKeys" value="${publicKey}" />
    <input name="threshold" value="1" />
    <input name="salt" value="0x0" />
    <input name="signerAccountId" value="${signerAccountId}" />
    <div id="multisig-deploy-review"></div>
    <button type="submit">Review deployment</button>
    <p id="multisig-deploy-result"></p>
  </form>`;

/** Creates a complete deterministic client; overrides expose one observed boundary per test. */
export const makeMultisigUiClient = async (
  overrides: Partial<MultisigClient> = {},
): Promise<MultisigClient> => {
  const fixture = await makeArgentMultisigFixture();
  return {
    addMultisig: async () => fixture.view,
    deployMultisig: async () => ({
      address: fixture.record.address,
      multisig: fixture.view,
      ok: true,
      transactionHash: "0x456",
    }),
    importIntent: async () => ({ intent: fixture.intent }),
    importSignature: async () => ({ intent: fixture.intent }),
    loadBalances: async () => ({ error: "balances unavailable" }),
    loadClassStatus: async () => true,
    loadMultisigs: async () => ({ intents: [fixture.intent], multisigs: [fixture.view] }),
    prepareIntent: async () => ({ intent: fixture.intent }),
    refreshMultisig: async () => ({ intents: [fixture.intent], multisig: fixture.view }),
    removeMultisig: async () => undefined,
    resolveSigner: async (address) => ({
      accountContractType: "openzeppelin",
      address,
      publicKeyX: "0x456",
    }),
    reviewDeployment: async () => fixture.deploymentReview,
    signIntent: async () => ({ intent: fixture.intent }),
    submitIntent: async () => ({ intent: fixture.readyIntent, transactionHash: "0x456" }),
    ...overrides,
  };
};

/**
 * Mounts view HTML with the real multisig bindings attached. `overrides`
 * replaces individual deps (typically `multisig` or `wallet`) so a test can
 * observe which client call a control makes.
 */
export const mountMultisigUi = (
  html: string,
  client: MultisigClient,
  status: Awaited<ReturnType<typeof makeArgentMultisigFixture>>["status"],
  overrides: Partial<MultisigUiDeps> = {},
): HTMLElement => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.append(document.createRange().createContextualFragment(html));
  document.body.append(app);
  bindMultisigs({
    app,
    multisig: client,
    openDetail() {},
    openList() {},
    async render() {},
    selectedMultisigId: () => null,
    wallet: {
      async loadStatus() {
        return status;
      },
    },
    ...overrides,
  } as unknown as MultisigUiDeps);
  return app;
};
