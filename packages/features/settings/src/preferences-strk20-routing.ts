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
 */
import { isRecord } from "@bramble/core/json";

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
