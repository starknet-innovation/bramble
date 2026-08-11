/**
 * Shared identifier validators for extension-generated ids.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Checks extension-generated UUID values.
 */
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);
