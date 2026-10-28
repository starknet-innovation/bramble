/**
 * Shared account, fee figures, and gateway script for the gasless handler
 * tests. The shipped wallet flags are not set here.
 */

import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { gaslessFeeCeiling } from "@bramble/transactions/gasless-ceiling";
import { GASLESS_FORWARDER_ADDRESS } from "@bramble/transactions/gasless-config";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";
import { canonicalFelt, USDC_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";

const pinned = GASLESS_FORWARDER_ADDRESS.SN_MAIN;
if (pinned === null) {
  throw new Error("mainnet forwarder pin is unset");
}

/** Pinned mainnet forwarder. The harness route uses this pin. */
export const FORWARDER: string = pinned;

const canonicalUsdc = canonicalFelt(USDC_TOKEN_ADDRESS);
if (canonicalUsdc === null) {
  throw new Error("USDC address is not a felt");
}

/** Short felt for native USDC. Offers use this spelling, not the padded registry address. */
export const USDC = canonicalUsdc;

/** Clock the harness installs. Execute Before is two minutes after this. */
export const NOW = 1_700_000_000;

/**
 * STRK estimate whose $1/$1 conversion is {@link REFERENCE} USDC base units.
 * The 6/5 ceiling of that reference is what an over-ceiling quote must miss.
 */
export const STRK_FEE = "5000000000000000";

/**
 * Independent USDC reference for {@link STRK_FEE} at one dollar each.
 * The happy-path quote signs this amount, which is under the 6/5 ceiling.
 */
export const REFERENCE = 5_000n;

/** One base unit over the 6/5 ceiling of {@link REFERENCE}. */
export const OVER_CEILING = gaslessFeeCeiling(REFERENCE) + 1n;

/** Hash the mocked execute returns. */
export const TX_HASH = "0x7ab";

/** Send amount. The fee token is USDC; this transfer does not spend it. */
export const AMOUNT = "1.5";

/** Recipient of the user transfer. */
export const RECIPIENT = "0x777";

/** Origin the dapp approval is queued for. */
export const DAPP_ORIGIN = "https://dapp.example";

const ethToken = defaultWalletPreferences().tokens.find(
  (token) => token.networkId === "SN_MAIN" && token.symbol === "ETH",
);
if (!ethToken) {
  throw new Error("ETH is missing from the default token list");
}

/** Tracked mainnet ETH. Sends use its id; the dapp call transfers one base unit of it. */
export const eth = ethToken;

const ADDRESS = "0x5dccf9cfdcabb9e4ef45814bda1b056bb23063d0e9b64e5a845e9dfb3d23f10";

/** Deployed OpenZeppelin account. SNIP-9 v2 signing requires this class hash. */
export const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: ADDRESS,
  classHash: OPENZEPPELIN_ACCOUNT_CLASS_HASH,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${ADDRESS}`,
  networkId: "SN_MAIN",
  publicKeyX: "0x3",
  publicKeyY: "0x4",
};

/** Extension page. Refusals reveal their message to this sender. */
export const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

/** Content-script sender for {@link DAPP_ORIGIN}. */
export const contentSender: RuntimeSender = {
  id: "extension-id",
  url: `${DAPP_ORIGIN}/app`,
};

/** Build result the mocked gateway returns for one `paymaster_buildTransaction`. */
export type BuildShape = "deploy_and_invoke" | "invoke" | "over-ceiling" | "wrong-forwarder";

/** Mutable script for the mocked mainnet gateway. */
export type GatewayScript = {
  available: boolean;
  execute: "ok" | { readonly code: string; readonly status: number };
  firstBuild: BuildShape;
  laterBuild: BuildShape;
};

/** One JSON-RPC call the harness recorded. */
export type Posted = {
  readonly method: string;
  readonly params: unknown;
  readonly url: string;
};

/** Posts of one paymaster method. */
export const byMethod = (posts: readonly Posted[], method: string): readonly Posted[] =>
  posts.filter((post) => post.method === method);
