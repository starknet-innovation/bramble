/**
 * Stored STRK20 routing written by an earlier build, brought to the current
 * key set before the preferences validator runs.
 *
 * Up to Wallet API 0.10.4 a network's routing could carry
 * `subaccountAnonymizerAddress`. The key is now `shadowAccountAnonymizerAddress`,
 * and the config guard rejects unknown keys, so an old record would fail the
 * whole preferences read with `Invalid stored preferences` and leave the wallet
 * without any of its settings. The old value is dropped rather than carried
 * over (#443, decision 3): it names an old-class anonymizer the pinned rc.8 SDK
 * only half-drives — address lookups fail and invokes are misrouted — so the
 * user re-enters a current anonymizer instead.
 *
 * Also rebases exact bundled Mainnet snapshots onto today's defaults on read
 * ({@link withCurrentStrk20Defaults}).
 */
import { isRecord } from "@bramble/core/json";
import {
  DEFAULT_STRK20_NETWORKS,
  STRK20_MAINNET_POOL,
  type Strk20NetworkConfig,
  type Strk20NetworkConfigs,
} from "@bramble/privacy/config";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";

const RETIRED_ANONYMIZER_KEY = "subaccountAnonymizerAddress";

const withoutRetiredKey = (config: unknown): unknown => {
  if (!isRecord(config) || !Object.hasOwn(config, RETIRED_ANONYMIZER_KEY)) {
    return config;
  }
  const { [RETIRED_ANONYMIZER_KEY]: _dropped, ...rest } = config;
  return rest;
};

/**
 * Returns `strk20Networks` with the retired anonymizer key removed from every
 * network entry, or the same reference when nothing changes. Deterministic and
 * total: a non-record map or entry is returned untouched for the validator to
 * judge, and nothing else in an entry is rewritten, so this never widens what
 * validates.
 */
export const dropRetiredStrk20RoutingKeys = (strk20Networks: unknown): unknown => {
  if (!isRecord(strk20Networks)) {
    return strk20Networks;
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const network of Object.keys(strk20Networks)) {
    const config = strk20Networks[network];
    const rewritten = withoutRetiredKey(config);
    changed ||= rewritten !== config;
    next[network] = rewritten;
  }
  return changed ? next : strk20Networks;
};

const RETIRED_STRK20_GATEWAY_BASE = "https://mc-wallet-terminal.vercel.app/api/strk20";

// The Vercel-era bundled Mainnet snapshot. Requiring every field preserves
// custom routing and an empty-map opt-out.
const isRetiredBundledMainnetRouting = (config: Strk20NetworkConfig | undefined): boolean =>
  config !== undefined &&
  config.discoveryUrl === `${RETIRED_STRK20_GATEWAY_BASE}/discovery` &&
  config.ohttpEnabled === true &&
  config.ohttpRelayUrl === undefined &&
  config.paymaster?.feeToken === STRK_TOKEN_ADDRESS &&
  config.paymaster.url === `${RETIRED_STRK20_GATEWAY_BASE}/paymaster` &&
  config.poolAddress === STRK20_MAINNET_POOL &&
  config.proverUrl === `${RETIRED_STRK20_GATEWAY_BASE}/prover` &&
  config.shadowAccountAnonymizerAddress === undefined;

// The bundled Mainnet snapshot from before the default anonymizer (#666): the
// current bundled routing, field for field, with no anonymizer at all. A user
// who set any anonymizer, or changed any endpoint, is not this snapshot.
const isPreAnonymizerBundledMainnetRouting = (
  config: Strk20NetworkConfig | undefined,
  bundled: Strk20NetworkConfig,
): boolean =>
  config !== undefined &&
  config.discoveryUrl === bundled.discoveryUrl &&
  config.ohttpEnabled === bundled.ohttpEnabled &&
  config.ohttpRelayUrl === bundled.ohttpRelayUrl &&
  config.paymaster?.feeToken === bundled.paymaster?.feeToken &&
  config.paymaster?.url === bundled.paymaster?.url &&
  config.poolAddress === bundled.poolAddress &&
  config.proverUrl === bundled.proverUrl &&
  config.shadowAccountAnonymizerAddress === undefined;

/**
 * Brings stored STRK20 routing to the current bundled defaults, or returns the
 * same reference when nothing changes. Only two exact bundled Mainnet
 * snapshots are rebased: the Vercel-era one (to today's defaults) and the one
 * from before the default anonymizer (gains the bundled anonymizer). Custom
 * routing, a user-set anonymizer, other networks, and an empty-map opt-out are
 * kept as stored. An absent map reads as the bundled defaults.
 *
 * Trust boundary: rebasing only changes which anonymizer a site's shadow-account
 * request names; every such request still needs the user's approval. Clearing
 * the anonymizer on otherwise-bundled Mainnet routing does not persist, since
 * that record is the pre-anonymizer snapshot by construction.
 */
export const withCurrentStrk20Defaults = (
  strk20Networks: Strk20NetworkConfigs | undefined,
): Strk20NetworkConfigs => {
  if (strk20Networks === undefined) {
    return DEFAULT_STRK20_NETWORKS;
  }
  if (isRetiredBundledMainnetRouting(strk20Networks.SN_MAIN)) {
    return { ...strk20Networks, ...DEFAULT_STRK20_NETWORKS };
  }
  const bundled = DEFAULT_STRK20_NETWORKS.SN_MAIN;
  if (bundled && isPreAnonymizerBundledMainnetRouting(strk20Networks.SN_MAIN, bundled)) {
    return { ...strk20Networks, SN_MAIN: bundled };
  }
  return strk20Networks;
};
