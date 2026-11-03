/**
 * Validates the private-balance panel reply before the multisig screen renders
 * it. A malformed card is refused rather than offered for signing.
 */

/**
 * One CallSet or relay the screen can sign, share, or send. The lines are the
 * facts the background derived from the hashed calls or typed data.
 */
export type Strk20PanelCard = {
  readonly id: string;
  readonly lines: readonly string[];
  readonly offer: "send" | "share" | "sign";
  readonly refresh: boolean;
  readonly summary: string;
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
 * The panel reply: CallSet cards, relay cards, and private balances.
 */
export type Strk20PanelState = {
  readonly authorizations: readonly Strk20PanelCard[];
  readonly balances: readonly Strk20PanelBalance[];
  readonly relays: readonly Strk20PanelCard[];
};

const isOffer = (value: unknown): value is Strk20PanelCard["offer"] =>
  value === "send" || value === "share" || value === "sign";

const isText = (value: unknown): value is string => typeof value === "string";

const isCard = (value: unknown): value is Strk20PanelCard => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row["id"]) &&
    row["id"].length > 0 &&
    Array.isArray(row["lines"]) &&
    row["lines"].every(isText) &&
    isOffer(row["offer"]) &&
    typeof row["refresh"] === "boolean" &&
    isText(row["summary"])
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
    readonly relays?: unknown;
  };
  return (
    record.ok === true &&
    Array.isArray(record.authorizations) &&
    record.authorizations.every(isCard) &&
    Array.isArray(record.balances) &&
    record.balances.every(isBalance) &&
    Array.isArray(record.relays) &&
    record.relays.every(isCard)
  );
};
