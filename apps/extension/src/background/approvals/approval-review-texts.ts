/**
 * Review-sentence references for approvals whose English lines are decided
 * outside the verifier. Every reference re-renders to its English line and is
 * attached only when the panel's validator would accept it; otherwise the
 * approval carries English alone and the panel shows it unchanged.
 */
import { reviewSentence, reviewText, withReviewText } from "@bramble/transactions/review-messages";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import { cloneApprovalValue } from "./approval-payload";
import type { PendingApproval } from "./approval-snapshot";

/**
 * A typed-data card's references. Its first line names the message (the site's own words, a
 * fact); the rest are the OutsideExecution's decoded calls. References ride
 * only when every line has one the panel would accept.
 */
export const typedDataSummaryTexts = (
  summary: string,
  calls: NonNullable<PendingApproval["summaryTexts"]> | undefined,
): Pick<PendingApproval, "summaryTexts"> => {
  const name = withReviewText(reviewText("review.sign.name", { name: summary })).text;
  return name === undefined || calls === undefined
    ? {}
    : { summaryTexts: [name, ...calls].map((text) => cloneApprovalValue(text)) };
};

/**
 * The switch prompt's line as a review sentence, attached only when it renders
 * to exactly the summary the caller decided (and the panel would accept it).
 */
export const switchSummaryTexts = (
  networkId: StarknetNetworkId,
  summary: string,
): Pick<PendingApproval, "summaryTexts"> => {
  const sentence = reviewSentence(
    reviewText("review.switchNetwork", { network: STARKNET_NETWORKS[networkId].name }),
  );
  return sentence.summaryText === undefined || sentence.summary !== summary
    ? {}
    : { summaryTexts: [sentence.summaryText] };
};
