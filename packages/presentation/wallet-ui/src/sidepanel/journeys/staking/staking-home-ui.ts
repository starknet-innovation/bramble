/**
 * Home's staking bindings (issue 750): the Tokens and Staking tabs (click, and
 * the arrow, Home and End keys), the "Staked" line that opens the Staking tab,
 * the Stake button that opens the validator list, and the position rows that
 * open their validator. Opening a validator records only its staker address
 * and any directory name; the staking screen reads everything on chain again.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import type { StakingState } from "./staking-directory-client";
import type { HomeTab } from "./staking-home";

const TABS: readonly HomeTab[] = ["tokens", "staking"];

/**
 * Dependencies the Home staking bindings close over. `state` and `setState`
 * read and write the shell's render cache at event time.
 */
export type HomeStakingUiDeps = {
  readonly app: Element | null;
  readonly navigate: (view: "staking") => void;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly setState: (state: StakingState) => void;
  readonly state: () => StakingState;
  readonly status: () => WalletStatus;
};

/**
 * Binds Home's staking controls. Absent controls bind nothing.
 */
export const bindHomeStaking = (deps: HomeStakingUiDeps): void => {
  const { app, navigate, render, setState, state, status } = deps;
  // The repaint replaces the tab buttons, so focus moves to the chosen tab
  // whether it was clicked, keyed to or opened from the "Staked" line.
  const select = (tab: HomeTab): void => {
    setState({ ...state(), homeTab: tab });
    void render(status()).then(() => {
      app?.querySelector<HTMLButtonElement>(`#home-tab-${tab}`)?.focus();
    });
  };
  app?.querySelectorAll<HTMLButtonElement>("[data-home-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const value = TABS.find((item) => item === tab.dataset["homeTab"]);
      if (value) select(value);
    });
    tab.addEventListener("keydown", (event) => {
      const index = TABS.findIndex((item) => item === tab.dataset["homeTab"]);
      const next =
        event.key === "ArrowRight"
          ? TABS[(index + 1) % TABS.length]
          : event.key === "ArrowLeft"
            ? TABS[(index + TABS.length - 1) % TABS.length]
            : event.key === "Home"
              ? TABS[0]
              : event.key === "End"
                ? TABS[TABS.length - 1]
                : undefined;
      if (index < 0 || next === undefined) return;
      event.preventDefault();
      select(next);
    });
  });
  app?.querySelector<HTMLButtonElement>("[data-home-tab-open]")?.addEventListener("click", () => {
    select("staking");
  });
  app?.querySelectorAll<HTMLButtonElement>("[data-staking-list]").forEach((control) => {
    control.addEventListener("click", () => {
      setState({ ...state(), selected: null, validator: { loading: true } });
      navigate("staking");
    });
  });
  app?.querySelectorAll<HTMLButtonElement>("[data-staking-go]").forEach((control) => {
    control.addEventListener("click", () => {
      const staker = control.dataset["stakingGo"];
      if (!staker) return;
      const current = state();
      const listed = "entries" in current.directory ? current.directory.entries : [];
      const name = listed.find((entry) => entry.staker === staker)?.name ?? null;
      setState({ ...current, selected: { name, staker }, validator: { loading: true } });
      navigate("staking");
    });
  });
};
