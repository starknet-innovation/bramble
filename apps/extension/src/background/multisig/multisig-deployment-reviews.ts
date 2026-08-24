/**
 * Session-scoped one-time binding between deployment review and submission.
 */
import type { KeyValueStore } from "@mc-wallet/store/kv";
import type { ArgentMultisigDeploymentReview } from "./multisig-inputs";

const MAX_DEPLOYMENT_REVIEWS = 20;
const REVIEW_STORE_KEY = "mc-wallet:argent-multisig-deployment-reviews";
const reviewKey = (review: ArgentMultisigDeploymentReview): string =>
  JSON.stringify([
    review.address,
    review.fee.overallFee,
    review.fee.unit,
    review.feeAffordability,
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
  readonly put: (review: ArgentMultisigDeploymentReview) => Promise<void>;
  readonly take: (review: ArgentMultisigDeploymentReview) => Promise<boolean>;
};

/**
 * Creates a bounded one-time registry. Production persists it in trusted
 * session storage so an MV3 worker suspension between review and confirmation
 * does not invalidate user consent; tests may omit storage for an in-memory
 * registry. Storage failures fail closed.
 */
export const createArgentMultisigDeploymentReviews = (
  store?: KeyValueStore,
): ArgentMultisigDeploymentReviews => {
  let reviews: string[] = [];
  let loaded = store === undefined;
  let pending: Promise<void> = Promise.resolve();
  const locked = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation, operation);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const load = async (): Promise<void> => {
    if (loaded || !store) return;
    const stored = await store.get(REVIEW_STORE_KEY);
    reviews =
      Array.isArray(stored) &&
      stored.length <= MAX_DEPLOYMENT_REVIEWS &&
      stored.every((value) => typeof value === "string")
        ? [...stored]
        : [];
    loaded = true;
  };
  const save = async (): Promise<void> => {
    if (store) await store.set(REVIEW_STORE_KEY, reviews);
  };
  return {
    put(review) {
      return locked(async () => {
        await load();
        const key = reviewKey(review);
        const existing = reviews.indexOf(key);
        if (existing >= 0) reviews.splice(existing, 1);
        reviews.push(key);
        if (reviews.length > MAX_DEPLOYMENT_REVIEWS) reviews.shift();
        await save();
      });
    },
    take(review) {
      return locked(async () => {
        await load();
        const existing = reviews.indexOf(reviewKey(review));
        if (existing < 0) return false;
        reviews.splice(existing, 1);
        await save();
        return true;
      });
    },
  };
};
