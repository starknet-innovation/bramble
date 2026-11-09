/**
 * The one-line summary a SNIP-12 signing request shows on its approval card.
 */
import { SNIP12_MAX_NAME_LENGTH } from "@bramble/starknet/snip12-vocabulary";

// A revision-1 domain name is a ByteArray with no length bound, and the panel
// drops an approval whose summary is over its 300-character limit, leaving the
// site's request waiting with nothing on screen (Sherlock 187). The summary is
// a label; the card shows the name itself in its domain block.
const summaryName = (name: string): string => {
  const characters = [...name];
  return characters.length > SNIP12_MAX_NAME_LENGTH
    ? `${characters.slice(0, SNIP12_MAX_NAME_LENGTH).join("")}…`
    : name;
};

/**
 * Builds a short, user-facing summary of a SNIP-12 typed-data request for the
 * approval card (primary type and, when present, the domain name, each cut to
 * `SNIP12_MAX_NAME_LENGTH` characters).
 */
export const describeTypedData = (typedData: unknown): string => {
  if (typeof typedData !== "object" || typedData === null) {
    return "typed data";
  }
  const record = typedData as Record<string, unknown>;
  const primaryType = typeof record["primaryType"] === "string" ? record["primaryType"] : "message";
  const domain =
    typeof record["domain"] === "object" && record["domain"] !== null
      ? (record["domain"] as Record<string, unknown>)
      : {};
  const name = typeof domain["name"] === "string" ? domain["name"] : "";
  // The hashing gate already bounds the primary type; cutting it here as well
  // keeps the summary under the panel's limit without relying on that.
  const label = summaryName(primaryType);
  return name ? `${label} · ${summaryName(name)}` : label;
};
