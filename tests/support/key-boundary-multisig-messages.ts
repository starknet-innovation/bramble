/**
 * Multisig requests for the exhaustive background key-boundary scan.
 *
 * Every signer-gated entry takes its proposal id from the harness rather than
 * naming one inline: a hand-written id fails the registry lookup, and a
 * response that never reached the signing path proves nothing about what the
 * signing path returns.
 */
import { account, extensionSender, KEY_BOUNDARY_MULTISIG } from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";

const signer = account.address;

/** The multisig portion of the key-boundary message catalog. */
export const MULTISIG_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  { message: { type: "wallet.multisigs" }, sender: extensionSender },
  {
    live: async (ids) => ({ id: ids.multisigId }),
    message: { id: "", type: "wallet.multisigBalances" },
    sender: extensionSender,
  },
  {
    message: { address: KEY_BOUNDARY_MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ multisigId: ids.multisigId }),
    message: {
      calldata: ["0x9", "0x0"],
      entrypoint: "transfer",
      multisigId: "",
      to: signer,
      type: "wallet.proposeMultisigTx",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ proposalId: ids.proposalId("confirm") }),
    message: { mode: "confirm-only", proposalId: "", type: "wallet.confirmMultisigProposal" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ proposalId: ids.proposalId("prepare") }),
    message: { mode: "confirm-only", proposalId: "", type: "wallet.prepareMultisigConfirmation" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ proposalId: ids.proposalId("revoke") }),
    message: { proposalId: "", type: "wallet.revokeMultisigConfirmation" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ proposalId: ids.proposalId("execute") }),
    message: { proposalId: "", type: "wallet.executeMultisigProposal" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ multisigId: ids.multisigId, txId: ids.proposalTxId }),
    message: { multisigId: "", txId: "", type: "wallet.trackMultisigProposal" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ id: ids.multisigId }),
    message: { id: "", type: "wallet.refreshMultisig" },
    sender: extensionSender,
  },
  { message: { type: "wallet.multisigClassStatus" }, sender: extensionSender },
  {
    message: { quorum: 1, signers: [signer], type: "wallet.deployMultisig" },
    sender: extensionSender,
  },
  // Ordered after every entry that needs the class on-chain: the flip below
  // puts the network in the only state a declare is reachable from, which is
  // how the request gets past the "already declared" gate and reaches the
  // artifact check the scan actually inspects.
  {
    live: async (ids) => {
      ids.undeclareMultisigClass();
      return {};
    },
    message: { type: "wallet.declareMultisigClass" },
    negative:
      "a live declare needs the vendored Sierra artifact to hash to the pinned " +
      "multisig class, which no unit-test double can forge; the fail-closed " +
      "refusal is the response under scan",
    sender: extensionSender,
  },
  // Last of the multisig entries on purpose: it drops the watched record every
  // entry above reads back.
  {
    live: async (ids) => ({ id: ids.multisigId }),
    message: { id: "", type: "wallet.removeMultisig" },
    sender: extensionSender,
  },
];
