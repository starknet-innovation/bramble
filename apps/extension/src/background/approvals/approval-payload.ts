/**
 * Private approval-payload cloning and reconstruction. Kept outside the queue
 * so adding approval kinds does not make the queue's trust boundary opaque.
 */

import type { Strk20SubmissionPlan } from "@mc-wallet/privacy/service";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { ProviderChain } from "@mc-wallet/wallet-protocol/add-chain";
import type { ProviderDeclare } from "@mc-wallet/wallet-protocol/declare";
import type { Strk20Action, Strk20Proof } from "@mc-wallet/wallet-protocol/strk20";
import type { Call } from "starknet";
import type {
  Strk20DisclosureApprovalKind,
  Strk20DisclosureRequest,
} from "../privacy/strk20-approval-types";

/**
 * Every user-decision category supported by the in-memory approval queue.
 */
export type ApprovalKind =
  | "add-chain"
  | "connect"
  | "declare"
  | "invoke"
  | "sign-typed-data"
  | Strk20DisclosureApprovalKind
  | "strk20-invoke"
  | "switch-chain"
  | "watch-asset";

/**
 * Private execution data retained until the corresponding approval is claimed.
 */
export type ApprovalPayload = {
  readonly actions?: readonly Strk20Action[];
  readonly calls?: readonly Call[];
  readonly chain?: ProviderChain;
  readonly chainId?: string;
  readonly declare?: ProviderDeclare;
  readonly networkId?: StarknetNetworkId;
  readonly proof?: Strk20Proof;
  readonly strk20Request?: Strk20DisclosureRequest;
  readonly strk20Plan?: Strk20SubmissionPlan;
  readonly typedData?: unknown;
};

type StoredApprovalPayload = ApprovalPayload & { readonly kind: ApprovalKind };
type PayloadReader = (approval: StoredApprovalPayload) => ApprovalPayload | null;

/**
 * Clones one Starknet call so mutable calldata never aliases queue state.
 */
export const cloneApprovalCall = (call: Call): Call =>
  Array.isArray(call.calldata) ? { ...call, calldata: [...call.calldata] } : { ...call };

/**
 * Deep-clones bounded approval data before storing or returning it.
 */
export const cloneApprovalValue = <T>(value: T): T => structuredClone(value);

const readSwitch: PayloadReader = (approval) =>
  approval.chainId === undefined || approval.networkId === undefined
    ? null
    : { chainId: approval.chainId, networkId: approval.networkId };

const readStrk20Invoke: PayloadReader = (approval) =>
  approval.actions === undefined || approval.strk20Plan === undefined
    ? null
    : {
        actions: cloneApprovalValue(approval.actions),
        strk20Plan: cloneApprovalValue(approval.strk20Plan),
      };

const readStrk20Disclosure: PayloadReader = (approval) =>
  approval.strk20Request === undefined
    ? null
    : { strk20Request: cloneApprovalValue(approval.strk20Request) };

const readInvoke: PayloadReader = (approval) =>
  approval.calls === undefined
    ? null
    : {
        calls: approval.calls.map(cloneApprovalCall),
        ...(approval.proof === undefined ? {} : { proof: cloneApprovalValue(approval.proof) }),
      };

const empty: PayloadReader = () => null;

const READERS: Readonly<Record<ApprovalKind, PayloadReader>> = {
  "add-chain": (approval) =>
    approval.chain === undefined ? null : { chain: cloneApprovalValue(approval.chain) },
  connect: empty,
  declare: (approval) =>
    approval.declare === undefined ? null : { declare: cloneApprovalValue(approval.declare) },
  invoke: readInvoke,
  "sign-typed-data": (approval) =>
    approval.typedData === undefined ? null : { typedData: cloneApprovalValue(approval.typedData) },
  "strk20-balances": readStrk20Disclosure,
  "strk20-invoke": readStrk20Invoke,
  "strk20-prepare": readStrk20Disclosure,
  "strk20-register": readStrk20Disclosure,
  "strk20-subaccount": readStrk20Disclosure,
  "switch-chain": readSwitch,
  "watch-asset": empty,
};

/**
 * Reconstructs the exact private execution payload for an approval kind.
 * Missing required fields fail closed with null.
 */
export const readStoredApprovalPayload = (
  approval: StoredApprovalPayload,
): ApprovalPayload | null => READERS[approval.kind](approval);
