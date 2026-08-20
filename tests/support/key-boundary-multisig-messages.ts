/** Argent multisig requests for the exhaustive background key-boundary scan. */
import {
  account,
  extensionSender,
  KEY_BOUNDARY_MULTISIG,
  KEY_BOUNDARY_MULTISIG_CONFIG,
} from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";

/** Every privileged Argent multisig runtime message, with live durable ids. */
export const MULTISIG_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  { message: { type: "wallet.multisigs" }, sender: extensionSender },
  {
    live: async (ids) => ({ multisigId: ids.multisigId }),
    message: { multisigId: "", type: "wallet.multisigBalances" },
    sender: extensionSender,
  },
  {
    message: {
      address: KEY_BOUNDARY_MULTISIG,
      networkId: "SN_MAIN",
      type: "wallet.addMultisig",
    },
    sender: extensionSender,
  },
  {
    message: {
      address: account.address,
      networkId: "SN_MAIN",
      type: "wallet.resolveMultisigSigner",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ multisigId: ids.multisigId }),
    message: { multisigId: "", type: "wallet.refreshMultisig" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ multisigId: ids.multisigId }),
    message: {
      calls: [{ calldata: ["0x9"], contractAddress: account.address, entrypoint: "transfer" }],
      multisigId: "",
      type: "wallet.prepareArgentMultisigIntent",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ package: ids.multisigIntentPackage }),
    message: { package: {}, type: "wallet.importArgentMultisigIntent" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ intentId: ids.multisigSignIntentId }),
    message: {
      intentId: "",
      signerAccountId: account.id,
      type: "wallet.signArgentMultisigIntent",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ids.multisigSignatureImport,
    message: { intentId: "", signature: {}, type: "wallet.importArgentMultisigSignature" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ intentId: ids.multisigSubmitIntentId }),
    message: { intentId: "", type: "wallet.submitArgentMultisigIntent" },
    sender: extensionSender,
  },
  { message: { type: "wallet.argentMultisigClassStatus" }, sender: extensionSender },
  {
    message: {
      networkId: "SN_MAIN",
      salt: "0x9",
      signerAccountId: account.id,
      ...KEY_BOUNDARY_MULTISIG_CONFIG,
      type: "wallet.reviewArgentMultisigDeployment",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ review: await ids.multisigDeploymentReview() }),
    message: { review: {}, type: "wallet.deployArgentMultisig" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ multisigId: ids.multisigId }),
    message: { multisigId: "", type: "wallet.removeMultisig" },
    negative: "pending frozen intents deliberately make destructive removal fail closed",
    sender: extensionSender,
  },
];
