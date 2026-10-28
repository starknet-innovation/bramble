import type { PendingApproval } from "@bramble/wallet-ui/lab";
import { bindApprovals, createSidepanelRuntime } from "@bramble/wallet-ui/lab";
import { invokeApproval, watchAssetApproval } from "../fixtures/fixtures";
import { approvalFixtures } from "../fixtures/journey-fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import { nextTurn } from "../runtime/scenario-runtime";
import type { FrameContext, WalletScenario } from "../runtime/types";

export const prepareApprovalProcessing = async (context: FrameContext): Promise<void> => {
  const wallet = createSidepanelRuntime({
    sendMessage: async () => new Promise<never>(() => undefined),
  });
  bindApprovals({
    app: context.app,
    render: async () => undefined,
    wallet,
  });
  const approve = context.app.querySelector<HTMLButtonElement>('[data-approval-action="approve"]');
  if (!approve) {
    throw new Error("Missing production approval action");
  }
  approve.click();
  await nextTurn();
};

const requiredApproval = (key: keyof typeof approvalFixtures): PendingApproval => {
  const approval = approvalFixtures[key];
  if (!approval) {
    throw new Error(`Missing ${key} approval fixture`);
  }
  return approval;
};

const approvalCheckpoint = (
  id: string,
  label: string,
  narrative: string,
  approval: PendingApproval,
): WalletScenario["checkpoints"][number] => ({
  content: () => walletDashboard({ pending: [approval], view: "send" }),
  id,
  label,
  narrative,
  state: {
    blocked: approval.blocked ?? false,
    foreground: "approval",
    kind: approval.kind ?? "connect",
    origin: approval.origin,
  },
});

export const approvalsScenario: WalletScenario = {
  checkpoints: [
    approvalCheckpoint(
      "connect",
      "Connect account",
      "The site identity and account-sharing capability are explicit before access.",
      requiredApproval("connect"),
    ),
    approvalCheckpoint(
      "invoke",
      "Transaction request",
      "Decoded calls, account, network, digest, and risks supersede the interrupted wallet flow.",
      invokeApproval,
    ),
    {
      content: () => walletDashboard({ pending: [invokeApproval], view: "send" }),
      id: "processing",
      label: "Authorizing request",
      narrative:
        "After approval, a persistent live status names authorization and keeps the reviewed request locked.",
      prepare: prepareApprovalProcessing,
      state: { foreground: "approval", liveness: "authorizing", locked: true },
    },
    approvalCheckpoint(
      "typed-data",
      "Typed-data signature",
      "Domain, primary type, message fields, and raw data are reviewable without implying a transfer.",
      requiredApproval("sign"),
    ),
    approvalCheckpoint(
      "typed-data-nested",
      "Nested typed-data signature",
      "Long nested field paths wrap beside their values, so every signed value stays visible.",
      requiredApproval("signNested"),
    ),
    approvalCheckpoint(
      "private-invoke",
      "Private transaction",
      "Private actions and the frozen execution boundary remain inspectable before proof submission.",
      requiredApproval("strk20"),
    ),
    approvalCheckpoint(
      "watch-asset",
      "Watch receipt token",
      "A provider-requested ERC20 receipt token states its exact identity before tracking.",
      watchAssetApproval,
    ),
    approvalCheckpoint(
      "switch-chain",
      "Switch network",
      "The current and requested network change are kept separate from transaction approval.",
      requiredApproval("switchChain"),
    ),
    approvalCheckpoint(
      "add-chain",
      "Add custom network",
      "A dApp cannot silently persist custom network infrastructure.",
      requiredApproval("addChain"),
    ),
    approvalCheckpoint(
      "declare",
      "Declare contract class",
      "Class identity, code shape, account deployment, and fee facts precede declaration.",
      requiredApproval("declare"),
    ),
    approvalCheckpoint(
      "blocked-origin",
      "Blocked lookalike",
      "A suspicious lookalike disables approval while keeping denial and the reason available.",
      requiredApproval("blocked"),
    ),
    {
      content: () =>
        walletDashboard({
          pending: [requiredApproval("connect"), invokeApproval, requiredApproval("sign")],
          view: "settings",
        }),
      id: "queue",
      label: "Request queue",
      narrative: "The oldest request takes focus and the remaining queue length stays visible.",
      state: { foreground: "approval", pending: 3, waitingBehind: 2 },
    },
  ],
  description:
    "Every dApp-facing approval kind, proactive takeover, blocked-origin handling, and queue visibility.",
  id: "approvals",
  surface: "sidepanel",
  title: "dApp approvals",
};
