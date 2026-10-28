//! Presentation rules the extension computes in TypeScript and the native apps must render
//! identically: the account avatar (`wallet-ui/.../account-avatar.ts`), the vault-passphrase meter
//! (`wallet-model/.../passphrase.ts`), and the recovery-word assist
//! (`wallet-ui/.../recovery-word-assist.ts`). Each is checked against output the TypeScript
//! produced (`tests/fixtures/extension-parity.json`), so the two wallets cannot drift apart.

use crate::account_names::{js_trim, utf16_len};
use crate::felt;

const AVATAR_SIZE: i64 = 36;
/// Suggestions shown under a recovery-word field, as `SUGGESTION_LIMIT`.
const SUGGESTION_LIMIT: usize = 5;
const MAX_VAULT_PASSPHRASE_LENGTH: usize = 1024;
const MIN_VAULT_PASSPHRASE_LENGTH: usize = 8;
const STRONG_BITS: f64 = 72.0;
const FAIR_BITS: f64 = 48.0;

/// Geometry of the Boring-Avatars "Beam" character for one account. Tones index the skin's four
/// `accountAvatar` colours; `face_ink_is_paper` picks `accountAvatarPaper` over `accountAvatarInk`.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AccountAvatar {
    pub background_tone: u8,
    pub wrapper_tone: u8,
    pub face_ink_is_paper: bool,
    pub wrapper_translate_x: f64,
    pub wrapper_translate_y: f64,
    pub wrapper_rotate: f64,
    pub wrapper_scale: f64,
    pub wrapper_corner_radius: f64,
    pub face_translate_x: f64,
    pub face_translate_y: f64,
    pub face_rotate: f64,
    pub mouth_open: bool,
    pub mouth_spread: f64,
    pub eye_spread: f64,
}

fn canonical_avatar_name(address: &str) -> String {
    felt::parse(address).map_or_else(|| "0x0".to_string(), |value| felt::canonical(&value))
}

/// Java-style string hash over UTF-16 code units with 32-bit wrap, then `Math.abs`.
fn avatar_hash(value: &str) -> i64 {
    let mut hash: i32 = 0;
    for unit in value.encode_utf16() {
        hash = hash
            .wrapping_shl(5)
            .wrapping_sub(hash)
            .wrapping_add(i32::from(unit));
    }
    i64::from(hash).abs()
}

fn digit_at(value: i64, index: u32) -> i64 {
    (value / 10_i64.pow(index)) % 10
}

fn unit(value: i64, range: i64, index: Option<u32>) -> i64 {
    let unit = value % range;
    match index {
        Some(index) if digit_at(value, index) % 2 == 0 => -unit,
        _ => unit,
    }
}

fn boolean(value: i64, index: u32) -> bool {
    digit_at(value, index) % 2 == 0
}

/// Deterministic avatar for a public account address; malformed input maps to the zero address.
pub fn account_avatar(address: &str) -> AccountAvatar {
    let identity = avatar_hash(&canonical_avatar_name(address));
    let wrapper_tone = identity % 4;
    let pre_x = unit(identity, 10, Some(1));
    let pre_y = unit(identity, 10, Some(2));
    let wrapper_x = if pre_x < 5 {
        pre_x + AVATAR_SIZE / 9
    } else {
        pre_x
    };
    let wrapper_y = if pre_y < 5 {
        pre_y + AVATAR_SIZE / 9
    } else {
        pre_y
    };
    let face_x = if wrapper_x > AVATAR_SIZE / 6 {
        wrapper_x as f64 / 2.0
    } else {
        unit(identity, 8, Some(1)) as f64
    };
    let face_y = if wrapper_y > AVATAR_SIZE / 6 {
        wrapper_y as f64 / 2.0
    } else {
        unit(identity, 7, Some(2)) as f64
    };
    AccountAvatar {
        background_tone: ((identity + 13) % 4) as u8,
        wrapper_tone: wrapper_tone as u8,
        face_ink_is_paper: !(wrapper_tone == 1 || wrapper_tone == 2),
        wrapper_translate_x: wrapper_x as f64,
        wrapper_translate_y: wrapper_y as f64,
        wrapper_rotate: unit(identity, 360, None) as f64,
        wrapper_scale: 1.0 + unit(identity, AVATAR_SIZE / 12, None) as f64 / 10.0,
        wrapper_corner_radius: if boolean(identity, 1) { 36.0 } else { 6.0 },
        face_translate_x: face_x,
        face_translate_y: face_y,
        face_rotate: unit(identity, 10, Some(3)) as f64,
        mouth_open: boolean(identity, 2),
        mouth_spread: unit(identity, 3, None) as f64,
        eye_spread: unit(identity, 5, None) as f64,
    }
}

/// Strength band of the vault-passphrase meter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum PassphraseLevel {
    Empty,
    Weak,
    Fair,
    Strong,
}

/// One meter reading: band, bar fill (0–1), guidance line, and the gate the setup form uses.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PassphraseStrength {
    pub level: PassphraseLevel,
    pub ratio: f64,
    pub hint: String,
    /// The vault accepts it (`isVaultPassphrase`).
    pub acceptable: bool,
}

/// `isVaultPassphrase`: at most 1024 UTF-16 units, at least 8 after trimming.
pub fn is_vault_passphrase(value: &str) -> bool {
    utf16_len(value) <= MAX_VAULT_PASSPHRASE_LENGTH
        && utf16_len(js_trim(value)) >= MIN_VAULT_PASSPHRASE_LENGTH
}

fn class_size(value: &str) -> u32 {
    let mut size = 0;
    if value.chars().any(|c| c.is_ascii_lowercase()) {
        size += 26;
    }
    if value.chars().any(|c| c.is_ascii_uppercase()) {
        size += 26;
    }
    if value.chars().any(|c| c.is_ascii_digit()) {
        size += 10;
    }
    if value.chars().any(|c| !c.is_ascii_alphanumeric()) {
        size += 33;
    }
    size
}

/// The extension's folded common-password words (`guessable.ts`), generated by `mobile:assets`.
const COMMON_PASSWORDS: &str = include_str!("../generated/common-passwords.txt");

fn is_common_word(word: &str) -> bool {
    static WORDS: std::sync::OnceLock<std::collections::HashSet<&'static str>> =
        std::sync::OnceLock::new();
    WORDS
        .get_or_init(|| COMMON_PASSWORDS.split_whitespace().collect())
        .contains(word)
}

const RUNS: [&str; 5] = [
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
    "1234567890",
    "abcdefghijklmnopqrstuvwxyz",
];

// `isRun`: four or more characters of a keyboard row or the alphabet, either way round.
fn is_run(text: &str) -> bool {
    utf16_len(text) >= 4
        && RUNS.iter().any(|run| {
            let reversed: String = run.chars().rev().collect();
            run.contains(text) || reversed.contains(text)
        })
}

// `/^(.+?)\1+$/s` over UTF-16 units: the whole value repeats one shorter chunk.
fn is_repeated_chunk(text: &str) -> bool {
    let units: Vec<u16> = text.encode_utf16().collect();
    (1..units.len()).any(|period| {
        units.len().is_multiple_of(period)
            && units.chunks(period).all(|chunk| chunk == &units[..period])
    })
}

// `readings`: each letter-only reading of the value, with digits and symbols at the edges taken as
// padding (or, in the second reading, as letters in disguise), leet folded, and "1" read as both
// "i" and "l".
fn readings(lower: &str) -> Vec<String> {
    let keep_leading = |extra: &str| {
        let extra = extra.to_string();
        move |c: char| c.is_ascii_lowercase() || extra.contains(c)
    };
    let mut out = Vec::with_capacity(4);
    for leading in [keep_leading("@$"), keep_leading("@$013457")] {
        let trimmed = lower
            .trim_start_matches(|c: char| !leading(c))
            .trim_end_matches(|c: char| !c.is_ascii_lowercase());
        for one in ['i', 'l'] {
            out.push(
                trimmed
                    .chars()
                    .map(|c| match c {
                        '1' => one,
                        '$' | '5' => 's',
                        '0' => 'o',
                        '3' => 'e',
                        '4' | '@' => 'a',
                        '7' => 't',
                        other => other,
                    })
                    .filter(char::is_ascii_lowercase)
                    .collect(),
            );
        }
    }
    out
}

/// `isGuessable`: a value an offline guesser tries early (Sherlock 152): a common password in
/// disguise, a repeated chunk, or a keyboard or alphabet run. Callers bound the length first.
fn is_guessable(value: &str) -> bool {
    let lower = value.to_lowercase();
    if is_repeated_chunk(&lower) || is_run(&lower) {
        return true;
    }
    readings(&lower)
        .iter()
        .any(|word| word.len() >= 4 && (is_common_word(word) || is_run(word)))
}

/// `estimatePassphraseStrength`, unit for unit.
pub fn passphrase_strength(value: &str) -> PassphraseStrength {
    let too_short = format!("Enter at least {MIN_VAULT_PASSPHRASE_LENGTH} characters");
    let reading = |level, ratio, hint: String| PassphraseStrength {
        acceptable: is_vault_passphrase(value),
        hint,
        level,
        ratio,
    };
    let length = utf16_len(value);
    if length == 0 {
        return reading(PassphraseLevel::Empty, 0.0, too_short);
    }
    let unique = value
        .chars()
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    let repetition = ((unique as f64 + 4.0) / length.min(16) as f64).min(1.0);
    let bits = length as f64 * f64::from(class_size(value).max(2)).log2() * repetition;
    let ratio = (bits / STRONG_BITS).clamp(0.08, 1.0);
    if !is_vault_passphrase(value) {
        return reading(PassphraseLevel::Weak, ratio.min(0.4), too_short);
    }
    if is_guessable(value) {
        return reading(PassphraseLevel::Weak, ratio.min(0.4), "Weak".into());
    }
    // Past the floor the hint names the band alone; the bar already shows the distance.
    if bits >= STRONG_BITS {
        return reading(PassphraseLevel::Strong, 1.0, "Strong".into());
    }
    if bits >= FAIR_BITS {
        return reading(PassphraseLevel::Fair, ratio, "Fair".into());
    }
    reading(PassphraseLevel::Weak, ratio, "Weak".into())
}

/// Whether one typed word (trimmed) is in the BIP-39 English list.
pub fn is_recovery_word(word: &str) -> bool {
    bip39::Language::English.find_word(word.trim()).is_some()
}

/// Up to five BIP-39 words starting with the typed prefix.
pub fn recovery_word_suggestions(prefix: &str) -> Vec<String> {
    let prefix = prefix.trim().to_lowercase();
    if prefix.is_empty() {
        return Vec::new();
    }
    bip39::Language::English
        .words_by_prefix(&prefix)
        .iter()
        .take(SUGGESTION_LIMIT)
        .map(|word| (*word).to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_wraps_like_javascript() {
        assert_eq!(avatar_hash(""), 0);
        assert_eq!(avatar_hash("0x0"), i64::from(48 * 31 * 31 + 120 * 31 + 48));
        // Long input exercises the 32-bit wrap.
        assert!(avatar_hash(&"f".repeat(64)) <= i64::from(i32::MAX) + 1);
    }

    #[test]
    fn meter_bands() {
        assert_eq!(passphrase_strength("").level, PassphraseLevel::Empty);
        assert_eq!(passphrase_strength("short").level, PassphraseLevel::Weak);
        assert!(!passphrase_strength("short").acceptable);
        // Weak but past the 8-character floor: accepted with no further gate.
        let weak = passphrase_strength("aaaaaaaa");
        assert_eq!(weak.level, PassphraseLevel::Weak);
        assert!(weak.acceptable);
        assert_eq!(
            passphrase_strength("correct horse battery staple!9").level,
            PassphraseLevel::Strong
        );
    }

    #[test]
    fn word_assist() {
        assert!(is_recovery_word("habit"));
        assert!(is_recovery_word(" habit "));
        assert!(!is_recovery_word("bramble"));
        assert_eq!(recovery_word_suggestions("hab"), vec!["habit"]);
        assert_eq!(recovery_word_suggestions("a").len(), 5);
        assert!(recovery_word_suggestions("").is_empty());
    }
}
