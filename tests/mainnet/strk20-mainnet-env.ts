/**
 * Fail-closed environment parsing for the opt-in STRK20 mainnet test. Secret
 * values are validated but never included in an error message or returned from
 * the browser under test.
 */
import {
  isNonZeroStarkFieldElement,
  isStarkPrivateKey,
  normalizeFeltInput,
} from "../../src/starknet/networks";
import { parseTokenAmount } from "../../src/starknet/rpc";

const MAINNET_ACK = "I_UNDERSTAND_THIS_WRITES_TO_MAINNET";
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
  readonly privateKey: string;
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
  const accountAddress = normalizeFeltInput(env["MC_STRK20_E2E_ACCOUNT_ADDRESS"] ?? "");
  if (!isNonZeroStarkFieldElement(accountAddress)) {
    throw new Error("MC_STRK20_E2E_ACCOUNT_ADDRESS must be a Starknet address");
  }
  const privateKey = normalizeFeltInput(env["MC_STRK20_E2E_PRIVATE_KEY"] ?? "");
  if (!isStarkPrivateKey(privateKey)) {
    throw new Error("MC_STRK20_E2E_PRIVATE_KEY must be a valid Stark signing key");
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
    privateKey,
  };
};
