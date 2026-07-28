/**
 * Escapes an arbitrary string for literal use inside a regular expression.
 */
export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
