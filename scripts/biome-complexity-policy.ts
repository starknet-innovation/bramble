/**
 * Validates the Biome cognitive-complexity gate shape declared in biome.json:
 * the repo-wide ceiling and the strict wallet-logic override.
 */
import {
  REPO_MAX_COGNITIVE_COMPLEXITY,
  WALLET_COMPLEXITY_GLOBS,
  WALLET_MAX_COGNITIVE_COMPLEXITY,
} from "./config-standards-policy";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const hasStringList = (value: unknown, expected: readonly string[]): boolean =>
  Array.isArray(value) &&
  value.length === expected.length &&
  expected.every((item, index) => value[index] === item);

const isCognitiveComplexityRule = (value: unknown, maxAllowedComplexity: number): boolean => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["level", "options"]) || value["level"] !== "error") {
    return false;
  }
  const options = isRecord(value["options"]) ? value["options"] : null;
  return (
    !!options &&
    hasOnlyKeys(options, ["maxAllowedComplexity"]) &&
    options["maxAllowedComplexity"] === maxAllowedComplexity
  );
};

const repoRuleFailures = (biomeJson: Record<string, unknown>): string[] => {
  const linter = isRecord(biomeJson["linter"]) ? biomeJson["linter"] : null;
  const rules = linter && isRecord(linter["rules"]) ? linter["rules"] : null;
  const complexity = rules && isRecord(rules["complexity"]) ? rules["complexity"] : null;
  if (
    isCognitiveComplexityRule(
      complexity?.["noExcessiveCognitiveComplexity"],
      REPO_MAX_COGNITIVE_COMPLEXITY,
    )
  ) {
    return [];
  }
  return [
    `biome.json must enforce noExcessiveCognitiveComplexity at error with maxAllowedComplexity ${REPO_MAX_COGNITIVE_COMPLEXITY}`,
  ];
};

const overrideRuleFailures = (biomeJson: Record<string, unknown>): string[] => {
  const overrides = Array.isArray(biomeJson["overrides"]) ? biomeJson["overrides"] : null;
  const override =
    overrides && overrides.length === 1 && isRecord(overrides[0]) ? overrides[0] : null;
  const linter = override && isRecord(override["linter"]) ? override["linter"] : null;
  const rules = linter && isRecord(linter["rules"]) ? linter["rules"] : null;
  const complexity = rules && isRecord(rules["complexity"]) ? rules["complexity"] : null;
  const valid =
    !!override &&
    hasOnlyKeys(override, ["includes", "linter"]) &&
    hasStringList(override["includes"], WALLET_COMPLEXITY_GLOBS) &&
    !!linter &&
    hasOnlyKeys(linter, ["rules"]) &&
    !!rules &&
    hasOnlyKeys(rules, ["complexity"]) &&
    !!complexity &&
    hasOnlyKeys(complexity, ["noExcessiveCognitiveComplexity"]) &&
    isCognitiveComplexityRule(
      complexity["noExcessiveCognitiveComplexity"],
      WALLET_MAX_COGNITIVE_COMPLEXITY,
    );
  if (valid) {
    return [];
  }
  return [
    `biome.json must keep a wallet-logic override enforcing maxAllowedComplexity ${WALLET_MAX_COGNITIVE_COMPLEXITY}`,
  ];
};

/**
 * Returns policy failures for the repo-wide and wallet-logic cognitive-complexity gates.
 */
export const biomeComplexityFailures = (biomeJson: Record<string, unknown>): string[] => [
  ...repoRuleFailures(biomeJson),
  ...overrideRuleFailures(biomeJson),
];
