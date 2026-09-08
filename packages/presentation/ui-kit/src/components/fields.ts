/**
 * Escaped native-field renderers for wallet forms. These preserve browser
 * semantics and autocomplete while keeping label, hint, and option structure
 * identical across onboarding and later flows.
 */
import { escapeHtml } from "@bramble/core/html";
import { type UiAttributes, uiAttributes, uiClassNames } from "./html-attributes";

type FieldBase = {
  readonly attributes?: UiAttributes;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly hint?: string;
  readonly label: string;
  readonly name: string;
  readonly required?: boolean;
};

/**
 * Shared single-line field configuration.
 */
export type TextFieldProps = FieldBase & {
  readonly accept?: string;
  readonly autocomplete?: string;
  readonly autocapitalize?: "none" | "off";
  readonly inputmode?: "decimal" | "numeric" | "text";
  readonly list?: string;
  readonly max?: number;
  readonly maxlength?: number;
  readonly min?: number;
  readonly minlength?: number;
  readonly placeholder?: string;
  readonly spellcheck?: boolean;
  readonly type?: "file" | "number" | "password" | "text" | "url";
  readonly value?: string;
};

const fieldHint = (hint: string | undefined): string =>
  hint ? `<span class="hint">${escapeHtml(hint)}</span>` : "";

/**
 * Inline text-input configuration for compact controls whose visible context
 * already supplies the label, such as search and amount rows.
 */
export type InputControlProps = {
  readonly ariaLabel: string;
  readonly attributes?: UiAttributes;
  readonly autocomplete?: string;
  readonly autocapitalize?: "none" | "off";
  readonly className?: string;
  readonly disabled?: boolean;
  readonly inputmode?: "decimal" | "numeric" | "text";
  readonly maxlength?: number;
  readonly name?: string;
  readonly placeholder?: string;
  readonly readonly?: boolean;
  readonly spellcheck?: boolean;
  readonly type?: "password" | "search" | "text" | "url";
  readonly value?: string;
};

/**
 * Renders an escaped standalone input with a mandatory accessible name.
 */
export const inputControl = ({
  ariaLabel,
  attributes,
  autocomplete,
  autocapitalize,
  className,
  disabled = false,
  inputmode,
  maxlength,
  name,
  placeholder,
  readonly = false,
  spellcheck,
  type = "text",
  value,
}: InputControlProps): string =>
  `<input${className ? ` class="${uiClassNames(className)}"` : ""}${name ? ` name="${escapeHtml(name)}"` : ""} type="${type}" aria-label="${escapeHtml(ariaLabel)}"${autocomplete ? ` autocomplete="${escapeHtml(autocomplete)}"` : ""}${autocapitalize ? ` autocapitalize="${autocapitalize}"` : ""}${inputmode ? ` inputmode="${inputmode}"` : ""}${maxlength === undefined ? "" : ` maxlength="${maxlength}"`}${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ""}${spellcheck === undefined ? "" : ` spellcheck="${spellcheck}"`}${value === undefined ? "" : ` value="${escapeHtml(value)}"`}${readonly ? " readonly" : ""}${disabled ? " disabled" : ""}${uiAttributes(attributes)} />`;

/**
 * Renders an escaped single-line field. Browser capability attributes are
 * explicit; arbitrary attributes still pass through the safe UI allowlist.
 */
export const textField = ({
  accept,
  attributes,
  autocomplete,
  autocapitalize,
  className,
  disabled = false,
  hint,
  inputmode,
  list,
  max,
  maxlength,
  label,
  min,
  minlength,
  name,
  placeholder,
  required = false,
  type = "text",
  value,
  spellcheck,
}: TextFieldProps): string =>
  `<label><span>${escapeHtml(label)}</span><input${className ? ` class="${uiClassNames(className)}"` : ""} name="${escapeHtml(name)}" type="${type}"${accept ? ` accept="${escapeHtml(accept)}"` : ""}${autocomplete ? ` autocomplete="${escapeHtml(autocomplete)}"` : ""}${autocapitalize ? ` autocapitalize="${autocapitalize}"` : ""}${inputmode ? ` inputmode="${inputmode}"` : ""}${list ? ` list="${escapeHtml(list)}"` : ""}${max === undefined ? "" : ` max="${max}"`}${maxlength === undefined ? "" : ` maxlength="${maxlength}"`}${min === undefined ? "" : ` min="${min}"`}${minlength === undefined ? "" : ` minlength="${minlength}"`}${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ""}${spellcheck === undefined ? "" : ` spellcheck="${spellcheck}"`}${value === undefined ? "" : ` value="${escapeHtml(value)}"`}${required ? " required" : ""}${disabled ? " disabled" : ""}${uiAttributes(attributes)} />${fieldHint(hint)}</label>`;

/**
 * Shared multiline field configuration.
 */
export type TextareaFieldProps = FieldBase & {
  readonly autocomplete?: string;
  readonly placeholder?: string;
  readonly rows?: number;
  readonly spellcheck?: boolean;
  readonly value?: string;
};

/**
 * Renders an escaped multiline field with explicit spellcheck policy.
 */
export const textareaField = ({
  attributes,
  autocomplete,
  className,
  disabled = false,
  hint,
  label,
  name,
  placeholder,
  required = false,
  rows,
  spellcheck = true,
  value = "",
}: TextareaFieldProps): string =>
  `<label><span>${escapeHtml(label)}</span><textarea${className ? ` class="${uiClassNames(className)}"` : ""} name="${escapeHtml(name)}"${autocomplete ? ` autocomplete="${escapeHtml(autocomplete)}"` : ""}${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ""}${rows === undefined ? "" : ` rows="${rows}"`}${required ? " required" : ""}${disabled ? " disabled" : ""} spellcheck="${spellcheck}"${uiAttributes(attributes)}>${escapeHtml(value)}</textarea>${fieldHint(hint)}</label>`;

/**
 * One safe select option.
 */
export type SelectOption = {
  readonly attributes?: UiAttributes;
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: string;
};

/**
 * Shared select-field configuration.
 */
export type SelectFieldProps = FieldBase & {
  readonly options: readonly SelectOption[];
  readonly selected?: string;
};

/**
 * Renders a native select and escapes every option value and label.
 */
export const selectField = ({
  attributes,
  className,
  disabled = false,
  hint,
  label,
  name,
  options,
  required = false,
  selected,
}: SelectFieldProps): string =>
  `<label><span>${escapeHtml(label)}</span><select${className ? ` class="${uiClassNames(className)}"` : ""} name="${escapeHtml(name)}"${required ? " required" : ""}${disabled ? " disabled" : ""}${uiAttributes(attributes)}>${options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"${option.value === selected ? " selected" : ""}${option.disabled ? " disabled" : ""}${uiAttributes(option.attributes)}>${escapeHtml(option.label)}</option>`,
    )
    .join("")}</select>${fieldHint(hint)}</label>`;

/**
 * Shared checkbox-field configuration.
 */
export type CheckboxFieldProps = Omit<FieldBase, "hint" | "label"> & {
  readonly checked?: boolean;
  readonly containerAttributes?: UiAttributes;
  readonly text: string;
};

/**
 * Renders a native checkbox inside its full-row text label.
 */
export const checkboxField = ({
  attributes,
  checked = false,
  containerAttributes,
  disabled = false,
  name,
  required = false,
  text,
}: CheckboxFieldProps): string =>
  `<label class="hint"${uiAttributes(containerAttributes)}><input name="${escapeHtml(name)}" type="checkbox"${checked ? " checked" : ""}${required ? " required" : ""}${disabled ? " disabled" : ""}${uiAttributes(attributes)} /><span>${escapeHtml(text)}</span></label>`;
