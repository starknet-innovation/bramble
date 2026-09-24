import BrambleCore
import SwiftUI

/// `#account-preview` with the Mainnet acknowledgement: confirm the derived public address.
struct ReviewAccountStep: View {
    @Environment(\.skin) private var skin
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(WalletStore.self) private var store
    let network: NetworkId
    let next: () -> Void
    @State private var account: AccountRecord?
    @State private var selected = true
    @State private var acknowledged = false

    /// The check mark shrinks slightly while the account is not selected.
    private static let unselectedCheckScale: CGFloat = 0.92

    var body: some View {
        OnboardingStep(
            icon: .wallet,
            title: "Review your account",
            lede: "Confirm the derived public address, then add it to this wallet."
        ) {
            VStack(spacing: BrambleMetrics.Onboarding.fieldsGap) {
                accountOption
                if network == .mainnet {
                    CheckRow(
                        text: "I understand this wallet can hold real funds on Starknet Mainnet.",
                        isOn: $acknowledged
                    )
                }
            }
        } cta: {
            PillButton("Add selected account", action: next)
                .disabled(account == nil || !selected || (network == .mainnet && !acknowledged))
        }
        .task { account = try? await store.previewAccount() }
    }

    /// The derived account as one selectable option row.
    private var accountOption: some View {
        let option = BrambleMetrics.OnboardingOption.self
        let preview = account.map { accountPreviewLabel(address: $0.address) }
        return Button { selected.toggle() } label: {
            HStack(spacing: option.gap) {
                // `.onboarding-account-avatar`: the account's two-digit position.
                Text(String(format: "%02d", Int(account?.accountIndex ?? 0) + 1))
                    .brambleText(BrambleTypeScale.caption, weight: BrambleWeight.bold)
                    .frame(width: option.iconSize, height: option.iconSize)
                    .background(skin.panel, in: Circle())
                VStack(alignment: .leading, spacing: option.copyGap) {
                    Text("Primary Bramble account")
                        .brambleText(BrambleTypeScale.body.sized(option.titleSize), weight: option.titleWeight)
                    Text(preview ?? "Deriving account…")
                        .brambleText(
                            BrambleTypeStyle(size: option.detailSize, lineHeight: option.detailLineHeight),
                            weight: BrambleMetrics.Button.weight
                        )
                        .foregroundStyle(selected ? skin.text : skin.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                BrambleIcon(.check, size: BrambleMetrics.OnboardingAccount.checkGlyph)
                    .foregroundStyle(skin.bg)
                    .frame(width: option.iconSize, height: option.iconSize)
                    .background(skin.text, in: Circle())
                    .opacity(selected ? 1 : 0)
                    .scaleEffect(reduceMotion || selected ? 1 : Self.unselectedCheckScale)
            }
            .padding(option.padding)
            .frame(minHeight: BrambleMetrics.OnboardingAccount.height)
        }
        .buttonStyle(
            FillPressStyle(
                fill: selected ? skin.softPress : skin.elevated,
                pressed: skin.softPress,
                shape: RoundedRectangle(cornerRadius: option.radius, style: .continuous)
            )
        )
        .elevation(selected ? BrambleElevation.onboardingAccountSelected : nil)
        .animation(
            BrambleMotionPolicy.animation(
                BrambleEase.out.animation(ms: BrambleMotion.liftMs),
                reduceMotion: reduceMotion
            ),
            value: selected
        )
        .accessibilityLabel("Primary Bramble account, \(preview ?? "deriving account")")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint("Selects this account to add")
        .brambleHaptic(.selection, trigger: selected)
    }
}
