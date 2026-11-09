/**
 * Staking list bindings (issue 750): paste a validator address, open one from
 * the directory, go back to the list, and load the next page. Opening a
 * validator only records its staker address (and the directory name to show
 * beside it); the validator screen then reads and verifies everything on chain, and an action there is prepared by the
 * background from that address alone.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy } from "../../shared/dom";
import { appendDirectoryPage, pastedStaker, type StakingState } from "./staking-directory-client";

/**
 * Dependencies the list bindings close over. `state` and `setState` read and
 * write the shell's render cache at event time, so a binding installed on one
 * paint still sees current state.
 */
export type StakingDirectoryUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly setState: (state: StakingState) => void;
  readonly state: () => StakingState;
  readonly status: () => WalletStatus;
  readonly wallet: Pick<SidepanelWallet, "loadStakingDirectory">;
};

/**
 * Binds the staking list: paste, open, back and "Show more".
 */
export const bindStakingDirectory = (deps: StakingDirectoryUiDeps): void => {
  const { app, render, setState, state, status, wallet } = deps;
  const repaint = (next: StakingState): void => {
    setState(next);
    void render(status());
  };
  const open = (staker: string): void => {
    const current = state();
    const listed = "entries" in current.directory ? current.directory.entries : [];
    const name = listed.find((entry) => entry.staker === staker)?.name ?? null;
    repaint({ ...current, selected: { name, staker }, validator: { loading: true } });
  };
  const form = app?.querySelector<HTMLFormElement>("[data-staking-paste]");
  const error = app?.querySelector<HTMLElement>("[data-staking-paste-error]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const field = form.querySelector<HTMLInputElement>("[data-staking-paste-input]");
    const staker = pastedStaker(field?.value ?? "");
    if (staker === null) {
      if (error) {
        error.hidden = false;
        error.textContent = "Enter a valid Starknet address.";
      }
      field?.focus();
      return;
    }
    open(staker);
  });
  app?.querySelectorAll<HTMLButtonElement>("[data-staking-open]").forEach((control) => {
    control.addEventListener("click", () => {
      const staker = pastedStaker(control.dataset["stakingOpen"] ?? "");
      if (staker) open(staker);
    });
  });
  app?.querySelector<HTMLButtonElement>("[data-staking-back]")?.addEventListener("click", () => {
    // "Your stakes" is read again: an action on that screen may have changed it.
    repaint({
      ...state(),
      positions: { loading: true },
      selected: null,
      validator: { loading: true },
    });
  });
  const more = app?.querySelector<HTMLButtonElement>("[data-staking-more]");
  more?.addEventListener("click", () => {
    const { directory } = state();
    if (!("entries" in directory) || directory.nextCursor === null) return;
    buttonBusy(more, true);
    void wallet.loadStakingDirectory(directory.nextCursor).then((next) => {
      const current = state();
      // A list replaced meanwhile (another account or network) is not extended.
      if (current.directory !== directory) return;
      repaint({ ...current, directory: appendDirectoryPage(directory, next) });
    });
  });
};
