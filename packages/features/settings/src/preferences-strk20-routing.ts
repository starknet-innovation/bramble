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
 * Also rebases exact bundled Mainnet snapshots onto today's defaults, once per
 * record ({@link withCurrentStrk20Defaults}).
 */
import { isRecord } from "@bramble/core/json";
import { DEFAULT_STRK20_NETWORKS, type Strk20NetworkConfig } from "@bramble/privacy/config";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { WalletPreferences } from "./preferences-types";

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
// The Mainnet pool both pinned snapshots below shipped with.
const SHIPPED_MAINNET_POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

// The Vercel-era bundled Mainnet snapshot. Requiring every field preserves
// custom routing and an empty-map opt-out.
const isRetiredBundledMainnetRouting = (config: Strk20NetworkConfig | undefined): boolean =>
  config !== undefined &&
  config.discoveryUrl === `${RETIRED_STRK20_GATEWAY_BASE}/discovery` &&
  config.ohttpEnabled === true &&
  config.ohttpRelayUrl === undefined &&
  config.paymaster?.feeToken === STRK_TOKEN_ADDRESS &&
  config.paymaster.url === `${RETIRED_STRK20_GATEWAY_BASE}/paymaster` &&
  config.poolAddress === SHIPPED_MAINNET_POOL &&
  config.proverUrl === `${RETIRED_STRK20_GATEWAY_BASE}/prover` &&
  config.shadowAccountAnonymizerAddress === undefined;

// The bundled Mainnet snapshot from before the default anonymizer (#666),
// pinned as shipped (v0.10.8): a later change to the bundled gateway, pool or
// fee token must not stop an install upgrading straight from it. Requiring
// every field, and no anonymizer at all, keeps a user who changed any of them.
const PRE_ANONYMIZER_GATEWAY_BASE = "https://wallet.nodes.starknet.org/api/strk20";

const isPreAnonymizerBundledMainnetRouting = (config: Strk20NetworkConfig | undefined): boolean =>
  config !== undefined &&
  config.discoveryUrl === `${PRE_ANONYMIZER_GATEWAY_BASE}/discovery` &&
  config.ohttpEnabled === false &&
  config.ohttpRelayUrl === undefined &&
  config.paymaster?.feeToken === STRK_TOKEN_ADDRESS &&
  config.paymaster.url === `${PRE_ANONYMIZER_GATEWAY_BASE}/paymaster` &&
  config.poolAddress === SHIPPED_MAINNET_POOL &&
  config.proverUrl === `${PRE_ANONYMIZER_GATEWAY_BASE}/prover` &&
  config.shadowAccountAnonymizerAddress === undefined;

/**
 * The bundled-defaults migration a record has had, kept in the record as
 * `strk20DefaultsVersion`. Step 1 is the snapshot rebase below: the default
 * anonymizer (#666) and the Vercel-era rebase before it. A later step raises
 * the current version and gates itself on its own number, never this one's.
 */
const STRK20_DEFAULTS_VERSION = 1;
const SNAPSHOT_REBASE_STEP = 1;

type Strk20Routing = Pick<WalletPreferences, "strk20DefaultsVersion" | "strk20Networks">;

/**
 * Brings stored STRK20 routing to the current bundled defaults and records that
 * it did. Total and deterministic; it never widens what validates.
 *
 * An absent map reads as the bundled defaults. A record that has not had the
 * snapshot rebase (`strk20DefaultsVersion` absent) has two exact bundled
 * Mainnet snapshots, each pinned as it shipped, rebased to today's defaults:
 * the Vercel-era one and the one from before the default anonymizer (#666).
 * Custom routing, a user-set anonymizer, other networks, and an empty-map
 * opt-out are kept as stored. Either way the result carries the version, and
 * the next preferences write persists it with the routing; every write goes
 * through a read, so no routing the user saves is ever stored without it.
 *
 * Trust boundary: the rebase runs once per record. A record past that step is
 * returned as stored, so clearing the anonymizer on otherwise-bundled Mainnet
 * routing sticks; the rebase only ever changes which anonymizer a site's
 * shadow-account request names, and every such request still needs approval.
 */
export const withCurrentStrk20Defaults = ({
  strk20DefaultsVersion,
  strk20Networks,
}: Strk20Routing): Required<Strk20Routing> => {
  const version = Math.max(strk20DefaultsVersion ?? 0, STRK20_DEFAULTS_VERSION);
  if (strk20Networks === undefined) {
    return { strk20DefaultsVersion: version, strk20Networks: DEFAULT_STRK20_NETWORKS };
  }
  const rebase =
    (strk20DefaultsVersion ?? 0) < SNAPSHOT_REBASE_STEP &&
    (isRetiredBundledMainnetRouting(strk20Networks.SN_MAIN) ||
      isPreAnonymizerBundledMainnetRouting(strk20Networks.SN_MAIN));
  return {
    strk20DefaultsVersion: version,
    strk20Networks: rebase ? { ...strk20Networks, ...DEFAULT_STRK20_NETWORKS } : strk20Networks,
  };
};
