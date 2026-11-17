/**
 * The one redactor for the Sepolia verification run (verify-sepolia*.ts).
 * Every seed, phrase and private key the run types, the keys it derives
 * included, is registered with `secret` before use; every error, console line
 * and scorecard the run emits passes through `redact`. A hex key is caught in
 * its other spellings too (unpadded, any case, decimal), and a phrase as any
 * run of two or more of its words, so a partial or reflowed phrase is caught.
 */

const patterns = new Map<string, RegExp>();

const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Registers `value` with the redactor and returns it unchanged, for use inline. */
export const secret = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed === "" || patterns.has(trimmed)) return value;
  const words = trimmed.split(/\s+/);
  const forms = [literal(trimmed)];
  if (words.length > 1) {
    const word = `(?:${words.map(literal).join("|")})`;
    forms.push(`\\b${word}(?:\\W+${word}\\b)+`);
  } else if (/^(0x)?[0-9a-f]{16,}$/i.test(trimmed)) {
    const n = BigInt(trimmed.toLowerCase().startsWith("0x") ? trimmed : `0x${trimmed}`);
    forms.push(`(?:0x)?0*${n.toString(16)}`, n.toString(10));
  }
  patterns.set(trimmed, new RegExp(forms.join("|"), "gi"));
  return value;
};

/** `text` with every registered secret replaced by "[redacted]". */
export const redact = (text: string): string =>
  [...patterns.values()].reduce((out, pattern) => out.replace(pattern, "[redacted]"), text);

/**
 * Runs the script body. A failure anywhere in it (opening the session, the
 * checks, the write) prints only its redacted message, with no stack (which
 * repeats the message), and resolves false so the caller exits non-zero.
 */
export async function guarded(main: () => Promise<void>): Promise<boolean> {
  try {
    await main();
    return true;
  } catch (error) {
    console.error(`verification failed: ${redact(String(error))}`.slice(0, 500));
    return false;
  }
}
