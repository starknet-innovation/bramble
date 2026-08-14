/**
 * Worker-local one-time binding between deployment review and submission.
 */
import type { ArgentMultisigDeploymentReview } from "./multisig-inputs";

const MAX_DEPLOYMENT_REVIEWS = 20;
const reviewKey = (review: ArgentMultisigDeploymentReview): string =>
  JSON.stringify([
    review.address,
    review.fee.overallFee,
    review.fee.unit,
    review.name ?? null,
    review.networkId,
    review.salt,
    review.signerAccountId,
    review.signerPublicKeys,
    review.threshold,
  ]);

/**
 * One-time exact-review registry; worker restart fails closed and requires re-review.
 */
export type ArgentMultisigDeploymentReviews = {
  readonly put: (review: ArgentMultisigDeploymentReview) => void;
  readonly take: (review: ArgentMultisigDeploymentReview) => boolean;
};

/**
 * Creates a bounded one-time review registry with synchronous atomic consume.
 */
export const createArgentMultisigDeploymentReviews = (): ArgentMultisigDeploymentReviews => {
  const reviews: string[] = [];
  return {
    put(review) {
      const key = reviewKey(review);
      const existing = reviews.indexOf(key);
      if (existing >= 0) reviews.splice(existing, 1);
      reviews.push(key);
      if (reviews.length > MAX_DEPLOYMENT_REVIEWS) reviews.shift();
    },
    take(review) {
      const existing = reviews.indexOf(reviewKey(review));
      if (existing < 0) return false;
      reviews.splice(existing, 1);
      return true;
    },
  };
};
