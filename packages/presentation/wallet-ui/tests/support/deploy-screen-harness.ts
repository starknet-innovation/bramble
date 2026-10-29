/**
 * The account deploy screen for the sponsored-deploy suites (issue 431, 788):
 * its markup, a wallet double that records which deploy requests it saw, and
 * a binder with an injectable hold timer and deployment scope.
 */

import type { DeploySponsorship } from "../../src/sidepanel/runtime/runtime-deploy";
import { outcomeReceiptSection } from "../../src/sidepanel/shared/outcome-receipt";
import type { StageTimers } from "../../src/sidepanel/shared/stage-pacer";
import { bindDeploy, type ShellBindingDeps } from "../../src/sidepanel/shell/shell-bindings";

/** The account every deploy-screen double reports. */
export const DEPLOY_ACCOUNT = "SN_SEPOLIA:0xabc";

/** Lets queued promise callbacks run. */
export const tick = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const deployMarkup = `<section class="section">
    <section id="deploy-review-stage">
      <button id="deploy-button" type="button">Deploy</button>
      <div id="deploy-review"></div>
      <p role="status"></p>
    </section>
    ${outcomeReceiptSection("deploy-success")}
  </section>`;

/** Mounts a fresh deploy screen as the document's only content. */
export const mountDeployScreen = (): HTMLElement => {
  const container = document.createElement("div");
  container.id = "app";
  container.append(document.createRange().createContextualFragment(deployMarkup));
  document.body.replaceChildren(container);
  return container;
};

/** Repaints `container` with fresh deploy markup, as a shell render does. */
export const repaintDeployScreen = (container: HTMLElement): void => {
  container.replaceChildren(document.createRange().createContextualFragment(deployMarkup));
};

/** The self-paid quote every double answers. */
export const deployQuote = { overallFee: "1000000000000000", unit: "FRI" as const };

/** The deploy screen's parts a test reads. */
export const screen = (container: HTMLElement) => ({
  button: container.querySelector<HTMLButtonElement>("#deploy-button"),
  cost: (container.querySelector("#deploy-review")?.textContent ?? "").replace(/\s+/g, " ").trim(),
  stage: container.querySelector("#deploy-review-stage"),
  status: container.querySelector('[role="status"]')?.textContent ?? "",
});

/** A wallet double answering the deploy screen's requests. */
export const deployWallet = (input: {
  readonly activity?: () => unknown;
  readonly deployed?: () => boolean;
  readonly selfPaid?: () => Promise<string>;
  readonly sponsored: () => Promise<string | null>;
  readonly sponsorship: DeploySponsorship | (() => DeploySponsorship);
  readonly verification?: () => unknown;
}) => {
  const calls: string[] = [];
  return {
    calls,
    wallet: {
      deployAccount: async (fee?: typeof deployQuote) => {
        calls.push(fee ? "deployAccount:fee" : "deployAccount:quote");
        if (!fee) return deployQuote;
        return input.selfPaid ? input.selfPaid() : "0x5e1f";
      },
      deployAccountSponsored: async () => {
        calls.push("deployAccountSponsored");
        return input.sponsored();
      },
      deploySponsorship: async () => {
        calls.push("deploySponsorship");
        return typeof input.sponsorship === "function" ? input.sponsorship() : input.sponsorship;
      },
      loadActivity: async () => input.activity?.() ?? { entries: [] },
      loadClassHashVerification: async () => input.verification?.() ?? null,
      loadDeploymentStatus: async () => ({
        accountId: DEPLOY_ACCOUNT,
        deployed: input.deployed?.() ?? false,
      }),
      loadStatus: async () => ({ networkId: "SN_SEPOLIA" }),
    } as unknown as ShellBindingDeps["wallet"],
  };
};

/** Binds the deploy screen in `container`; `options` override the defaults. */
export const bindDeployScreen = (
  container: HTMLElement,
  wallet: ShellBindingDeps["wallet"],
  options: {
    readonly accountId?: string;
    readonly current?: () => boolean;
    readonly render?: ShellBindingDeps["render"];
    readonly timers?: StageTimers;
    readonly watching?: boolean;
  } = {},
): void =>
  bindDeploy({
    app: container,
    confirmationDelaysMs: options.watching ? [0] : [],
    ...(options.timers ? { deployHoldTimers: options.timers } : {}),
    ...(options.watching || options.current
      ? {
          deploymentScope: () => ({
            accountId: options.accountId ?? DEPLOY_ACCOUNT,
            stillCurrent: options.current ?? (() => true),
          }),
        }
      : {}),
    render: options.render ?? (async () => undefined),
    setActiveView: () => undefined,
    wallet,
  });

/** Presses Deploy. */
export const press = (container: HTMLElement): void => {
  container.querySelector<HTMLButtonElement>("#deploy-button")?.click();
};
