/**
 * Shared dependency contract for independent multisig interaction binders.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import type { SendIntent } from "../send/send-model";
import type { MultisigClient } from "./multisig-runtime";

/**
 * Capabilities multisig UI binders may use. Navigation remains explicit and
 * signer actions never mutate the wallet's active account as a side effect.
 */
export type MultisigUiDeps = {
  readonly app: Element | null;
  readonly multisig: MultisigClient;
  readonly openDetail: (id: string, destination?: "multisig-detail" | "multisig-home") => void;
  readonly openIntent: (accountId: string, intentId: string) => void;
  readonly openFunding?: (intent: SendIntent) => Promise<void>;
  readonly openList: () => void;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly selectedMultisigId: () => string | null;
  readonly wallet: SidepanelWallet;
};
