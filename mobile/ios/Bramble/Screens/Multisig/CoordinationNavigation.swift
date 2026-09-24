import SwiftUI

/// Screens this workstream adds to the wallet's navigation stack, pushed as
/// `WalletShell.Flow.coordination(_)` so the shell needs one case, not one per screen.
enum CoordinationFlow: Hashable {
    case addressBook
    case sharedAccounts
    case readyMultisig
    case addShared
    /// Create a multisig; `resume` names a saved, undeployed setup to complete.
    case createMultisig(resume: String?)
    case sharedAccount(id: String)
    case sharedReceive(id: String)
}

/// Pushes a coordination screen onto the wallet's stack.
struct CoordinationNavigator: Sendable {
    let open: @MainActor @Sendable (CoordinationFlow) -> Void

    @MainActor func callAsFunction(_ flow: CoordinationFlow) { open(flow) }
}

extension EnvironmentValues {
    @Entry var openCoordinationFlow = CoordinationNavigator { _ in }
}

/// Resolves a pushed coordination flow to its screen.
struct CoordinationDestination: View {
    let flow: CoordinationFlow

    var body: some View {
        switch flow {
        case .addressBook: AddressBookView()
        case .sharedAccounts: SharedAccountsView()
        case .readyMultisig: ReadyMultisigView()
        case .addShared: AddSharedAccountView()
        case .createMultisig(let resume): CreateMultisigView(resumeId: resume)
        case .sharedAccount(let id): SharedAccountHomeView(id: id)
        case .sharedReceive(let id): SharedReceiveView(id: id)
        }
    }
}
