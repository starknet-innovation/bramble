//! The avatar and passphrase-meter ports must agree with the extension's TypeScript on every
//! fixture case. The avatar is compared as markup: this test draws the core's parts into the exact
//! SVG template `account-avatar.ts` uses, so any part, number or ordering drift fails here.

use bramble_core::testing::{account_avatar, passphrase_strength};
use bramble_core::{AccountAvatar, AvatarPaint, AvatarPart, AvatarShape, PassphraseLevel};
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/extension-parity.json")).unwrap()
}

/// JavaScript's number-to-string for the values the avatar uses (`-0` prints as `0`).
fn js(value: f64) -> String {
    if value == 0.0 {
        "0".into()
    } else if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

fn paint(a: &AccountAvatar, paint: AvatarPaint) -> String {
    let name = match paint {
        AvatarPaint::Ground => format!("ground-{}", a.ground_tone),
        AvatarPaint::Body => format!("body-{}", a.body_tone),
        AvatarPaint::Accent => format!("accent-{}", a.accent_tone),
        AvatarPaint::Ink => "ink".into(),
        AvatarPaint::Paper => "paper".into(),
    };
    format!("var(--bramble-account-avatar-{name})")
}

/// One part as `account-avatar.ts` writes it. The legs are the template's only stroke that also
/// says `fill="none"`; the eye's brow stroke does not.
fn element(a: &AccountAvatar, part: &AvatarPart, legs: bool) -> String {
    let fill = paint(a, part.paint);
    let opacity = if part.opacity < 1.0 {
        format!(r#" fill-opacity="{}""#, js(part.opacity))
    } else {
        String::new()
    };
    match &part.shape {
        AvatarShape::Fill { d } => format!(r#"<path d="{d}" fill="{fill}"{opacity} />"#),
        AvatarShape::Stroke { d, width } => format!(
            r#"<path d="{d}"{} stroke="{fill}" stroke-width="{}" stroke-linecap="round" />"#,
            if legs { r#" fill="none""# } else { "" },
            js(*width)
        ),
        AvatarShape::Ellipse {
            cx,
            cy,
            rx,
            ry,
            rotate,
        } => format!(
            r#"<ellipse cx="{}" cy="{}" rx="{}" ry="{}"{} fill="{fill}"{opacity} />"#,
            js(*cx),
            js(*cy),
            js(*rx),
            js(*ry),
            if *rotate == 0.0 {
                String::new()
            } else {
                format!(
                    r#" transform="rotate({} {} {})""#,
                    js(*rotate),
                    js(*cx),
                    js(*cy)
                )
            }
        ),
        AvatarShape::Circle { cx, cy, r } => format!(
            r#"<circle cx="{}" cy="{}" r="{}" fill="{fill}"{opacity} />"#,
            js(*cx),
            js(*cy),
            js(*r)
        ),
    }
}

fn svg(a: &AccountAvatar) -> String {
    // The eye's markup is one template expression, so its elements sit side by side; the parts
    // before it (up to the beak, the last filled path) are one template line each.
    let split = a
        .parts
        .iter()
        .rposition(|p| matches!(p.shape, AvatarShape::Fill { .. }))
        .unwrap()
        + 1;
    let body: Vec<String> = a.parts[..split]
        .iter()
        .enumerate()
        .map(|(i, p)| element(a, p, i == 0))
        .collect();
    let eye: String = a.parts[split..]
        .iter()
        .map(|p| element(a, p, false))
        .collect();
    format!(
        concat!(
            r#"<svg class="avatar" viewBox="0 0 36 36" aria-hidden="true"> "#,
            r#"<rect width="36" height="36" fill="{ground}" /> "#,
            r#"<g class="avatar-bird" transform="{flip}translate(18 18) scale({scale}) translate({ox} {oy})"> "#,
            r#"{body} {eye} </g> </svg>"#,
        ),
        ground = paint(a, AvatarPaint::Ground),
        flip = if a.mirrored {
            "translate(36 0) scale(-1 1) "
        } else {
            ""
        },
        scale = js(a.scale),
        ox = js(-a.origin_x),
        oy = js(-a.origin_y),
        body = body.join(" "),
        eye = eye,
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
