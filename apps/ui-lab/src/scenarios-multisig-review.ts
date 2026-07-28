import { serializeMultisigReviewPackage } from "../../../src/sidepanel/multisig-model";
import type { MultisigPortfolioData } from "../../../src/sidepanel/multisig-portfolio";
import { bindMultisigReviewTools } from "../../../src/sidepanel/multisig-review-ui";
import { multisigDetailFlow } from "../../../src/sidepanel/multisig-views";
import { multisig, pendingProposal, preferences, softwareAccount, statusFor } from "./fixtures";
import type { FrameContext, ScenarioCheckpoint } from "./types";

type ReviewCheckpoint = "decoded" | "decoder" | "entry" | "scan";

/**
 * Selects one shared-account portfolio tab without requiring wallet runtime
 * state. Unknown tab ids hide every panel so broken fixtures fail visibly.
 */
export const showSharedTab = (context: FrameContext, selected: string): void => {
  context.app.querySelectorAll<HTMLButtonElement>("[data-ms-home-tab]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset["msHomeTab"] === selected));
  });
  context.app.querySelectorAll<HTMLElement>("[data-ms-home-panel]").forEach((panel) => {
    const target = panel;
    target.hidden = target.dataset["msHomePanel"] !== selected;
  });
};

const prepareIndependentReview =
  (checkpoint: ReviewCheckpoint) =>
  (context: FrameContext): void => {
    showSharedTab(context, "proposals");
    bindMultisigReviewTools(context.app);
    const open = context.app.querySelector<HTMLButtonElement>("[data-ms-review-open]");
    if (checkpoint === "entry") {
      context.emit({ detail: "Verify elsewhere is available from proposal review", kind: "state" });
      return;
    }
    open?.click();
    const panel = context.app.querySelector<HTMLElement>("[data-ms-review-panel]");
    if (!panel || panel.hidden) {
      throw new Error("Verify elsewhere sheet did not open");
    }
    context.emit({ detail: "Verify elsewhere opened", kind: "action" });
    if (checkpoint === "scan") return;
    const decoder = panel.querySelector<HTMLDetailsElement>("details.disclosure");
    if (!decoder) {
      throw new Error("Local proposal decoder is unavailable");
    }
    decoder.open = true;
    context.emit({ detail: "Local decoder opened; network remains unused", kind: "action" });
    if (checkpoint === "decoder") return;
    const input = panel.querySelector<HTMLTextAreaElement>('textarea[name="reviewPackage"]');
    const decode = panel.querySelector<HTMLButtonElement>("[data-ms-review-decode]");
    if (!input || !decode) {
      throw new Error("Local proposal decoder controls are unavailable");
    }
    input.value = serializeMultisigReviewPackage(multisig, pendingProposal);
    decode.click();
    context.emit({
      detail: "Public package decoded locally; compare proposal id",
      kind: "response",
    });
  };

const reviewContent = (portfolio: MultisigPortfolioData): string =>
  multisigDetailFlow(
    statusFor(),
    softwareAccount,
    multisig,
    [pendingProposal],
    false,
    "current",
    preferences,
    "multisig-home",
    portfolio,
  );

/**
 * Explicit Storybook checkpoints for the secret-free independent-verification
 * path. Preparation uses the production review bindings and never contacts a
 * wallet, RPC, decoder website, or clipboard.
 */
export const multisigReviewCheckpoints = (
  portfolio: MultisigPortfolioData,
): readonly ScenarioCheckpoint[] => [
  {
    content: () => reviewContent(portfolio),
    id: "verify-elsewhere-entry",
    label: "Verify elsewhere entry",
    narrative:
      "The proposal action keeps independent verification visible beside the decoded call, before any signer action.",
    prepare: prepareIndependentReview("entry"),
    state: { action: "verify elsewhere", location: "proposal review", signerAction: "not taken" },
  },
  {
    content: () => reviewContent(portfolio),
    id: "independent-review",
    label: "Verify elsewhere · scan or copy",
    narrative:
      "A second device can scan the proposal id, while the exact secret-free package is available for an independent decoder.",
    prepare: prepareIndependentReview("scan"),
    state: {
      networkAccess: false,
      package: "secret-free",
      qrContents: "proposal id only",
      verification: "compare proposal id",
    },
  },
  {
    content: () => reviewContent(portfolio),
    id: "verify-elsewhere-decode",
    label: "Verify elsewhere · local decoder",
    narrative:
      "The offline decoder accepts a copied public package without sending it to an RPC, website, or analytics service.",
    prepare: prepareIndependentReview("decoder"),
    state: { decoder: "local only", input: "public review package", networkRequests: 0 },
  },
  {
    content: () => reviewContent(portfolio),
    id: "verify-elsewhere-decoded",
    label: "Verify elsewhere · decoded result",
    narrative:
      "Decoded network, multisig, proposal, target, method, calldata count, and salt remain visible for comparison before approval.",
    prepare: prepareIndependentReview("decoded"),
    state: {
      decoded: ["network", "multisig", "proposal", "target", "method", "calldata", "salt"],
      nextStep: "compare proposal id",
    },
  },
];
