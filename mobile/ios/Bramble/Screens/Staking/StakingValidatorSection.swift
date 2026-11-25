import BrambleCore
import SwiftUI

/// `validatorSection` in `staking-views.ts`: the validator's name and full address, the exit
/// window the staking contract reports, then one row per tracked token. A row the core could not
/// verify shows its refusal and offers nothing.
struct StakingValidatorSection: View {
    @Environment(\.skin) private var skin
    let model: StakingModel
    let validator: StakingModel.Validator
    /// Starts an action on a row: the action, the row, and the amount typed (stake and unstake).
    let act: (StakingAction, StakingRowView, String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            PillButton(StakingCopy.validatorAllValidators, kind: .ghost, small: true) { model.closeValidator() }
            VStack(alignment: .leading, spacing: BrambleSpace.xs) {
                Text(validator.name ?? StakingCopy.validatorName)
                    .brambleText(BrambleTypeScale.row, weight: BrambleWeight.bold)
                // The full address: it is what the review names.
                Text(validator.staker)
                    .brambleText(BrambleTypeScale.mono.sized(BrambleMetrics.SendReview.factCodeSize), mono: true)
                    .foregroundStyle(skin.muted)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("staking-validator-address")
            }
            switch model.pools {
            case .loading, .off:
                EmptyState(message: StakingCopy.validatorLoading)

            case let .failed(message):
                StatusLine(text: message, tone: .danger)

            case let .loaded(view):
                Text(StakingText.exitWindowLine(view.exitWindowSeconds))
                    .brambleText(BrambleTypeScale.body)
                    .foregroundStyle(skin.muted)
                if view.rows.isEmpty {
                    EmptyState(message: StakingCopy.validatorNoTokens)
                }
                ForEach(Array(view.rows.enumerated()), id: \.offset) { _, row in
                    StakingRowCard(row: row, act: act)
                }
            }
        }
    }
}

/// `stakingRow`: the symbol, the commission line, the position, the row's action buttons, then
/// the stake form (or the leaving notice) and, while staked, the unstake form.
struct StakingRowCard: View {
    @Environment(\.skin) private var skin
    let row: StakingRowView
    let act: (StakingAction, StakingRowView, String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            Text(row.symbol).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
            if let figures = row.figures {
                caption(StakingText.commissionLine(row, figures))
                ForEach(StakingText.positionLines(row), id: \.self) { caption($0) }
                ForEach(StakingText.buttons(figures), id: \.self) { action in
                    PillButton(
                        StakingText.label(action),
                        kind: action == .withdraw ? .primary : .secondary,
                        small: true
                    ) { act(action, row, nil) }
                }
                if figures.accepting {
                    StakingAmountForm(action: .stake, row: row, act: act)
                } else {
                    caption(StakingCopy.validatorLeaving)
                }
                if figures.state == .staked { StakingAmountForm(action: .unstake, row: row, act: act) }
            } else if let refusal = row.refusal {
                caption(FriendlyError.message(refusal))
            }
        }
        .padding(BrambleSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleMetrics.MenuList.radius, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("staking-row-\(row.symbol)")
    }

    private func caption(_ text: String) -> some View {
        Text(text).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
    }
}

/// An amount field and its button; an empty field does nothing, as the extension focuses it.
struct StakingAmountForm: View {
    let action: StakingAction
    let row: StakingRowView
    let act: (StakingAction, StakingRowView, String?) -> Void
    @State private var amount = ""

    var body: some View {
        let label = action == .stake ? StakingCopy.actionStakeAmount : StakingCopy.actionUnstakeAmount
        HStack(spacing: BrambleSpace.sm) {
            BrambleField(label: nil, placeholder: "0 \(row.symbol)", text: $amount)
                .accessibilityLabel(StakingText.fill(label, ["symbol": row.symbol]))
            PillButton(StakingText.label(action), kind: action == .stake ? .primary : .secondary, small: true) {
                let typed = amount.trimmingCharacters(in: .whitespaces)
                if !typed.isEmpty { act(action, row, typed) }
            }
        }
    }
}
