/**
 * Multisig messages that change active wallet state. The router runs each one
 * through the active-state coordinator, so two of them never interleave.
 */

/** Message types the router serializes through the active-state coordinator. */
export const MULTISIG_ACTIVE_STATE_MESSAGES: ReadonlySet<string> = new Set([
  "wallet.addMultisig",
  "wallet.deployArgentMultisig",
  "wallet.importArgentMultisigIntent",
  "wallet.importArgentMultisigSignature",
  "wallet.prepareArgentMultisigIntent",
  "wallet.removeArgentMultisigIntent",
  "wallet.removeMultisig",
  "wallet.reviewArgentMultisigDeployment",
  "wallet.signArgentMultisigIntent",
  "wallet.prepareArgentMultisigStrk20",
  "wallet.refreshArgentMultisigStrk20",
  "wallet.shareArgentMultisigStrk20Authorization",
  "wallet.signArgentMultisigStrk20Authorization",
  "wallet.submitArgentMultisigIntent",
  "wallet.submitArgentMultisigStrk20Relay",
]);
