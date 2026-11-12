/**
 * The "Can't find it? Paste the account address" block (issues 398 and 779).
 * One template for every surface that finds an account by its pasted address:
 * the recovery picker, and both private-key import forms. `prefix` keeps each
 * surface's ids and field name distinct; ./recovery-address-ui.ts binds the
 * block through its data attributes, so the ids are for tests and E2E only.
 */
import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import { t, th } from "../../../i18n/messages";

/** Renders the finder; `hidden` keeps it closed until its surface offers it. */
export const addressFinderFields = (
  prefix: "key" | "recovery",
  options: { readonly hidden?: boolean } = {},
): string => `
      <details class="disclosure" data-recovery-address="${prefix}"${options.hidden ? " hidden" : ""}>
        <summary>${th("onboarding.address.summary")}</summary>
        <div class="disclosure-body onboarding-fields">
          ${textField({ autocapitalize: "none", autocomplete: "off", label: t("onboarding.address.field"), maxlength: 200, name: `${prefix}Address`, spellcheck: false })}
          <p class="hint" data-recovery-address-network></p>
          ${button({ attributes: { "data-recovery-address-search": true, id: `${prefix}-address-search` }, label: t("onboarding.address.find"), variant: "secondary" })}
          <p id="${prefix}-address-result" class="hint" role="status" data-recovery-address-result></p>
        </div>
      </details>`;
