/**
 * Shared static checks for source-vendoring scripts.
 */

/**
 * Reports moving-branch or malformed revision pins in a vendor script.
 */
export const vendorPinFailures = (
  source: string,
  script: string,
  constant: string,
): readonly string[] => {
  const failures: string[] = [];
  if (!new RegExp(`const ${constant} = "[0-9a-f]{40}";`).test(source)) {
    failures.push(`${script} must pin a commit in ${constant}`);
  }
  if (source.includes('"pull"')) {
    failures.push(`${script} must not follow a moving branch`);
  }
  return failures;
};
