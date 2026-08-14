/** Compact production-view coverage for the Argent frozen-intent lifecycle. */
import { argentMultisig } from "../fixtures/fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import type { WalletScenario } from "../runtime/types";

const views = [
  "multisigs",
  "multisig-add",
  "multisig-watch",
  "multisig-home",
  "multisig-detail",
  "multisig-signers",
  "multisig-track",
  "multisig-receive",
  "multisig-propose",
  "multisig-deploy",
] as const;

export const multisigScenario: WalletScenario = {
  checkpoints: views.map((view) => ({
    content: () =>
      walletDashboard({
        multisigClassDeclared: true,
        multisigs: [argentMultisig],
        selectedMultisigId: argentMultisig.record.id,
        view,
      }),
    id: view,
    label: view.replaceAll("-", " "),
    narrative:
      "The wallet uses the pinned Argent account, fresh signer authority, and frozen signing intents.",
    state: { accountContract: "Argent Multisig 0.2", view },
  })),
  description:
    "Argent account setup, watching, deployment, signer review, exact intent exchange, and submission surfaces.",
  id: "multisig",
  surface: "sidepanel",
  title: "Argent multisig",
  views,
};
