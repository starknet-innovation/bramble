import SwiftUI

/// Screens this workstream adds to the wallet's navigation stack, pushed as
/// `WalletShell.Flow.coordination(_)` so the shell needs one case, not one per screen.
enum CoordinationFlow: Hashable {
    case addressBook
    /// Save a typed Send recipient: the address book with that address filled in.
    case saveAddress(String)
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

    @MainActor
    func callAsFunction(_ flow: CoordinationFlow) { open(flow) }
}

extension EnvironmentValues {
    @Entry var openCoordinationFlow = CoordinationNavigator { _ in
        // No action: outside the wallet shell there is no stack to push a coordination screen onto.
    }
}

/// Resolves a pushed coordination flow to its screen.
struct CoordinationDestination: View {
    let flow: CoordinationFlow

    var body: some View {
        switch flow {
        case .addressBook:
            AddressBookView()

        case .saveAddress(let address):
            AddressBookView(draft: address)

        case .sharedAccounts:
            SharedAccountsView()

        case .readyMultisig:
            ReadyMultisigView()

        case .addShared:
            AddSharedAccountView()

        case .createMultisig(let resume):
            CreateMultisigView(resumeId: resume)

        case .sharedAccount(let id):
            SharedAccountHomeView(id: id)

        case .sharedReceive(let id):
            SharedReceiveView(id: id)
        }
    }
}
