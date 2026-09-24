//! The ERC-20 transfer call and the rules the extension applies to it before anything is
//! estimated: recipient grammar (`normalizeFeltInput` + `isStarkFieldElement`), amount grammar
//! (`parseTokenAmount`), `buildErc20TransferCall`, the Cairo-1 `__execute__` calldata, and the
//! verifier's summary and flags (`verifyCalls`). Pinned by `extension-transactions-*.json`.

use starknet_types_core::felt::Felt;

use super::types::{ReviewFlag, SendAmountError};
use super::u256::U256;
use crate::account_names::{js_trim, short_label};
use crate::felt;

/// `starknet_keccak("transfer")`, checked against a Keccak implementation in the tests and
/// against starknet.js `getSelectorFromName` by the fixture.
pub const TRANSFER_SELECTOR: &str =
    "0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e";
/// The extension's `isSafeDecimals` ceiling.
const MAX_DECIMALS: u8 = 36;

/// `normalizeFeltInput` then `isStarkFieldElement`: trims; lowercases and strips leading zeros
/// when the text starts with `0x`; then applies the lowercase-hex felt grammar. Returns the
/// canonical felt (including `0x0`, which the extension's field check also accepts; the call
/// builder refuses it) or `None`.
pub fn validate_recipient(input: &str) -> Option<Felt> {
    let trimmed = js_trim(input);
    let normalised = match trimmed.strip_prefix("0x") {
        Some(digits) if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_hexdigit()) => {
            let lower = digits.to_ascii_lowercase();
            let significant = lower.trim_start_matches('0');
            format!(
                "0x{}",
                if significant.is_empty() {
                    "0"
                } else {
                    significant
                }
            )
        }
        _ => trimmed.to_string(),
    };
    felt::parse(&normalised)
}

/// `parseTokenAmount`: base units from decimal text. The extension has no upper bound here and
/// fails later in `cairo.uint256`; the core refuses 2^256 and above at this point instead.
pub fn parse_token_amount(amount: &str, decimals: u8) -> Result<U256, SendAmountError> {
    let trimmed = js_trim(amount);
    let (whole, fraction) = match trimmed.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (trimmed, None),
    };
    let whole_ok = whole == "0"
        || (!whole.is_empty()
            && !whole.starts_with('0')
            && whole.bytes().all(|b| b.is_ascii_digit()));
    let fraction_ok =
        fraction.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()));
    if decimals > MAX_DECIMALS || !whole_ok || !fraction_ok {
        return Err(SendAmountError::Invalid);
    }
    let fraction = fraction.unwrap_or("");
    if fraction.len() > usize::from(decimals) {
        return Err(SendAmountError::TooManyDecimals);
    }
    let digits = format!("{whole}{fraction:0<width$}", width = usize::from(decimals));
    let significant = digits.trim_start_matches('0');
    if significant.is_empty() {
        return Err(SendAmountError::NotPositive);
    }
    U256::from_decimal(significant).ok_or(SendAmountError::TooLarge)
}

/// `formatTokenAmount`: full precision, trailing fractional zeros removed.
pub fn format_token_amount(raw: &U256, decimals: u8) -> String {
    crate::rpc::format_amount(&raw.to_decimal(), decimals, decimals)
        .unwrap_or_else(|_| raw.to_decimal())
}

fn u128_felt(value: u128) -> Felt {
    Felt::from(value)
}

/// `transaction.getExecuteCalldata([transfer(recipient, amount)], "1")`: the Cairo-1 account
/// `__execute__` calldata for one ERC-20 transfer. `None` for a zero token or recipient, as
/// `buildErc20TransferCall` throws "Invalid transfer address" for either.
pub fn transfer_execute_calldata(
    token: &Felt,
    recipient: &Felt,
    amount: &U256,
) -> Option<Vec<Felt>> {
    if *token == Felt::ZERO || *recipient == Felt::ZERO {
        return None;
    }
    let selector = Felt::from_hex(TRANSFER_SELECTOR).ok()?;
    Some(vec![
        Felt::ONE,
        *token,
        selector,
        Felt::from(3u8),
        *recipient,
        u128_felt(amount.low),
        u128_felt(amount.high),
    ])
}

/// The verifier's transfer summary: `Send <formatTokenAmount> <SYMBOL> to <shortAddress>`.
pub fn transfer_summary(amount: &U256, decimals: u8, symbol: &str, recipient: &Felt) -> String {
    format!(
        "Send {} {symbol} to {}",
        format_token_amount(amount, decimals),
        short_label(&felt::canonical(recipient))
    )
}

/// `verifyCalls` flags for a transfer from `account` (mobile has no address book, so the acting
/// account is the only trusted address, exactly as the extension's context with an empty book).
pub fn transfer_flags(recipient: &Felt, account: &Felt) -> Vec<ReviewFlag> {
    let mut flags = Vec::new();
    if recipient == account {
        flags.push(ReviewFlag::SelfTransfer);
    }
    let (left, right) = (felt::canonical(recipient), felt::canonical(account));
    if left != right && short_label(&left) == short_label(&right) {
        flags.push(ReviewFlag::AddressPoisoning);
    }
    flags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selector_is_starknet_keccak() {
        use sha3::{Digest, Keccak256};
        let mut digest: [u8; 32] = Keccak256::digest(b"transfer").into();
        digest[0] &= 0x03;
        let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            format!("0x{}", hex.trim_start_matches('0')),
            TRANSFER_SELECTOR
        );
    }

    #[test]
    fn zero_addresses_build_no_call() {
        let token = Felt::from(7u8);
        let amount = U256::from_u128(1);
        assert!(transfer_execute_calldata(&token, &Felt::ZERO, &amount).is_none());
        assert!(transfer_execute_calldata(&Felt::ZERO, &token, &amount).is_none());
        assert_eq!(validate_recipient("0x000"), Some(Felt::ZERO));
    }

    #[test]
    fn amounts_follow_the_grammar() {
        assert_eq!(
            parse_token_amount("0001.10", 6),
            Err(SendAmountError::Invalid)
        );
        assert_eq!(parse_token_amount("1.", 6), Err(SendAmountError::Invalid));
        assert_eq!(
            parse_token_amount("0.0", 6),
            Err(SendAmountError::NotPositive)
        );
        assert_eq!(parse_token_amount("1", 37), Err(SendAmountError::Invalid));
        assert_eq!(
            parse_token_amount("\u{feff} 2.5\u{a0}", 1).unwrap(),
            U256::from_u128(25)
        );
    }

    #[test]
    fn short_address_matches_short_inputs() {
        assert_eq!(short_label("0x1"), "0x1…0x1");
        assert_eq!(short_label(""), "…");
    }
}
