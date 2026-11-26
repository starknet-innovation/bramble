import BrambleCore
import Foundation

/// Which accounts a Ledger flow reads (`onboard-session.ts`): Add account's "Ledger account" reads
/// Bramble's scheme, "Ready Ledger account" reads Ready's, and first-run setup reads both.
enum LedgerRoute: Equatable {
    case bramble, ready, firstRun

    var schemes: [LedgerScheme] {
        switch self {
        case .bramble:
            [.bramble]

        case .ready:
            [.ready]

        case .firstRun:
            [.bramble, .ready]
        }
    }

    /// The families a key read at `scheme` is placed as. The extension also places a Ready-scheme
    /// key as Braavos; the core refuses Braavos Ledger accounts, so mobile does not.
    static func families(_ scheme: LedgerScheme) -> [AccountFamily] {
        scheme == .bramble ? [.openZeppelin, .argent] : [.argent]
    }
}

/// One half of an address's on-chain state: what the read found, or `.unknown` when it failed.
enum LedgerFact: Equatable, Sendable {
    case present, absent, unknown
}

/// An address's on-chain state (`readLedgerAccountState`): deployed, and holding a known token.
struct LedgerActivity: Equatable, Sendable {
    var deployed: LedgerFact
    var funded: LedgerFact

    static let unknown = Self(deployed: .unknown, funded: .unknown)

    /// `ledgerCandidateActive`: deployed, or holding a known token. Unknown counts as inactive.
    var active: Bool {
        deployed == .present || funded == .present
    }
}

/// One account the picker lists: what the device key places, and its on-chain state once read.
struct LedgerRow: Equatable, Identifiable {
    let candidate: LedgerCandidate
    /// Nil while the on-chain check runs.
    var activity: LedgerActivity?
    /// Already in this wallet: listed, never selectable.
    let existing: Bool

    var id: String { candidate.address }
    var family: AccountFamily { candidate.request.family }
    var active: Bool { activity?.active == true }
    private var atBramblePath: Bool { family == .argent && candidate.request.scheme == .bramble }

    /// `ledgerCandidateSelectable`: never a held account; an Argent one only when it is active,
    /// since adding an unused one would deploy a family Bramble does not create.
    var selectable: Bool {
        !existing && (family == .openZeppelin || active)
    }

    /// The row title; an Argent account at Bramble's path is named so beside Ready's.
    func title(namingPath: Bool) -> String {
        let index = candidate.request.accountIndex
        return namingPath && atBramblePath ? "Account \(index) · Bramble path" : "Account \(index)"
    }

    /// `candidateState`: the row's status, in the recovery picker's words.
    var status: String {
        if existing { return "Already in this wallet" }
        guard let activity, activity.deployed != .unknown else { return "Checking…" }
        if activity.deployed == .present { return "Deployed on Starknet" }
        switch activity.funded {
        case .present:
            return family == .openZeppelin ? "Funded and ready to deploy" : "Funded, not deployed"

        case .unknown:
            return "Couldn't check this account's activity. Try again."

        case .absent:
            break
        }
        if family == .argent {
            return candidate.request.scheme == .ready
                ? "No on-chain activity found — Bramble only imports existing Ready accounts"
                : "No on-chain activity found — Bramble only imports existing Argent accounts"
        }
        return "No on-chain activity found"
    }
}

/// One group of the picker (`candidateGroup`, or Ready's flat list).
struct LedgerGroup: Equatable {
    let title: String
    let rows: [LedgerRow]
    /// Whether rows name their path ("Account 3 · Bramble path").
    let namingPath: Bool

    var detected: Int { rows.filter(\.active).count }

    /// The groups `rows` form for `route`: Ready's one list, or Bramble then Argent accounts. When
    /// one group holds both paths' Argent accounts, an unused one at Bramble's path is left out,
    /// unless its balance read failed, so the failure is said, not hidden.
    static func groups(_ rows: [LedgerRow], route: LedgerRoute) -> [Self] {
        if route == .ready { return [Self(title: "Ready accounts", rows: rows, namingPath: false)] }
        return [AccountFamily.openZeppelin, .argent].compactMap { family in
            let members = rows.filter { $0.family == family }
            guard !members.isEmpty else { return nil }
            let atBramble = { (row: LedgerRow) in
                row.family == .argent && row.candidate.request.scheme == .bramble
            }
            let mixed = members.contains { !atBramble($0) } && members.contains(where: atBramble)
            let shown = mixed
                ? members.filter { row in
                    !atBramble(row) || row.active || row.activity == LedgerActivity(deployed: .absent, funded: .unknown)
                }
                : members
            let sorted = shown.enumerated()
                .sorted { lhs, rhs in
                    (lhs.element.candidate.request.accountIndex, lhs.offset)
                        < (rhs.element.candidate.request.accountIndex, rhs.offset)
                }
                .map(\.element)
            let ready = family == .argent && members.contains { !atBramble($0) }
            let name = family == .openZeppelin ? "Bramble" : ready ? "Ready" : "Argent"
            return Self(title: "\(name) accounts", rows: sorted, namingPath: mixed)
        }
    }
}
