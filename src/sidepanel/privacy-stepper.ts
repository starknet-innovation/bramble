/**
 * Shield stepper bindings for the unified asset dropdowns: +/- preview moving
 * a percentage of an asset between its public and private balances, and the
 * confirm button hands the shield delta to the existing deposit review.
 * Preview state lives only in the rendered row and resets on repaint;
 * unshielding (private to public) is previewed but not yet submittable.
 */

import { formatTokenAmount } from "../starknet/rpc";
import { compactAmount } from "./token-row";

/**
 * Collaborators for the shield stepper. `openShieldReview` receives the
 * asset and the exact decimal amount to shield and is expected to run the
 * standard deposit-review journey (preparation, fee disclosure, confirm).
 */
export type ShieldStepperDeps = {
  readonly app: Element | null;
  /** Monotonic milliseconds, injected — this module never reads a clock. */
  readonly now: () => number;
  readonly openShieldReview: (tokenId: string, amount: string) => void;
};

// One click moves 5% of the asset's combined balance; clicks within the
// acceleration window double the step (10%, 20%, 40% cap), and a pause
// resets it. Values are per-mille to stay in integer bigint math.
const BASE_STEP_PER_MILLE = 50n;
const MAX_STEP_PER_MILLE = 400n;
const ACCELERATION_WINDOW_MS = 500;

type StepperState = {
  lastClickAt: number;
  step: bigint;
  targetPublic: bigint;
};

const readBigInt = (value: string | undefined): bigint | null => {
  if (value === undefined) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
};

const clamp = (value: bigint, max: bigint): bigint => (value < 0n ? 0n : value > max ? max : value);

const bindRow = (row: HTMLElement, deps: ShieldStepperDeps): void => {
  const tokenId = row.dataset["shieldRow"];
  const decimals = Number(row.dataset["shieldDecimals"]);
  const symbol = row.dataset["shieldSymbol"] ?? "";
  const publicBalance = readBigInt(row.dataset["shieldPublic"]);
  const privateBalance = readBigInt(row.dataset["shieldPrivateRaw"]);
  const publicValue = row.querySelector<HTMLElement>("[data-shield-public-value]");
  const privateValue = row.querySelector<HTMLElement>("[data-shield-private]");
  const confirm = row.querySelector<HTMLButtonElement>("[data-shield-confirm]");
  if (
    !tokenId ||
    !Number.isSafeInteger(decimals) ||
    publicBalance === null ||
    privateBalance === null ||
    !publicValue ||
    !privateValue ||
    !confirm
  ) {
    return;
  }
  const total = publicBalance + privateBalance;
  const state: StepperState = {
    lastClickAt: Number.NEGATIVE_INFINITY,
    step: BASE_STEP_PER_MILLE,
    targetPublic: publicBalance,
  };
  const now = deps.now;

  const paintPreview = (): void => {
    const targetPrivate = total - state.targetPublic;
    publicValue.textContent = `${compactAmount(formatTokenAmount(state.targetPublic, decimals))} ${symbol}`;
    privateValue.textContent = `${compactAmount(formatTokenAmount(targetPrivate, decimals))} ${symbol}`;
    if (state.targetPublic === publicBalance) {
      confirm.hidden = true;
      confirm.disabled = false;
      confirm.removeAttribute("title");
      return;
    }
    confirm.hidden = false;
    if (state.targetPublic < publicBalance) {
      const delta = formatTokenAmount(publicBalance - state.targetPublic, decimals);
      confirm.textContent = `Shield ${compactAmount(delta)} ${symbol}`;
      confirm.disabled = false;
      confirm.removeAttribute("title");
    } else {
      const delta = formatTokenAmount(state.targetPublic - publicBalance, decimals);
      confirm.textContent = `Unshield ${compactAmount(delta)} ${symbol}`;
      confirm.disabled = true;
      confirm.title = "Unshielding is coming soon";
    }
  };

  const stepBy = (direction: 1n | -1n): void => {
    if (total === 0n) {
      return;
    }
    const at = now();
    state.step =
      at - state.lastClickAt <= ACCELERATION_WINDOW_MS
        ? state.step * 2n > MAX_STEP_PER_MILLE
          ? MAX_STEP_PER_MILLE
          : state.step * 2n
        : BASE_STEP_PER_MILLE;
    state.lastClickAt = at;
    const amount = (total * state.step) / 1000n;
    state.targetPublic = clamp(state.targetPublic + direction * (amount > 0n ? amount : 1n), total);
    paintPreview();
  };

  row.querySelectorAll<HTMLButtonElement>("[data-shield-step]").forEach((button) => {
    button.addEventListener("click", () => {
      stepBy(button.dataset["shieldStep"] === "up" ? 1n : -1n);
    });
  });
  confirm.addEventListener("click", () => {
    if (confirm.disabled || state.targetPublic >= publicBalance) {
      return;
    }
    deps.openShieldReview(tokenId, formatTokenAmount(publicBalance - state.targetPublic, decimals));
  });
};

/**
 * Binds every registered unified row's shield stepper in the current render.
 */
export const bindShieldSteppers = (deps: ShieldStepperDeps): void => {
  deps.app?.querySelectorAll<HTMLElement>("[data-shield-row]").forEach((row) => {
    bindRow(row, deps);
  });
};
