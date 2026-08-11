/**
 * Pure popup action parsers for DOM dataset values.
 */

/**
 * Approval action values emitted by popup controls.
 */
export type ApprovalAction = "approve" | "deny";

/**
 * Parses approval actions from button dataset values.
 */
export const readApprovalAction = (value: unknown): ApprovalAction | null =>
  value === "approve" || value === "deny" ? value : null;
