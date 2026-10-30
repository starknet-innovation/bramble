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

    /// Fraction digits shown for the funding balance.
    private static let balanceFractionDigits: UInt8 = 4

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            HStack {
                Text("Fund this multisig").brambleText(
                    BrambleTypeScale.title.sized(BrambleMetrics.H2.size),
                    weight: BrambleMetrics.H2.weight,
                    tracking: BrambleMetrics.H2.tracking
                )
                Spacer()
                Text("STRK").brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                    .padding(.horizontal, BrambleSpace.sm)
                    .frame(height: BrambleSize.pill)
                    .background(skin.elevated, in: Capsule())
                    .accessibilityLabel("STRK")
            }
            Text("Send STRK to this saved address to pay for deployment. You can close this screen and resume safely.")
                .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            if let address = record?.address {
                QRCard(text: address, label: "Multisig funding address").frame(maxWidth: .infinity)
                HStack {
                    Text(shortAddress(address)).brambleText(BrambleTypeScale.body, mono: true)
                    Spacer()
                    CopyButton(value: address, label: "Copy multisig funding address")
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
                  let raw = (try? await store.coordination.balances(of: address))?["STRK"],
                  let amount = try? formatTokenAmount(
                      raw: raw,
                      decimals: strk.decimals,
                      maxFraction: Self.balanceFractionDigits
                  ) else {
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

    private static let reviewRowMinHeight: CGFloat = 44

    private static let deployUnavailableMessage = "Deployment from mobile arrives with sending. "
        + "Deploy this saved setup from Bramble for browser, or come back after the update."

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            if let deployment = record?.deployment {
                MenuGroup {
                    reviewRow("Address", shortAddress(deployment.address))
                    reviewRow(
                        "Required",
                        "\(deployment.config.threshold) of \(deployment.config.signerPublicKeys.count)"
                    )
                    ForEach(Array(deployment.config.signerPublicKeys.enumerated()), id: \.offset) { index, key in
                        reviewRow("Signer \(index + 1)", shortAddress(key))
                    }
                    reviewRow("Salt", deployment.salt)
                }
            }
            PillButton("Deploy multisig") {
                // No action: deployment from mobile is not available yet, so the button stays disabled.
            }
            .disabled(true)
            Text(Self.deployUnavailableMessage)
                .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
        }
    }

    private func reviewRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            Spacer()
            Text(value).brambleText(BrambleTypeScale.body, mono: true).foregroundStyle(skin.text)
        }
        .padding(BrambleMetrics.MenuRow.padding)
        .frame(minHeight: Self.reviewRowMinHeight)
        .accessibilityElement(children: .combine)
    }
}
