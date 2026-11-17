/**
 * Shared fail-closed checks for opt-in mainnet suites. Messages name the
 * variable that failed and never include the supplied URL or signing key.
 */
import { isServiceUrl, normalizeHostname } from "@bramble/core/service-url";

/** The acknowledgement a person must set before any suite may write to mainnet. */
export const MAINNET_WRITE_ACK = "I_UNDERSTAND_THIS_WRITES_TO_MAINNET";

/**
 * Public Starknet endpoints the wallet and the Foundation share. Automation
 * must not load them; a dedicated test RPC is required.
 */
const SHARED_MAINNET_RPC_HOSTS: ReadonlySet<string> = new Set([
  "mainnet.nodes.starknet.org",
  "wallet.nodes.starknet.org",
]);

/**
 * The refusal used when `CI` is set. `suite` is a fixed label, not env input.
 */
export const localOnlyMessage = (suite: string): string => `The ${suite} is local-only`;

/**
 * Accepts one canonical HTTPS URL and rejects the shared mainnet hosts,
 * including a trailing-dot fully-qualified name. Throws a message that does
 * not echo `value`.
 */
export const dedicatedHttpsRpcUrl = (value: string | undefined, name: string): string => {
  if (!isServiceUrl(value)) {
    throw new Error(`${name} must be a valid HTTPS service URL`);
  }
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${name} must be a valid HTTPS service URL`);
  }
  if (SHARED_MAINNET_RPC_HOSTS.has(normalizeHostname(url.hostname))) {
    throw new Error(`${name} must be a dedicated test RPC endpoint`);
  }
  return url.toString();
};

const OPT_IN_KEYS = [
  "BRAMBLE_MAINNET_E2E_ACK",
  "BRAMBLE_MAINNET_E2E_ADDRESS",
  "BRAMBLE_MAINNET_E2E_PRIVATE_KEY",
  "BRAMBLE_MAINNET_E2E_RPC_URL",
  "BRAMBLE_MAINNET_SNCAST_ACCOUNT",
  "BRAMBLE_MAINNET_SNCAST_ACCOUNTS_FILE",
  "BRAMBLE_MAINNET_SNCAST_PROFILE",
  "BRAMBLE_MAINNET_SNFOUNDRY",
] as const;

/**
 * Whether this process may run the local mainnet wallet suite.
 * `blocked` is CI. `skip` means the developer did not opt in. `opted-in`
 * means at least one suite variable is set and the loader must validate it.
 */
export const classifyLocalMainnetEnv = (
  env: Readonly<Record<string, string | undefined>>,
): "blocked" | "opted-in" | "skip" => {
  if (env["CI"]) {
    return "blocked";
  }
  const optedIn = OPT_IN_KEYS.some((key) => {
    const value = env[key];
    return value !== undefined && value.length > 0;
  });
  return optedIn ? "opted-in" : "skip";
};
