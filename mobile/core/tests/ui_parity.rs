//! The avatar and passphrase-meter ports must agree with the extension's TypeScript on every
//! fixture case. The avatar is compared as markup: this test draws the struct into the exact SVG
//! template `account-avatar.ts` uses, so any geometry or formatting drift fails here.

use bramble_core::testing::{account_avatar, passphrase_strength};
use bramble_core::{AccountAvatar, PassphraseLevel};
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/extension-parity.json")).unwrap()
}

/// JavaScript's number-to-string for the small values the avatar uses (`-0` prints as `0`).
fn js(value: f64) -> String {
    if value == 0.0 {
        "0".into()
    } else if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

fn svg(a: &AccountAvatar) -> String {
    let ink = if a.face_ink_is_paper {
        "var(--bramble-account-avatar-paper)"
    } else {
        "var(--bramble-account-avatar-ink)"
    };
    let mouth = if a.mouth_open {
        format!(
            r#"<path class="avatar-mouth" d="M15 {}c2 1 4 1 6 0" fill="none" />"#,
            js(19.0 + a.mouth_spread)
        )
    } else {
        format!(
            r#"<path class="avatar-mouth" d="M13 {}a1 .75 0 0 0 10 0" stroke="none" />"#,
            js(19.0 + a.mouth_spread)
        )
    };
    format!(
        concat!(
            r#"<svg class="avatar" viewBox="0 0 36 36" aria-hidden="true" preserveAspectRatio="xMidYMid slice"> "#,
            r#"<rect width="36" height="36" fill="var(--bramble-account-avatar-{bg})" /> "#,
            r#"<rect class="avatar-head" width="36" height="36" rx="{rx}" transform="translate({wx} {wy}) rotate({wr} 18 18) scale({ws})" fill="var(--bramble-account-avatar-{wt})" /> "#,
            r#"<g class="avatar-character" transform="translate({fx} {fy}) rotate({fr} 18 18)" fill="{ink}" stroke="{ink}" stroke-linecap="round"> "#,
            r#"{mouth} <g class="avatar-eyes" stroke="none"> "#,
            r#"<rect x="{le}" y="14" width="1.5" height="2" rx="1" /> "#,
            r#"<rect x="{re}" y="14" width="1.5" height="2" rx="1" /> </g> </g> </svg>"#,
        ),
        bg = a.background_tone,
        rx = js(a.wrapper_corner_radius),
        wx = js(a.wrapper_translate_x),
        wy = js(a.wrapper_translate_y),
        wr = js(a.wrapper_rotate),
        ws = js(a.wrapper_scale),
        wt = a.wrapper_tone,
        fx = js(a.face_translate_x),
        fy = js(a.face_translate_y),
        fr = js(a.face_rotate),
        ink = ink,
        mouth = mouth,
        le = js(14.0 - a.eye_spread),
        re = js(20.0 + a.eye_spread),
    )
}

#[test]
fn avatars_match_the_extension() {
    let fixture = fixture();
    let cases = fixture["ui"]["avatars"].as_array().unwrap();
    assert!(cases.len() >= 10);
    for case in cases {
        let address = case["address"].as_str().unwrap();
        assert_eq!(
            svg(&account_avatar(address)),
            case["svg"].as_str().unwrap(),
            "avatar for {address}"
        );
    }
}

#[test]
fn passphrase_meter_matches_the_extension() {
    let fixture = fixture();
    for case in fixture["ui"]["passphrases"].as_array().unwrap() {
        let value = case["value"].as_str().unwrap();
        let reading = passphrase_strength(value);
        let level = match reading.level {
            PassphraseLevel::Empty => "empty",
            PassphraseLevel::Weak => "weak",
            PassphraseLevel::Fair => "fair",
            PassphraseLevel::Strong => "strong",
        };
        let label = value.chars().take(12).collect::<String>();
        assert_eq!(
            level,
            case["level"].as_str().unwrap(),
            "level for {label:?}"
        );
        assert!(
            (reading.ratio - case["ratio"].as_f64().unwrap()).abs() < 1e-12,
            "ratio for {label:?}"
        );
        assert_eq!(
            reading.hint,
            case["hint"].as_str().unwrap(),
            "hint for {label:?}"
        );
        assert_eq!(
            reading.acceptable,
            case["acceptable"].as_bool().unwrap(),
            "gate for {label:?}"
        );
    }
}
