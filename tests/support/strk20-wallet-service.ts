/** Stateful official-service fake for extension-owned STRK20 journey tests. */

import type { Strk20Service, Strk20SubmissionPlan } from "@bramble/privacy/service";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import { STRK20_CALL_AND_PROOF, STRK20_RECIPIENT, STRK20_TOKEN } from "./strk20-background";

type Capture = {
  readonly recipientRegistered?: { value: boolean };
  readonly registered: { value: boolean };
  readonly registrations: { value: number };
  readonly submissions: {
    actions: readonly Strk20Action[];
    plan: Strk20SubmissionPlan;
  }[];
};

export const makeStrk20WalletService = (capture: Capture): Strk20Service => {
  const { recipientRegistered, registered, registrations, submissions } = capture;
  let preparedActions: readonly Strk20Action[] | null = null;
  const prepared = {
    allowanceGrants: [],
    calls: [
      {
        calldata: [...STRK20_CALL_AND_PROOF.call.calldata],
        contractAddress: STRK20_TOKEN,
        entrypoint: "apply_actions",
      },
    ],
    proof: STRK20_CALL_AND_PROOF.proof,
  };
  return {
    async prepare() {
      return STRK20_CALL_AND_PROOF;
    },
    async prepareAccountActions({ actions }) {
      preparedActions = actions;
      return prepared;
    },
    async prepareRegistration() {
      return prepared;
    },
    async privateBalances({ tokens }) {
      return tokens.map((entry) => ({ balance: "0xde0b6b3a7640000", token: entry }));
    },
    async poolFee() {
      return "0x1";
    },
    async quoteActions() {
      return { mode: "account", poolFeeFri: "0x1" };
    },
    async register() {
      registrations.value += 1;
      registered.value = true;
      return { transactionHash: "0x111" };
    },
    async registrationStatus(input) {
      if (input.subject !== undefined) {
        return recipientRegistered?.value === false ? "unregistered" : "registered";
      }
      return registered.value ? "registered" : "unregistered";
    },
    async shadowAccountCommitment() {
      return STRK20_RECIPIENT;
    },
    async submitActions({ actions, beforeProof, plan }) {
      if (beforeProof) await beforeProof();
      submissions.push({ actions, plan });
      return { transactionHash: "0x222" };
    },
    async submitPrepared() {
      if (preparedActions) {
        submissions.push({
          actions: preparedActions,
          plan: { mode: "account", poolFeeFri: "0x1" },
        });
        preparedActions = null;
        return { transactionHash: "0x222" };
      }
      registrations.value += 1;
      registered.value = true;
      return { transactionHash: "0x111" };
    },
  };
};
