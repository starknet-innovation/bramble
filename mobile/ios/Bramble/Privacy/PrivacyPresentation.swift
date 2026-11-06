import BrambleCore

/// The core's privacy gate answers, spelled in the extension's copy. Views render these; the unit
/// tests hold them to the rendered extension (`extension-privacy-rules.json`).
extension ShieldTile {
    /// The tile's label and accessibility label (`shieldTile`). Every tile reads "Shield"; the
    /// accessible name says what stands in the way.
    var copy: (label: String, accessibility: String) {
        switch self {
        case .noStrkToken:
            (PrivacyCopy.tileShieldLabel, PrivacyCopy.tileNoTokenAria)

        case .fundFirst:
            (PrivacyCopy.tileFundLabel, PrivacyCopy.tileFundAria)

        case .deployFirst:
            (PrivacyCopy.tileDeployLabel, PrivacyCopy.tileDeployAria)

        case .activate:
            (PrivacyCopy.tileShieldLabel, PrivacyCopy.tileActivateAria)

        case .ready:
            (PrivacyCopy.tileShieldLabel, PrivacyCopy.tileReadyAria)
        }
    }
}

extension PrivateLine {
    /// The value side of a row's "Private balance" line (`privateBreakdownLine`). An undeployed
    /// account reads "Shield", funded or not: the journey it opens names the prerequisite.
    var text: String {
        switch self {
        case .unavailable:
            PrivacyCopy.lineUnavailable

        case .shield:
            PrivacyCopy.detailShield

        case .discovering:
            PrivacyCopy.lineDiscovering

        case .registerToStart:
            PrivacyCopy.registerToStart

        case let .amount(text):
            text
        }
    }
}

extension DetailAction {
    /// The token screen's privacy controls, left to right (`privacyActions`): one "Shield" for an
    /// undeployed account, "Shield" and "Unshield" once registered, "Go private" otherwise.
    var labels: [String] {
        switch self {
        case .none:
            []

        case .shield:
            [PrivacyCopy.detailShield]

        case .shieldUnshield:
            [PrivacyCopy.detailShield, PrivacyCopy.detailUnshield]

        case .goPrivate:
            [PrivacyCopy.detailGoPrivate]
        }
    }
}

extension PoolNotice {
    /// The notice's body and action (`privacyPoolNotice`); `nil` when hidden. Deploy-first keeps
    /// its text with the deploy action suppressed (docs/privacy.md §2.6).
    var copy: (body: String, action: String?)? {
        switch self {
        case .hidden:
            nil

        case .fundFirst:
            (PrivacyCopy.noticeFundFirstBody, nil)

        case .deployFirst:
            (PrivacyCopy.noticeDeployFirstBody, nil)

        case .register:
            (PrivacyCopy.noticeRegisterBody, PrivacyCopy.noticeRegisterAction)
        }
    }
}

/// Title, body and action label of one blocked screen; an empty action means no button.
struct PrivacyBlockedCopy: Equatable {
    let title: String
    let body: String
    let action: String
}

extension PrivacyBlocker {
    /// Title, body and action label of the blocked screen (`BLOCKED_COPY`); `unsupported` is one of
    /// the two mobile-only strings (§2.7). An empty action means no button on mobile.
    var copy: PrivacyBlockedCopy {
        switch self {
        case .deploy:
            PrivacyBlockedCopy(title: PrivacyCopy.blockedDeployTitle, body: PrivacyCopy.blockedDeployBody, action: "")

        case .fund:
            PrivacyBlockedCopy(title: PrivacyCopy.blockedFundTitle, body: PrivacyCopy.blockedFundBody, action: "")

        case .ledger:
            PrivacyBlockedCopy(title: PrivacyCopy.blockedLedgerTitle, body: PrivacyCopy.blockedLedgerBody, action: "")

        case .network:
            PrivacyBlockedCopy(
                title: PrivacyCopy.blockedNetworkTitle,
                body: PrivacyCopy.blockedNetworkBody,
                action: PrivacyCopy.blockedNetworkAction
            )

        case .pending:
            PrivacyBlockedCopy(title: PrivacyCopy.blockedPendingTitle, body: PrivacyCopy.blockedPendingBody, action: "")

        case .service:
            PrivacyBlockedCopy(
                title: PrivacyCopy.blockedServiceTitle,
                body: PrivacyCopy.blockedServiceBody,
                action: PrivacyCopy.blockedServiceAction
            )

        case .unsupported:
            PrivacyBlockedCopy(title: PrivacyCopy.unsupportedTitle, body: PrivacyCopy.unsupportedBody, action: "")
        }
    }
}
