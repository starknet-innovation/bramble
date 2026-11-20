/**
 * SHA-256 prefixes (16 hex digits) of the English of every message in the
 * `review-*.ts` UI catalogs, split by family to stay under the file-size cap.
 * See `review-pins.test.ts`.
 */
import { REVIEW_SHARED_PINS } from "./review-pins-shared";
import { REVIEW_STEPS_PINS } from "./review-pins-steps";

export const REVIEW_UI_PINS: Readonly<Record<string, string>> = {
  ...REVIEW_SHARED_PINS,
  ...REVIEW_STEPS_PINS,
};
