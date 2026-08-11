import { useCallback, useEffect, useState } from "react";

export type FollowedAsset = {
  readonly id: string;
  readonly kind: "perp" | "token";
  readonly symbol: string;
  readonly name: string;
  readonly logoUri: string | null;
};

const STORAGE_KEY = "mc-terminal:follows:v1";
const CHANGE_EVENT = "mc-terminal:follows-changed";
const MAX_FOLLOWS = 100;

const boundedText = (value: unknown, maxLength: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;

const parseFollow = (value: unknown): FollowedAsset | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = boundedText(row["id"], 256);
  const symbol = boundedText(row["symbol"], 64);
  const name = boundedText(row["name"], 128);
  const logo = row["logoUri"];
  if (
    id === null ||
    symbol === null ||
    name === null ||
    (row["kind"] !== "perp" && row["kind"] !== "token") ||
    (logo !== null && boundedText(logo, 2_048) === null)
  ) {
    return null;
  }
  return {
    id,
    kind: row["kind"],
    logoUri: logo === null ? null : String(logo),
    name,
    symbol,
  };
};

/** Reads the bounded, display-only follow preference from browser-local storage. */
export const readFollowedAssets = (): readonly FollowedAsset[] => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > MAX_FOLLOWS) return [];
    const unique = new Map<string, FollowedAsset>();
    for (const item of value) {
      const parsed = parseFollow(item);
      if (parsed !== null) unique.set(`${parsed.kind}:${parsed.id}`, parsed);
    }
    return [...unique.values()];
  } catch {
    return [];
  }
};

const publish = (items: readonly FollowedAsset[]): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(items));
    globalThis.window?.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // A blocked storage preference must not break the market surface.
  }
};

/** Toggles one validated token or perp follow and returns the persisted snapshot. */
export const toggleFollowedAsset = (asset: FollowedAsset): readonly FollowedAsset[] => {
  const parsed = parseFollow(asset);
  if (parsed === null) return readFollowedAssets();
  const key = `${parsed.kind}:${parsed.id}`;
  const current = readFollowedAssets();
  const exists = current.some((item) => `${item.kind}:${item.id}` === key);
  const next = exists
    ? current.filter((item) => `${item.kind}:${item.id}` !== key)
    : [...current, parsed].slice(-MAX_FOLLOWS);
  publish(next);
  return next;
};

/** Keeps follow buttons and Discover's Follows tab in sync within and across tabs. */
export const useFollowedAssets = (): {
  readonly items: readonly FollowedAsset[];
  readonly toggle: (asset: FollowedAsset) => void;
} => {
  const [items, setItems] = useState<readonly FollowedAsset[]>(readFollowedAssets);

  useEffect(() => {
    const sync = (): void => setItems(readFollowedAssets());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback((asset: FollowedAsset): void => {
    setItems(toggleFollowedAsset(asset));
  }, []);

  return { items, toggle };
};
