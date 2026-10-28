/**
 * Renders `mobile/core/generated/accounts.json`: the account-class table, the presentation names,
 * the group icons, the recovery bounds, and the copy-feedback timings the mobile core reads with
 * `include_str!`. Every value is imported from the module that owns it in the extension, so the
 * native apps cannot restate a class hash, a nickname word, or a timing by hand.
 */
import { GROUP_ICONS } from "@bramble/settings/groups";
import { ACCOUNT_CLASSES, ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";
import { RECOVERY_SCAN_LIMITS, RESERVED_AGENT_ACCOUNT_INDEX } from "@bramble/wallet-model/recovery";
// The side-panel modules below are not package exports: read here only to pin the mobile port.
import {
  COPY_CONFIRM_MS,
  ERROR_TOAST_MS,
  SUCCESS_TOAST_MS,
} from "../../packages/presentation/wallet-ui/src/sidepanel/shared/dom";
import {
  accountFamilyName,
  NAME_ADJECTIVES,
  NAME_ANIMALS,
} from "../../packages/presentation/wallet-ui/src/sidepanel/shared/parts";
import { knownAccountType } from "../../packages/presentation/wallet-ui/src/sidepanel/shell/account-types";
import { HEADER } from "./shared";

/** Repository-relative path of the account catalog the Rust core embeds at compile time. */
export const ACCOUNTS_JSON_PATH = "mobile/core/generated/accounts.json";

/** Renders the account catalog as stable, pretty-printed JSON. */
export const renderAccountsCatalog = (): string => {
  const catalog = {
    generatedBy: HEADER,
    argentDefaultClassHash: ARGENT_ACCOUNT_CLASS_HASH,
    classes: ACCOUNT_CLASSES.map((entry) => ({
      authorizationShape: entry.authorizationShape,
      classHash: entry.classHash,
      constructorShape: entry.constructorShape,
      family: entry.family,
      // Roles as flags rather than a short array, so the file is stable under Biome's formatter.
      deployment: entry.roles.includes("deployment"),
      implementation: entry.roles.includes("implementation"),
      label: entry.label,
      typeLabel: knownAccountType(entry.classHash),
    })),
    copyFeedback: {
      confirmMs: COPY_CONFIRM_MS,
      errorToastMs: ERROR_TOAST_MS,
      successToastMs: SUCCESS_TOAST_MS,
    },
    familyNames: {
      argent: accountFamilyName("argent"),
      braavos: accountFamilyName("braavos"),
      openzeppelin: accountFamilyName("openzeppelin"),
    },
    groupIcons: GROUP_ICONS,
    nameAdjectives: NAME_ADJECTIVES,
    nameAnimals: NAME_ANIMALS,
    openZeppelin: {
      classHash: OPENZEPPELIN_ACCOUNT_CLASS_HASH,
      typeLabel: knownAccountType(OPENZEPPELIN_ACCOUNT_CLASS_HASH),
    },
    recoveryLimits: RECOVERY_SCAN_LIMITS,
    reservedAgentIndex: RESERVED_AGENT_ACCOUNT_INDEX,
  };
  return `${JSON.stringify(catalog, null, 2)}\n`;
};
