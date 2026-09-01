import { bindUnlock, createSidepanelRuntime, locked } from "@bramble/wallet-ui/lab";
import { invokeApproval } from "../fixtures/fixtures";
import { lockedStatus } from "../fixtures/journey-fixtures";
import { messageType, nextTurn, updateForm } from "../runtime/scenario-runtime";
import type { FrameContext, WalletScenario } from "../runtime/types";

const prepareUnlockFailure = async (context: FrameContext): Promise<void> => {
  bindUnlock({
    app: context.app,
    render: async () => undefined,
    wallet: createSidepanelRuntime({
      sendMessage: async (message) => {
        const type = messageType(message);
        context.emit({ detail: type ?? "invalid request", kind: "action" });
        return { error: "Vault passphrase is incorrect" };
      },
    }),
  });
  updateForm(context, 'input[name="vaultPassphrase"]', "incorrect-fixture");
  context.app.querySelector<HTMLFormElement>("#unlock-form")?.requestSubmit();
  await nextTurn();
};

export const unlockScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => locked(lockedStatus),
      id: "locked",
      label: "Returning wallet locked",
      narrative: "The returning journey focuses on one re-authentication action.",
      state: { gate: "locked", pending: 0 },
    },
    {
      content: () => locked(lockedStatus, [invokeApproval]),
      id: "locked-request",
      label: "Request waiting at unlock",
      narrative:
        "A parked request stays visible before authentication without exposing transaction details.",
      state: { gate: "locked", pending: 1 },
    },
    {
      content: () => locked(lockedStatus),
      id: "unlock-failed",
      label: "Unlock failed",
      narrative:
        "The real unlock binding returns a specific inline recovery message and stays locked.",
      prepare: prepareUnlockFailure,
      state: { gate: "locked", result: "error" },
    },
  ],
  description: "Returning-wallet unlock, pending-request visibility, and authentication failure.",
  id: "unlock",
  surface: "sidepanel",
  title: "Returning wallet unlock",
};
