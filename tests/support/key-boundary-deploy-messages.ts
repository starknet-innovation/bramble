/** Account-deployment requests included in the exhaustive background message scan. */
import { extensionSender } from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";

/** The self-paid quote and the sponsored offer and submission (issue 431). */
export const DEPLOY_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  { message: { type: "wallet.deployAccount" }, sender: extensionSender },
  { message: { type: "wallet.deploySponsorship" }, sender: extensionSender },
  {
    message: { type: "wallet.deployAccountSponsored" },
    negative: "sponsorship is off by default, so the handler refuses before any relay I/O",
    sender: extensionSender,
  },
];
