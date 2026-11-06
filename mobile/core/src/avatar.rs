//! The account bird (`wallet-ui/.../account-avatar.ts`): a bird assembled from parts, each read
//! from the account's public address. The core decides every part and number; the apps only paint
//! the list in order, so iOS, Android and the extension draw the same bird for one address.
//!
//! The reads are the mapping people learn their bird by: reordering one or resizing a range
//! redraws every account, which is why `tests/ui_parity.rs` compares the drawing with the
//! extension's markup for fixed addresses. The bird is a scanning aid, not a check: a matching
//! bird is cheap to grind, so every surface that confirms a recipient keeps showing the address.

use crate::felt;
use starknet_types_core::felt::{Felt, NonZeroFelt};

const GROUND_TONES: u8 = 4;
const BODY_TONES: u8 = 5;
const ACCENT_TONES: u8 = 4;
const EYES: u8 = 3;
const FACINGS: u8 = 2;

/// Head radius, then the body ellipse's radii, per body shape.
const SHAPES: [(f64, f64, f64); 3] = [(6.0, 9.5, 8.0), (6.5, 10.5, 8.8), (5.5, 9.0, 7.2)];

const TAILS: [&str; 3] = [
    "M9 19.5 L2.5 15 L4 23 Z",
    "M9 21 L2.5 24.5 L4.5 27 L10 24 Z",
    "M9 20 L3 16.5 L5 20.5 L2.5 21.5 L5 23.5 L3.5 26 L10 23 Z",
];

const BEAKS: [&str; 3] = [
    "M27.5 11.5 L31.5 13.5 L27.5 15.5 Z",
    "M27.5 12 L33.5 13.8 L27.5 15 Z",
    "M27 11 Q32.5 11 31.5 15.5 Q29.5 14 27 15 Z",
];

/// The first crest is none.
const CRESTS: [&str; 4] = [
    "",
    "M21 7.8 Q19.8 3.5 23.2 2.5 Q22.2 5 24 7.4 Z",
    "M19.5 8.5 L18 4 L21 7.2 L21.5 2.8 L23 7 L25.5 3.8 L24.8 8 Z",
    "M17.5 10 Q18.5 4 22 4.2 Q21.5 5.6 25 5 Q23.5 6.8 26.5 8 Z",
];

const LEGS: &str = "M14.5 27 V30.5 M18.5 27 V30.5";
const WING: &str = "M8.5 18.5 Q14.5 14.5 20.5 19 Q15 25 8.5 18.5 Z";

/// Which skin colour a part takes. Ground, Body and Accent index their palette by the avatar's
/// tones; Ink and Paper are the two fixed identity colours.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum AvatarPaint {
    Ground,
    Body,
    Accent,
    Ink,
    Paper,
}

/// One drawable shape, in the bird's own 36-unit coordinates. Paths use only absolute `M`, `L`,
/// `Q`, `V` and `Z` commands.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum AvatarShape {
    /// A filled path.
    Fill { d: String },
    /// A round-capped stroke.
    Stroke { d: String, width: f64 },
    /// A filled ellipse, rotated by `rotate` degrees about its own centre.
    Ellipse {
        cx: f64,
        cy: f64,
        rx: f64,
        ry: f64,
        rotate: f64,
    },
    /// A filled circle.
    Circle { cx: f64, cy: f64, r: f64 },
}

/// A shape, its paint, and its opacity (1 is opaque). Parts paint in list order.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AvatarPart {
    pub shape: AvatarShape,
    pub paint: AvatarPaint,
    pub opacity: f64,
}

/// One account's bird. Paint the ground over the whole 36-unit square, then draw `parts` under
/// the bird transform: when `mirrored`, flip horizontally about the square's centre first; then
/// scale by `scale` about `(18, 18)`, the bird's own `(origin_x, origin_y)` landing there.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AccountAvatar {
    pub ground_tone: u8,
    pub body_tone: u8,
    pub accent_tone: u8,
    pub mirrored: bool,
    pub scale: f64,
    pub origin_x: f64,
    pub origin_y: f64,
    pub parts: Vec<AvatarPart>,
}

/// The extension reads `BigInt(address)`. The core reads the felt grammar, case-insensitively;
/// anything else (malformed, negative, past the prime) draws the zero-address bird, as malformed
/// input does there. Real account addresses are always canonical felts.
fn address_value(address: &str) -> Felt {
    felt::parse(&address.to_ascii_lowercase()).unwrap_or(Felt::ZERO)
}

fn part(shape: AvatarShape, paint: AvatarPaint) -> AvatarPart {
    AvatarPart {
        shape,
        paint,
        opacity: 1.0,
    }
}

fn circle(cx: f64, cy: f64, r: f64, paint: AvatarPaint) -> AvatarPart {
    part(AvatarShape::Circle { cx, cy, r }, paint)
}

/// `eyeMarkup`: a paper eye with an ink pupil, sized and placed by variant; the third adds a brow.
fn eye(variant: u8, head_radius: f64) -> Vec<AvatarPart> {
    let cx = 22.0 + head_radius * 0.35;
    let cy = 12.3;
    match variant {
        1 => vec![
            circle(cx, cy, 2.4, AvatarPaint::Paper),
            circle(cx + 0.7, cy, 1.3, AvatarPaint::Ink),
        ],
        2 => vec![
            circle(cx, cy + 0.3, 1.8, AvatarPaint::Paper),
            circle(cx + 0.5, cy + 0.5, 1.0, AvatarPaint::Ink),
            part(
                AvatarShape::Stroke {
                    d: format!("M{} {} L{} {}", cx - 2.2, cy - 1.6, cx + 2.0, cy - 2.6),
                    width: 1.0,
                },
                AvatarPaint::Paper,
            ),
        ],
        _ => vec![
            circle(cx, cy, 1.8, AvatarPaint::Paper),
            circle(cx + 0.5, cy, 1.0, AvatarPaint::Ink),
        ],
    }
}

/// `accountAvatar`: the bird for a public account address, without storage, network or
/// randomness. Canonical spellings of one address draw the same bird.
pub fn account_avatar(address: &str) -> AccountAvatar {
    let mut state = address_value(address);
    // Mixed-radix reads, in `accountBirdTraits` order.
    let mut pick = |range: u8| -> u8 {
        let divisor = NonZeroFelt::try_from(Felt::from(range)).expect("ranges are non-zero");
        let (quotient, remainder) = state.div_rem(&divisor);
        state = quotient;
        remainder.to_bytes_be()[31]
    };
    let ground_tone = pick(GROUND_TONES);
    let body_tone = pick(BODY_TONES);
    let accent_tone = pick(ACCENT_TONES);
    let (head_radius, body_rx, body_ry) = SHAPES[usize::from(pick(SHAPES.len() as u8))];
    let tail = TAILS[usize::from(pick(TAILS.len() as u8))];
    let beak = BEAKS[usize::from(pick(BEAKS.len() as u8))];
    let crest = CRESTS[usize::from(pick(CRESTS.len() as u8))];
    let eye_variant = pick(EYES);
    let mirrored = pick(FACINGS) == 1;

    let mut parts = vec![
        part(
            AvatarShape::Stroke {
                d: LEGS.into(),
                width: 1.4,
            },
            AvatarPaint::Body,
        ),
        part(AvatarShape::Fill { d: tail.into() }, AvatarPaint::Accent),
    ];
    if !crest.is_empty() {
        parts.push(part(
            AvatarShape::Fill { d: crest.into() },
            AvatarPaint::Accent,
        ));
    }
    parts.extend([
        part(
            AvatarShape::Ellipse {
                cx: 16.0,
                cy: 20.0,
                rx: body_rx,
                ry: body_ry,
                rotate: -18.0,
            },
            AvatarPaint::Body,
        ),
        circle(22.0, 13.0, head_radius, AvatarPaint::Body),
        AvatarPart {
            shape: AvatarShape::Ellipse {
                cx: 19.0,
                cy: 22.5,
                rx: 5.5,
                ry: 4.0,
                rotate: 0.0,
            },
            paint: AvatarPaint::Paper,
            opacity: 0.2,
        },
        part(AvatarShape::Fill { d: WING.into() }, AvatarPaint::Accent),
        part(AvatarShape::Fill { d: beak.into() }, AvatarPaint::Accent),
    ]);
    parts.extend(eye(eye_variant, head_radius));

    AccountAvatar {
        ground_tone,
        body_tone,
        accent_tone,
        mirrored,
        scale: 1.14,
        origin_x: 17.5,
        origin_y: 17.0,
        parts,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spellings_of_one_address_draw_one_bird() {
        let canonical = account_avatar("0xabcdef");
        assert_eq!(account_avatar("0x0000abcdef"), canonical);
        assert_eq!(account_avatar("0xABCDEF"), canonical);
        assert_eq!(account_avatar("not an address"), account_avatar("0x0"));
    }

    #[test]
    fn reads_cover_every_part() {
        let mut seen = [[false; 5]; 9];
        for n in 0u64..20_000 {
            let bird = account_avatar(&felt::canonical(&Felt::from(n * 7919 + 13)));
            let crest = bird.parts.iter().any(|part| {
                matches!(&part.shape, AvatarShape::Fill { d } if CRESTS[1..].contains(&d.as_str()))
            });
            for (slot, value) in [
                bird.ground_tone,
                bird.body_tone,
                bird.accent_tone,
                u8::from(bird.mirrored),
                u8::from(crest),
            ]
            .into_iter()
            .enumerate()
            {
                seen[slot][usize::from(value)] = true;
            }
        }
        assert!(seen[0][..4].iter().all(|s| *s), "every ground tone");
        assert!(seen[1].iter().all(|s| *s), "every body tone");
        assert!(seen[2][..4].iter().all(|s| *s), "every accent tone");
        assert!(seen[3][..2].iter().all(|s| *s), "both facings");
        assert!(seen[4][..2].iter().all(|s| *s), "with and without a crest");
    }

    #[test]
    fn paths_use_only_the_commands_the_apps_draw() {
        let paths = TAILS
            .iter()
            .chain(&BEAKS)
            .chain(&CRESTS)
            .chain([&LEGS, &WING]);
        for d in paths {
            assert!(
                d.chars()
                    .all(|c| "MLQVZ .-".contains(c) || c.is_ascii_digit()),
                "{d}"
            );
        }
        for variant in 0..EYES {
            for part in eye(variant, 6.0) {
                if let AvatarShape::Stroke { d, .. } | AvatarShape::Fill { d } = part.shape {
                    assert!(
                        d.chars().all(|c| "ML .-".contains(c) || c.is_ascii_digit()),
                        "{d}"
                    );
                }
            }
        }
    }
}
