/**
 * Read-only official-SDK operations: private balances, registration status,
 * and the dapp shadow-account commitment. Split from ./official-sdk-service so
 * the submission half stays within the size budget. Every read that reaches
 * the discovery indexer runs under the discovery wait budget, because the
 * indexer's pagination has no transport deadline of its own.
 */

import { WalletError } from "@bramble/core/errors";
import type { RpcProvider } from "starknet";
import { num } from "starknet";
import { reportStrk20Phase } from "../policy/phases";
import { STRK20_SERVICE_UNAVAILABLE, type Strk20Service } from "../service";
import { type Strk20Waits, withinStrk20WaitBudget } from "./official-sdk-budget";
import { mapStrk20ProtocolError } from "./official-sdk-errors";
import { retryStrk20ServiceRead, type ServiceRetryPause } from "./official-sdk-retry";
import type { PrivacySdkRuntime } from "./official-sdk-runtime";
import { transfersFor } from "./official-sdk-transfers";
import { balancesFrom, readStrk20Registered, requireStrk20Config } from "./official-sdk-values";

/**
 * Reads the SDK's setup requirement as the account's *own* registration answer.
 *
 * The SDK reports four states — Register, SetupChannel, SetupToken, Ready.
 * `Register` means the caller has no viewing key registered with the pool;
 * every later state means registration is done and only per-channel setup
 * remains, which the transfer builder adds itself (`autoSetup`). Recipients are
 * deliberately not answered from here — see `readStrk20Registered`.
 */
const readSetupRequirement = (
  states: { readonly Register: number },
  requirement: number,
): "registered" | "unregistered" =>
  requirement === states.Register ? "unregistered" : "registered";

/**
 * Collaborators the read methods share with the rest of the adapter.
 */
export type Strk20ReadDeps = {
  readonly pauseForServiceRetry: ServiceRetryPause;
  readonly providerFor: (nodeUrl: string) => RpcProvider;
  readonly sdk: PrivacySdkRuntime;
  readonly waits: Strk20Waits;
};

/**
 * Builds the three read methods of the official service. Each failure is
 * mapped through the reviewed protocol-error surface; a lapsed budget arrives
 * there as a `WalletError` and passes through with its phase-naming reason.
 */
export const strk20ReadMethods = ({
  pauseForServiceRetry,
  providerFor,
  sdk,
  waits,
}: Strk20ReadDeps): Pick<
  Strk20Service,
  "privateBalances" | "registrationStatus" | "shadowAccountCommitment"
> => ({
  async privateBalances(input) {
    try {
      reportStrk20Phase(input.onPhase, "discovering private notes");
      const result = await retryStrk20ServiceRead(
        () =>
          withinStrk20WaitBudget(
            "discovering private notes",
            waits.budgets.discovery,
            () => transfersFor(sdk, input).discoverNotes(),
            waits.schedule,
          ),
        pauseForServiceRetry,
      );
      return balancesFrom(result.notes, input.tokens);
    } catch (error) {
      return mapStrk20ProtocolError(error);
    }
  },
  async registrationStatus(input) {
    try {
      reportStrk20Phase(input.onPhase, "checking registration");
      // A recipient is read straight from the pool: the discovery preflight
      // cannot distinguish an unregistered recipient from a registered one
      // this sender has never opened a channel to.
      if (input.subject !== undefined) {
        const config = requireStrk20Config(input);
        const registered = await readStrk20Registered(
          providerFor,
          input.rpcUrls,
          config.poolAddress,
          input.subject,
          pauseForServiceRetry,
        );
        return registered ? "registered" : "unregistered";
      }
      const transfers = transfersFor(sdk, input);
      const discoverRequirement = transfers.discoverRequirement;
      if (!discoverRequirement || !sdk.SetupRequirement) {
        throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
      }
      const requirement = await retryStrk20ServiceRead(
        () =>
          withinStrk20WaitBudget(
            "checking registration",
            waits.budgets.discovery,
            // Invoked ON `transfers`: the SDK method dereferences its receiver
            // (`this.discoveryProvider`), so a detached call throws a TypeError.
            () => discoverRequirement.call(transfers, input.account.address, input.token),
            waits.schedule,
          ),
        pauseForServiceRetry,
      );
      return readSetupRequirement(sdk.SetupRequirement, requirement);
    } catch (error) {
      return mapStrk20ProtocolError(error);
    }
  },
  async shadowAccountCommitment(input) {
    const config = requireStrk20Config(input);
    if (!config.shadowAccountAnonymizerAddress) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    try {
      const transfers = transfersFor(sdk, input);
      reportStrk20Phase(input.onPhase, "discovering private notes");
      await retryStrk20ServiceRead(
        () =>
          withinStrk20WaitBudget(
            "discovering private notes",
            waits.budgets.discovery,
            () => transfers.discoverNotes(),
            waits.schedule,
          ),
        pauseForServiceRetry,
      );
      const shadowAccount = transfers.build().shadowAccounts(input.dappName);
      const commitment =
        input.nonce === undefined
          ? await shadowAccount.partialCommitment()
          : await shadowAccount.commitment(input.nonce);
      return num.toHex(commitment);
    } catch (error) {
      return mapStrk20ProtocolError(error);
    }
  },
});
