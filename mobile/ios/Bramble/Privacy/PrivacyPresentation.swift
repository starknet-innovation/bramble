import BrambleCore

/// The core's privacy gate answers, spelled in the extension's copy. Views render these; the unit
/// tests hold them to the rendered extension (`extension-privacy-rules.json`).
extension ShieldTile {
    /// The tile's label and accessibility label (`shieldTile`).
    var copy: (label: String, accessibility: String) {
        switch self {
        case .noStrkToken: (PrivacyCopy.tileShieldLabel, PrivacyCopy.tileNoTokenAria)
        case .fundFirst: (PrivacyCopy.tileFundLabel, PrivacyCopy.tileFundAria)
        case .deployAndEnable: (PrivacyCopy.tileDeployLabel, PrivacyCopy.tileDeployLabel)
        case .activate: (PrivacyCopy.tileShieldLabel, PrivacyCopy.tileActivateAria)
        case .ready: (PrivacyCopy.tileShieldLabel, PrivacyCopy.tileReadyAria)
        }
    }
}

extension PrivateLine {
    /// The value side of a row's "Private balance" line (`privateBreakdownLine`).
    var text: String {
        switch self {
        case .unavailable: PrivacyCopy.lineUnavailable
        case .fundWithStrk: PrivacyCopy.tileFundLabel
        case .deployAndEnable: PrivacyCopy.tileDeployLabel
        case .discovering: PrivacyCopy.lineDiscovering
        case .registerToStart: PrivacyCopy.registerToStart
        case let .amount(text): text
        }
    }
}

extension PoolNotice {
    /// The notice's body and action (`privacyPoolNotice`); `nil` when hidden. Deploy-first keeps
    /// its text with the deploy action suppressed (docs/privacy.md §2.6).
    var copy: (body: String, action: String?)? {
        switch self {
        case .hidden: nil
        case .fundFirst: (PrivacyCopy.noticeFundFirstBody, nil)
        case .deployFirst: (PrivacyCopy.noticeDeployFirstBody, nil)
        case .register: (PrivacyCopy.noticeRegisterBody, PrivacyCopy.noticeRegisterAction)
        }
    }
}

extension PrivacyBlocker {
    /// Title, body and action label of the blocked screen (`BLOCKED_COPY`); `unsupported` is one of
    /// the two mobile-only strings (§2.7). An empty action means no button on mobile.
    var copy: (title: String, body: String, action: String) {
        switch self {
        case .deploy: (PrivacyCopy.blockedDeployTitle, PrivacyCopy.blockedDeployBody, "")
        case .fund: (PrivacyCopy.blockedFundTitle, PrivacyCopy.blockedFundBody, "")
        case .ledger: (PrivacyCopy.blockedLedgerTitle, PrivacyCopy.blockedLedgerBody, "")
        case .network: (PrivacyCopy.blockedNetworkTitle, PrivacyCopy.blockedNetworkBody, PrivacyCopy.blockedNetworkAction)
        case .pending: (PrivacyCopy.blockedPendingTitle, PrivacyCopy.blockedPendingBody, "")
        case .service: (PrivacyCopy.blockedServiceTitle, PrivacyCopy.blockedServiceBody, PrivacyCopy.blockedServiceAction)
        case .unsupported: (PrivacyCopy.unsupportedTitle, PrivacyCopy.unsupportedBody, "")
        }
    }
}
