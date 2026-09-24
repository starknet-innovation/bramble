import BrambleCore
import SwiftUI

/// `deploymentFundingStage`: the saved counterfactual address to fund, as a QR and a copyable
/// line, and a balance check. The extension quotes the DEPLOY_ACCOUNT fee and can fund from this
/// wallet; both need the transactions workstream's estimate and Send, so mobile names the token
/// instead of an amount and omits "Fund from this wallet".
struct MultisigFundStage: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let record: MultisigRecord?
    let next: () -> Void
    @State private var balance: String?
    @State private var checking = false

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            HStack {
                Text("Fund this multisig").brambleText(BrambleTypeScale.display, weight: BrambleWeight.bold)
                Spacer()
                Text("STRK").brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                    .padding(.horizontal, BrambleSpace.sm).frame(height: BrambleSize.pill)
                    .background(skin.elevated, in: Capsule())
                    .accessibilityLabel("STRK")
            }
            Text("Send STRK to this saved address to pay for deployment. You can close this screen and resume safely.")
                .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            if let address = record?.address {
                QRCard(text: address, label: "Multisig funding address").frame(maxWidth: .infinity)
                HStack {
                    Text(shortKey(value: address)).brambleText(BrambleTypeScale.body, mono: true)
                    Spacer()
                    IconButton(icon: .copy, label: "Copy multisig funding address", tint: skin.muted) { PublicClipboard.copy(address) }
                }
                PillButton("Check funding", kind: .secondary, busy: checking) { check(address) }
                StatusLine(text: balance)
            }
            PillButton("Continue to deploy") { next() }
        }
    }

    private func check(_ address: String) {
        checking = true
        Task {
            defer { checking = false }
            guard let strk = store.networkInfo.tokens.first(where: { $0.symbol == "STRK" }),
                  let raw = await store.coordination.balances(of: address)?["STRK"],
                  let amount = try? formatTokenAmount(raw: raw, decimals: strk.decimals, maxFraction: 4) else {
                balance = "Balance could not be checked. Try again shortly."
                return
            }
            balance = "Balance: \(amount) STRK"
        }
    }
}

/// The frozen deployment review (address, threshold, GUID-sorted signers, salt). Deploying from
/// mobile arrives with sending; the button stays disabled and says so.
struct MultisigDeployStage: View {
    @Environment(\.skin) private var skin
    let record: MultisigRecord?

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            if let deployment = record?.deployment {
                MenuGroup {
                    reviewRow("Address", shortKey(value: deployment.address))
                    reviewRow("Required", "\(deployment.config.threshold) of \(deployment.config.signerPublicKeys.count)")
                    ForEach(Array(deployment.config.signerPublicKeys.enumerated()), id: \.offset) { index, key in
                        reviewRow("Signer \(index + 1)", shortKey(value: key))
                    }
                    reviewRow("Salt", deployment.salt)
                }
            }
            PillButton("Deploy multisig") {}
                .disabled(true)
            Text("Deployment from mobile arrives with sending. Deploy this saved setup from Bramble for browser, or come back after the update.")
                .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
        }
    }

    private func reviewRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            Spacer()
            Text(value).brambleText(BrambleTypeScale.body, mono: true).foregroundStyle(skin.text)
        }
        .padding(.horizontal, BrambleSpace.lg)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}
