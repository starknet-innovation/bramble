/**
 * Shared dependency contract for independent multisig interaction binders.
 */
import type { WalletStatus } from "../popup/responses";
import type { MultisigClient } from "./multisig-runtime";
import type { SidepanelWallet } from "./runtime";

/**
 * Capabilities multisig UI binders may use. Navigation remains explicit and
 * signer actions never mutate the wallet's active account as a side effect.
 */
export type MultisigUiDeps = {
  readonly app: Element | null;
  readonly multisig: MultisigClient;
  readonly openDetail: (id: string) => void;
  readonly openList: () => void;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly selectedMultisigId: () => string | null;
  readonly wallet: SidepanelWallet;
};
