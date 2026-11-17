/**
 * Ephemeral Activity feed view state: the filter, sort and search the user has
 * applied. Panel-local and never persisted, so it survives the shell's repaints
 * (which rebuild the whole screen string) but resets on an account or network
 * switch. Mirrors the shell's other one-screen draft state.
 */
import { type ActivityFilter, EMPTY_ACTIVITY_FILTER } from "./activity-filter";

let state: ActivityFilter = EMPTY_ACTIVITY_FILTER;

/**
 * The current filter, sort and search. Read at render time so a repaint rebuilds
 * the controls with the values the user last chose.
 */
export const activityViewState = (): ActivityFilter => state;

/**
 * Replaces part of the view state. Nothing re-renders here; the caller decides
 * whether the change needs a repaint (the sort does) or is applied to the DOM
 * directly (the filter and the search are).
 */
export const setActivityViewState = (patch: Partial<ActivityFilter>): void => {
  state = { ...state, ...patch };
};

/**
 * Clears every axis. Called when the account or network changes, so one
 * account's filter never hides another's rows.
 */
export const resetActivityViewState = (): void => {
  state = EMPTY_ACTIVITY_FILTER;
};
