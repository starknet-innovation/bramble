/**
 * Renders `mobile/core/generated/privacy.json`: the STRK20 routing and limits the mobile Rust core
 * embeds, from the extension's own constants. Nothing here is restated by hand.
 *
 * A network whose routing turns OHTTP on (`ohttpEnabled: true` or any `ohttpRelayUrl`) is rendered
 * as `{ id, ohttp: true }` with no URL or pool. The extension sends discovery through OHTTP for such
 * a network, so the operator never sees the viewing key beside the client's network identity; the
 * mobile core has no OHTTP client, and posting the key in plaintext would expose more than the
 * extension does. The core's loader refuses `ohttp: true` independently (mobile/docs/privacy.md
 * §1.1), so either check alone keeps the key out of a plaintext body.
 */
import { DEFAULT_STRK20_NETWORKS, type Strk20NetworkConfigs } from "@bramble/privacy/config";
import { STRK20_MAX_POOL_FEE } from "@bramble/privacy/fee-policy";
import { STRK20_WAIT_BUDGETS } from "@bramble/privacy/official-sdk-budget";
import { STRK20_LIMITS } from "@bramble/wallet-protocol/strk20";
// Not a package export: the retry bound is internal to the privacy adapter.
import { MAX_SERVICE_ATTEMPTS } from "../../packages/features/privacy/src/sdk/official-sdk-retry";
import { HEADER } from "./shared";

/** Repository-relative path of the privacy routing the Rust core embeds at compile time. */
export const PRIVACY_JSON_PATH = "mobile/core/generated/privacy.json";

const MOBILE_NETWORK_IDS = ["SN_MAIN", "SN_SEPOLIA"] as const;

/** One network as the mobile core sees it: routed plainly, or refused because of OHTTP. */
export type MobilePrivacyRoute =
  | {
      readonly discoveryUrl: string;
      readonly id: string;
      readonly ohttp: false;
      readonly poolAddress: string;
    }
  | { readonly id: string; readonly ohttp: true };

/**
 * The mobile routing for a config map: networks without routing are omitted, networks with OHTTP
 * on keep only their id. Pure, so the conformance test can feed it synthetic configs.
 */
export const mobilePrivacyRoutes = (configs: Strk20NetworkConfigs): readonly MobilePrivacyRoute[] =>
  MOBILE_NETWORK_IDS.flatMap((id): MobilePrivacyRoute[] => {
    const config = configs[id];
    if (!config) return [];
    if (config.ohttpEnabled === true || config.ohttpRelayUrl !== undefined) {
      return [{ id, ohttp: true }];
    }
    return [
      { discoveryUrl: config.discoveryUrl, id, ohttp: false, poolAddress: config.poolAddress },
    ];
  });

/** The committed `privacy.json` text for a config map (the bundled one by default). */
export const renderPrivacyRouting = (
  configs: Strk20NetworkConfigs = DEFAULT_STRK20_NETWORKS,
): string =>
  `${JSON.stringify(
    {
      generatedBy: HEADER,
      limits: {
        balances: STRK20_LIMITS.balances,
        discoveredNotes: STRK20_LIMITS.discoveredNotes,
        maxPoolFee: `0x${STRK20_MAX_POOL_FEE.toString(16)}`,
        maxServiceAttempts: MAX_SERVICE_ATTEMPTS,
        tokens: STRK20_LIMITS.tokens,
      },
      networks: mobilePrivacyRoutes(configs),
      waitBudgets: { discoveryMs: STRK20_WAIT_BUDGETS.discovery },
    },
    null,
    2,
  )}\n`;
