/** Strict PQB public-state boundary, matching the pinned SDK schema. Unknown/private fields are refused. */
import { isLowercaseHexBytes } from "@bramble/core/hex";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { PQB_LIMITS } from "@bramble/wallet-model/pqb";

const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  isRecord(v) && hasOnlyKnownKeys(v, keys) && keys.every((k) => Object.hasOwn(v, k));
/** Validates every field and dimension without converting curve integers through JS numbers. */
export const isPqbPublicState = (v: unknown): boolean => {
  if (
    !exact(v, ["config", "full_script_hex", "round_table", "stages"]) ||
    v["config"] !== "PQB" ||
    !isLowercaseHexBytes(v["full_script_hex"], PQB_LIMITS.scriptBytes, PQB_LIMITS.scriptBytes) ||
    !Array.isArray(v["round_table"]) ||
    v["round_table"].length !== PQB_LIMITS.table ||
    !v["round_table"].every((x) => isLowercaseHexBytes(x, 9, 9)) ||
    new Set(v["round_table"]).size !== PQB_LIMITS.table ||
    !Array.isArray(v["stages"]) ||
    v["stages"].length !== 3
  )
    return false;
  return v["stages"].every((stage: unknown, i: number) => {
    if (!exact(stage, ["menu"]) || !exact(stage["menu"], ["r_inv", "variants"])) return false;
    const menu = stage["menu"];
    return (
      typeof menu["r_inv"] === "string" &&
      /^[1-9][0-9]{0,77}$/.test(menu["r_inv"]) &&
      Array.isArray(menu["variants"]) &&
      menu["variants"].length === (i === 0 ? 2 : 4) &&
      menu["variants"].every(
        (variant: unknown, j: number) =>
          exact(variant, ["add_n", "odd", "points"]) &&
          variant["add_n"] === j >= 2 &&
          variant["odd"] === (j % 2 === 1) &&
          Array.isArray(variant["points"]) &&
          variant["points"].length === PQB_LIMITS.menus[i] &&
          variant["points"].every((p) => isLowercaseHexBytes(p, 65, 65) && p.startsWith("04")),
      )
    );
  });
};
