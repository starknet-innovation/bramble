/**
 * Validates the private-balance panel reply before the multisig screen renders
 * it. A malformed authorization is refused rather than offered for signing.
 */

/**
 * One incoming pool authorization a co-owner can review.
 */
export type Strk20PanelAuthorization = {
  readonly amount: string;
  readonly id: string;
  readonly kind: "deposit" | "register" | "transfer" | "withdraw";
  readonly recipient?: string;
  readonly summary: string;
  readonly symbol: string;
  readonly youSigned: boolean;
};

/**
 * One private balance shown beside a tracked token.
 */
type Strk20PanelBalance = {
  readonly balance: string;
  readonly formatted: string;
  readonly symbol: string;
  readonly token: string;
  readonly tokenId: string;
};

/**
 * The panel reply: collecting authorizations and private balances.
 */
export type Strk20PanelState = {
  readonly authorizations: readonly Strk20PanelAuthorization[];
  readonly balances: readonly Strk20PanelBalance[];
};

const isKind = (value: unknown): value is Strk20PanelAuthorization["kind"] =>
  value === "deposit" || value === "register" || value === "transfer" || value === "withdraw";

const isText = (value: unknown): value is string => typeof value === "string";

const isAuthorization = (value: unknown): value is Strk20PanelAuthorization => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row["amount"]) &&
    isText(row["id"]) &&
    row["id"].length > 0 &&
    isKind(row["kind"]) &&
    (row["recipient"] === undefined || isText(row["recipient"])) &&
    isText(row["summary"]) &&
    isText(row["symbol"]) &&
    typeof row["youSigned"] === "boolean"
  );
};

const isBalance = (value: unknown): value is Strk20PanelBalance => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row["balance"]) &&
    isText(row["formatted"]) &&
    isText(row["symbol"]) &&
    isText(row["token"]) &&
    isText(row["tokenId"])
  );
};

/**
 * True when the background reply is a panel state. Extra fields are ignored;
 * a missing or mistyped field rejects the whole reply.
 */
export const isStrk20Panel = (
  value: unknown,
): value is Strk20PanelState & { readonly ok: true } => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as {
    readonly authorizations?: unknown;
    readonly balances?: unknown;
    readonly ok?: unknown;
  };
  return (
    record.ok === true &&
    Array.isArray(record.authorizations) &&
    record.authorizations.every(isAuthorization) &&
    Array.isArray(record.balances) &&
    record.balances.every(isBalance)
  );
};
