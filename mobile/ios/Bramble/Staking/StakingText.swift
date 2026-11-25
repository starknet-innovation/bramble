import BrambleCore
import Foundation

/// The staking screens' wording, filled from the extension's copy (`StakingCopy`, generated) and
/// the core's figures. Pure: every figure is a string the core formatted from an on-chain read,
/// and nothing here derives one. Refusals are the core's sentences read through the friendly
/// copy (`message`).
enum StakingText {
    private static let secondsPerMinute: UInt64 = 60
    private static let secondsPerHour: UInt64 = 3_600
    private static let secondsPerDay: UInt64 = 86_400
    /// One duration unit and its singular and plural templates.
    private struct Unit {
        let seconds: UInt64
        let one: String
        let many: String
    }

    private static let units = [
        Unit(seconds: secondsPerDay, one: StakingCopy.durationDay, many: StakingCopy.durationDays),
        Unit(seconds: secondsPerHour, one: StakingCopy.durationHour, many: StakingCopy.durationHours),
        Unit(seconds: secondsPerMinute, one: StakingCopy.durationMinute, many: StakingCopy.durationMinutes)
    ]

    /// `{name}` placeholders replaced, as the side panel's `t()`.
    static func fill(_ template: String, _ values: [String: String]) -> String {
        values.reduce(template) { text, pair in text.replacingOccurrences(of: "{\(pair.key)}", with: pair.value) }
    }

    /// `exitWindowText`: the window rounded down to its largest whole unit ("7 days").
    static func exitWindow(_ seconds: UInt64) -> String {
        for unit in units where seconds >= unit.seconds {
            let count = seconds / unit.seconds
            return fill(count == 1 ? unit.one : unit.many, ["count": String(count)])
        }
        return fill(StakingCopy.durationSeconds, ["count": String(seconds)])
    }

    /// "Unstaking takes 7 days, with no rewards while you wait."
    static func exitWindowLine(_ seconds: UInt64) -> String {
        fill(StakingCopy.validatorExitWindow, ["window": exitWindow(seconds)])
    }

    /// `unlockText`: the unlock time in fixed UTC ("12 Sep 2026, 14:05"), never the device's zone.
    static func unlock(_ seconds: UInt64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(seconds))
        return "\(utc("dd MMM yyyy").string(from: date)), \(utc("HH:mm").string(from: date))"
    }

    private static func utc(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = format
        return formatter
    }

    private static func amount(_ value: String) -> String { compactAmount(formatted: value, places: nil) }

    private static func held(_ value: String) -> Bool { !value.isEmpty && value != "0" }

    /// `positionLines`: staked, rewards, a reward address other than this account, and a pending
    /// or withdrawable unstake with its UTC unlock time. Empty for no position.
    static func positionLines(_ row: StakingRowView) -> [String] {
        guard let figures = row.figures else { return [] }
        var lines: [String] = []
        if held(figures.staked) {
            lines.append(fill(StakingCopy.positionStaked, ["amount": amount(figures.staked), "symbol": row.symbol]))
        }
        if held(figures.unclaimed) {
            lines.append(fill(StakingCopy.positionRewards, ["amount": amount(figures.unclaimed), "symbol": "STRK"]))
        }
        if let rewardsTo = figures.rewardsTo {
            lines.append(fill(StakingCopy.positionRewardsTo, ["address": accountLabel(address: rewardsTo)]))
        }
        if figures.state == .exitPending, let time = figures.unpoolTime {
            lines.append(fill(StakingCopy.positionUnstaking, [
                "amount": amount(figures.unpoolAmount), "symbol": row.symbol, "time": unlock(time)
            ]))
        }
        if figures.state == .withdrawable {
            lines.append(fill(StakingCopy.positionReadyToWithdraw, [
                "amount": amount(figures.unpoolAmount), "symbol": row.symbol
            ]))
        }
        return lines
    }

    /// "Commission 5% · 1,000 STRK delegated".
    static func commissionLine(_ row: StakingRowView, _ figures: RowFigures) -> String {
        fill(StakingCopy.validatorCommission, [
            "commission": figures.commission, "delegated": figures.delegated, "symbol": row.symbol
        ])
    }

    /// "Commission 5% · 30-day uptime 99%", "unknown" for a figure the directory did not give.
    static func figuresLine(_ entry: DirectoryEntry) -> String {
        fill(StakingCopy.directoryFigures, [
            "commission": entry.commission ?? StakingCopy.directoryUnknown,
            "uptime": entry.uptime ?? StakingCopy.directoryUnknown
        ])
    }

    /// One pool of a directory entry: "1,000 STRK delegated" or "STRK delegated unknown".
    static func poolLine(_ pool: DirectoryPoolEntry) -> String {
        guard let delegated = pool.delegated else {
            return fill(StakingCopy.directoryPoolUnknown, ["symbol": pool.symbol])
        }
        return fill(StakingCopy.directoryPool, ["delegated": delegated, "symbol": pool.symbol])
    }

    /// A refusal or error as the reader sees it: the core's refusal through the extension's
    /// friendly copy (`FriendlyError`, the side panel's `friendlyError`), with `context` the
    /// screen's own line for one that says nothing a reader needs; anything that is not a refusal
    /// reads the extension's `STAKING_UNREADABLE` (`StakingCopy.readFailed`), so a failed read
    /// never reads as "no stakes". Never for the review sentence or a risk line.
    static func message(_ error: Error, context: String? = nil) -> String {
        if case let StakingError.Refused(reason) = error { return FriendlyError.message(reason, context: context) }
        return StakingCopy.readFailed
    }

    /// The actions a verified row offers (`rowActions`), in the extension's order; the stake and
    /// unstake amount forms are separate. None for an unverified row.
    static func buttons(_ figures: RowFigures?) -> [StakingAction] {
        guard let figures else { return [] }
        var actions: [StakingAction] = []
        if held(figures.unclaimed) { actions.append(.claim) }
        if figures.state == .withdrawable { actions.append(.withdraw) }
        if figures.state == .exitPending || figures.state == .withdrawable { actions.append(.cancelUnstake) }
        return actions
    }

    /// The control's label for `action`.
    static func label(_ action: StakingAction) -> String {
        switch action {
        case .stake:
            StakingCopy.actionStake

        case .claim:
            StakingCopy.actionClaim

        case .unstake:
            StakingCopy.actionUnstake

        case .cancelUnstake:
            StakingCopy.actionCancelUnstake

        case .withdraw:
            StakingCopy.actionWithdraw
        }
    }
}
