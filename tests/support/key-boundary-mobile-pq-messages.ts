/**
 * The paired-phone slice of the key-boundary catalog: enrollment and signing.
 *
 * Split from the main catalog to keep both inside the file budget, the same way
 * the multisig and STRK20 slices are. Every entry is live — the enrollment one
 * issues a real challenge and signs it with the fixture device, so the scan sees
 * a created account rather than a refusal, which is the response that could
 * carry material it should not.
 */
import {
  extensionSender,
  KEY_BOUNDARY_ML_DSA_DEVICE,
  KEY_BOUNDARY_ML_DSA_PUBLIC_KEY,
  KEY_BOUNDARY_ML_DSA_SIGNATURE,
} from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";

/**
 * Paired-phone catalog entries.
 */
export const MOBILE_PQ_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  { message: { type: "wallet.mobilePqEnrollChallenge" }, sender: extensionSender },
  {
    // Fully live: issue a real challenge, sign it with the fixture device, and
    // let the enrollment succeed. That is the case worth scanning — the refusal
    // path returns nothing, while a created account is a response that could
    // carry material it should not.
    live: async (ids) => {
      const challenge = await ids.mobilePqEnrollChallenge();
      return { challenge, signature: KEY_BOUNDARY_ML_DSA_DEVICE.sign(challenge) };
    },
    message: {
      challenge: "0x1",
      classHash: "0x2",
      deviceId: "key-boundary-phone",
      mlDsaKind: "const",
      networkId: "SN_MAIN",
      publicKey: KEY_BOUNDARY_ML_DSA_PUBLIC_KEY,
      signature: KEY_BOUNDARY_ML_DSA_SIGNATURE,
      type: "wallet.addMobilePqAccount",
    },
    sender: extensionSender,
  },
  { message: { type: "wallet.mobilePqSignPending" }, sender: extensionSender },
  {
    live: async (ids) => ({ id: await ids.mobilePqSignId() }),
    message: {
      id: "",
      signature: KEY_BOUNDARY_ML_DSA_SIGNATURE,
      type: "wallet.completeMobilePqSign",
    },
    sender: extensionSender,
  },
];
