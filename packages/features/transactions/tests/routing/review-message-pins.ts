/**
 * The English each review-sentence translation was made from, as the first 16
 * hex digits of its SHA-256. Review sentences are what a user reads before
 * signing: when an English sentence changes, its pin stops matching and
 * `review-messages.test.ts` fails until every translation of that sentence is
 * redone and the pin updated in the same change.
 */
export const REVIEW_MESSAGE_PINS: Readonly<Record<string, string>> = {
  "review.amount.units": "962ca6fd6048fae0",
  "review.amount.unitsOf": "dfcce87c2ffb2823",
  "review.call.allow": "3039ff4119286aef",
  "review.call.allowMore": "0c01865148a95e35",
  "review.call.grantOperator": "5f1ad192c3a6bb96",
  "review.call.nftApproval": "a9c5f179bcbd0617",
  "review.call.revokeOperator": "1d484184633edd52",
  "review.call.safeTransferNft": "bd99273474e07a75",
  "review.call.send": "b2d4806798012bee",
  "review.call.sendBatchMany": "683f5a453d838091",
  "review.call.sendBatchOne": "c392c8ee52c99446",
  "review.call.sendFrom": "bc73a41dff5bf0ff",
  "review.call.sendNft": "2258f3b3e7cf77b6",
  "review.call.sendNftEditions": "b4d5c7d64daaa22a",
  "review.call.swap": "f96a65f1b91fd83f",
  "review.call.unknown": "f76163882e31ca4c",
  "review.call.unknownApproval": "9468ea585cd79b56",
  "review.flag.addressPoisoning": "d15f6fd72ec891a9",
  "review.flag.foreignBeneficiary": "46badb465e386859",
  "review.flag.operatorApproval": "3fbb60c06b2c42ba",
  "review.flag.selfTransfer": "72554654fc4570be",
  "review.flag.tokenContractRecipient": "71c0202474c09788",
  "review.flag.undecodedSwap": "d770d6ec4edbc42d",
  "review.flag.unknownContract": "f65657f934bfa2df",
  "review.flag.unlimitedApproval": "3b76249d27297f33",
  "review.sign.name": "5e291d7bcb2dd847",
  "review.switchNetwork": "6702f8ab98b307f0",
  "review.stakeAction.cancelUnstake": "5685a6279a04b568",
  "review.stakeAction.claim": "1d393b0f3ffd258c",
  "review.stakeAction.claimElsewhere": "fcae9c8d2e8f9fa8",
  "review.stakeAction.stake": "faa6fa9deb371c4f",
  "review.stakeAction.stakeElsewhere": "e988d05e3e4e23a6",
  "review.stakeAction.unstake": "bda35e9cdd434d2c",
  "review.stakeAction.validator": "d4bb68fab0da74bb",
  "review.stakeAction.withdraw": "e8635b91f5306df8",
};
