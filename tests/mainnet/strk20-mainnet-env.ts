/**
 * Fail-closed environment parsing for the opt-in STRK20 mainnet test. Secret
 * values are validated but never included in an error message or returned from
 * the browser under test.
 */

import { isServiceUrl } from "@mc-wallet/core/service-url";
import { parseTokenAmount } from "@mc-wallet/starknet/rpc";
import {
  isNonZeroStarkFieldElement,
  isStarkPrivateKey,
  normalizeFeltInput,
} from "@mc-wallet/wallet-model/networks";

const MAINNET_ACK = "I_UNDERSTAND_THIS_WRITES_TO_MAINNET";
const PUBLIC_CALLER_ACK = "I_UNDERSTAND_THIS_LINKS_PRIVATE_ACTIONS";
const RESUME_AFTER_DEPOSIT_ACK = "I_UNDERSTAND_DEPOSIT_ALREADY_SUCCEEDED";
const STRK_DECIMALS = 18;
const MAX_DEPOSIT_RAW = 10n ** 18n;

/**
 * Validated live-test inputs. `privateKey` must remain process-local and may be
 * passed only to the extension's audited import boundary.
 */
export type Strk20MainnetEnvironment = {
  readonly accountAddress: string;
  readonly actionAmount: string;
  readonly depositAmount: string;
  readonly depositAmountRaw: bigint;
  readonly discoveryUrl: string;
  readonly privateKey: string;
  readonly proverUrl: string;
  readonly resumeAfterDeposit: boolean;
  readonly rpcUrl: string;
};

const httpsServiceUrl = (value: string | undefined, name: string): string => {
  if (!isServiceUrl(value)) {
    throw new Error(`${name} must be a valid HTTPS service URL`);
  }
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${name} must be a valid HTTPS service URL`);
  }
  return url.toString();
};

/**
 * Reads the explicit mainnet-write opt-in and bounded test amount. It rejects
 * CI and malformed inputs without echoing any supplied value.
 */
export const readStrk20MainnetEnvironment = (
  env: Readonly<Record<string, string | undefined>>,
): Strk20MainnetEnvironment => {
  if (env["CI"]) {
    throw new Error("The STRK20 live-mainnet suite is local-only");
  }
  if (env["MC_STRK20_E2E_MAINNET_ACK"] !== MAINNET_ACK) {
    throw new Error(`Set MC_STRK20_E2E_MAINNET_ACK=${MAINNET_ACK} to permit mainnet writes`);
  }
  if (env["MC_STRK20_E2E_PUBLIC_CALLER_ACK"] !== PUBLIC_CALLER_ACK) {
    throw new Error(
      `Set MC_STRK20_E2E_PUBLIC_CALLER_ACK=${PUBLIC_CALLER_ACK} to permit public-caller submission`,
    );
  }
  const accountAddress = normalizeFeltInput(env["MC_STRK20_E2E_ACCOUNT_ADDRESS"] ?? "");
  if (!isNonZeroStarkFieldElement(accountAddress)) {
    throw new Error("MC_STRK20_E2E_ACCOUNT_ADDRESS must be a Starknet address");
  }
  const privateKey = normalizeFeltInput(env["MC_STRK20_E2E_PRIVATE_KEY"] ?? "");
  if (!isStarkPrivateKey(privateKey)) {
    throw new Error("MC_STRK20_E2E_PRIVATE_KEY must be a valid Stark signing key");
  }
  const discoveryUrl = httpsServiceUrl(
    env["MC_STRK20_E2E_DISCOVERY_URL"],
    "MC_STRK20_E2E_DISCOVERY_URL",
  );
  const proverUrl = httpsServiceUrl(env["MC_STRK20_E2E_PROVER_URL"], "MC_STRK20_E2E_PROVER_URL");
  const rpcUrl = httpsServiceUrl(env["MC_STRK20_E2E_RPC_URL"], "MC_STRK20_E2E_RPC_URL");
  const resumeValue = env["MC_STRK20_E2E_RESUME_AFTER_DEPOSIT_ACK"];
  if (resumeValue !== undefined && resumeValue !== RESUME_AFTER_DEPOSIT_ACK) {
    throw new Error(
      `Set MC_STRK20_E2E_RESUME_AFTER_DEPOSIT_ACK=${RESUME_AFTER_DEPOSIT_ACK} to resume after a confirmed deposit`,
    );
  }
  const depositAmount = env["MC_STRK20_E2E_DEPOSIT_STRK"] ?? "";
  let depositAmountRaw: bigint;
  try {
    depositAmountRaw = parseTokenAmount(depositAmount, STRK_DECIMALS);
  } catch {
    throw new Error("MC_STRK20_E2E_DEPOSIT_STRK must be a positive decimal STRK amount");
  }
  if (depositAmountRaw > MAX_DEPOSIT_RAW) {
    throw new Error("MC_STRK20_E2E_DEPOSIT_STRK exceeds the hard 1 STRK safety cap");
  }
  const actionAmountRaw = depositAmountRaw / 10n;
  if (actionAmountRaw === 0n) {
    throw new Error("MC_STRK20_E2E_DEPOSIT_STRK is too small for transfer and withdrawal checks");
  }
  return {
    accountAddress,
    actionAmount: `0x${actionAmountRaw.toString(16)}`,
    depositAmount,
    depositAmountRaw,
    discoveryUrl,
    privateKey,
    proverUrl,
    resumeAfterDeposit: resumeValue === RESUME_AFTER_DEPOSIT_ACK,
    rpcUrl,
  };
};
