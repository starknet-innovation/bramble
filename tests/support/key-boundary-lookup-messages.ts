/** Read-only account lookups included in the exhaustive background message scan. */
import { extensionSender } from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";

/** Live lookup requests: none of them may return secret material. */
export const LOOKUP_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  { message: { type: "wallet.accountSignability" }, sender: extensionSender },
  { message: { type: "wallet.deploymentStatus" }, sender: extensionSender },
  { message: { type: "wallet.verifyClassHash" }, sender: extensionSender },
  {
    message: { name: "fricoben.stark", networkId: "SN_MAIN", type: "wallet.resolveStarkName" },
    sender: extensionSender,
  },
];
