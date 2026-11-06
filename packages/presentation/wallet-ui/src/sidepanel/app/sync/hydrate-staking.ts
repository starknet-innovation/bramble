/**
 * The staking screen's reads (issue 750). With one validator open: its pools,
 * kept only while it is still the one open. On Home, only "Your stakes" (where
 * staking is on). Otherwise "Your stakes" and the
 * directory's first page, each read again only after a failure (going back
 * from a validator resets "Your stakes", since an action may have changed it).
 * Every read is the background's; with no Starkscan route it answers "off"
 * without a request.
 */
import type { SidepanelWallet } from "../../runtime/runtime";
import type { RenderData } from "../rendering/render-cache";

/**
 * Queues the staking reads the current screen needs. `fill` drops a reply that
 * lands after a newer render.
 */
export const hydrateStaking = (
  input: {
    readonly cache: RenderData;
    /** Home reads only "Your stakes", for its Staking tab and "Staked" line. */
    readonly home?: boolean;
    readonly wallet: Pick<
      SidepanelWallet,
      "loadStakingDirectory" | "loadStakingPositions" | "loadStakingValidator"
    >;
  },
  fill: <T>(load: Promise<T>, assign: (value: T) => void) => void,
): void => {
  const { cache, wallet } = input;
  const opened = input.home ? undefined : cache.staking.selected?.staker;
  if (opened) {
    fill(wallet.loadStakingValidator(opened), (value) => {
      if (cache.staking.selected?.staker === opened)
        cache.staking = { ...cache.staking, validator: value };
    });
    return;
  }
  const { directory, positions } = cache.staking;
  if ("loading" in positions || "unavailable" in positions) {
    fill(wallet.loadStakingPositions(), (value) => {
      if (input.home || !cache.staking.selected)
        cache.staking = { ...cache.staking, positions: value };
    });
  }
  if (!input.home && !("entries" in directory)) {
    fill(wallet.loadStakingDirectory(), (value) => {
      cache.staking = { ...cache.staking, directory: value };
    });
  }
};
