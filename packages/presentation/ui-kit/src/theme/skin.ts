/**
 * Swappable UI skin tokens for popup rendering.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";

/**
 * CSS variable tokens every replaceable skin must provide.
 */
export const SKIN_TOKENS = [
  "--bramble-accent",
  "--bramble-accent-text",
  "--bramble-account-avatar-accent-0",
  "--bramble-account-avatar-accent-1",
  "--bramble-account-avatar-accent-2",
  "--bramble-account-avatar-accent-3",
  "--bramble-account-avatar-body-0",
  "--bramble-account-avatar-body-1",
  "--bramble-account-avatar-body-2",
  "--bramble-account-avatar-body-3",
  "--bramble-account-avatar-body-4",
  "--bramble-account-avatar-ground-0",
  "--bramble-account-avatar-ground-1",
  "--bramble-account-avatar-ground-2",
  "--bramble-account-avatar-ground-3",
  "--bramble-account-avatar-ink",
  "--bramble-account-avatar-paper",
  "--bramble-bg",
  "--bramble-border",
  "--bramble-danger",
  "--bramble-elevated",
  "--bramble-muted",
  "--bramble-panel",
  "--bramble-positive",
  "--bramble-sunken",
  "--bramble-text",
  "--bramble-warning",
] as const;

/**
 * CSS custom property names required by every popup skin.
 */
export type SkinToken = (typeof SKIN_TOKENS)[number];

/**
 * Replaceable popup skin contract.
 */
export type Skin = {
  readonly name: string;
  readonly tokens: Readonly<Record<SkinToken, string>>;
};

const isSkinToken = (value: string): value is SkinToken =>
  SKIN_TOKENS.some((token) => token === value);

const hasExactSkinTokens = (skin: unknown): skin is Skin => {
  if (
    !isRecord(skin) ||
    !hasOnlyKnownKeys(skin, ["name", "tokens"]) ||
    typeof skin["name"] !== "string" ||
    skin["name"].trim().length === 0 ||
    !isRecord(skin["tokens"])
  ) {
    return false;
  }

  const skinTokens = skin["tokens"];
  const tokens = Reflect.ownKeys(skinTokens);
  return (
    tokens.length === SKIN_TOKENS.length &&
    tokens.every((token) => typeof token === "string" && isSkinToken(token)) &&
    SKIN_TOKENS.every((token) => {
      const descriptor = Object.getOwnPropertyDescriptor(skinTokens, token);
      return (
        descriptor?.enumerable === true &&
        "value" in descriptor &&
        typeof descriptor.value === "string" &&
        descriptor.value.length > 0
      );
    })
  );
};

/**
 * Applies skin tokens to an explicit UI root.
 */
export const applySkin = (skin: Skin, root: HTMLElement): void => {
  if (!hasExactSkinTokens(skin)) {
    throw new Error("Invalid skin token set");
  }

  for (const token of SKIN_TOKENS) {
    root.style.setProperty(token, skin.tokens[token]);
  }
};
