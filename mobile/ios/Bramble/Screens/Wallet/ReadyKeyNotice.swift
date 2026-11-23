import BrambleCore

/// The extension's Home notice for a Ready account whose key an earlier Krusty derived
/// (`ready-key-notice.ts`, `portfolio.readyKey.*` on `release/v0.10.11`; docs/accounts.md §2.4a),
/// worded for the one action mobile has: it cannot reveal the key.
enum ReadyKeyNotice {
    static let title = "Move this account's funds"
    static let body = "Restoring your phrase won't find this account. Move its funds to another account."
    static let moveFunds = "Move funds"

    /// Whether Home shows the notice: only for an account the core marks `preFixReadyKey`.
    static func shows(for account: AccountRecord?) -> Bool { account?.preFixReadyKey == true }
}
