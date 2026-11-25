import BrambleCore
import SwiftUI

/// The staking screen (`stakingFlow` in `staking-views.ts`): with no validator open, "Your stakes",
/// Starkscan's validator directory and the paste field; with one open, a row per tracked token with
/// the account's position and the actions its state allows. Every figure is the core's on-chain
/// reading; directory text is third-party, shown as plain text (a website is never a link). Where
/// the core refuses staking (any network but Mainnet) the screen says so and reads nothing.
struct StakingScreen: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var model: StakingModel?
    @State private var action: StakingActionModel?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                FlowHeader(title: StakingCopy.title, network: store.networkLabel) { back() }
                if let model {
                    if let unavailable = model.unavailable {
                        EmptyState(message: unavailable)
                    } else if let validator = model.validator {
                        StakingValidatorSection(model: model, validator: validator) { kind, row, amount in
                            action = store.makeStakingAction(kind, row: row, amount: amount, on: model)
                        }
                    } else {
                        StakingPositionsSection(model: model)
                        StakingDirectorySection(model: model)
                    }
                } else {
                    EmptyState(message: StakingCopy.validatorUnlockAccount)
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .scrollDismissesKeyboard(.interactively)
        .task {
            guard model == nil, let made = store.makeStakingModel() else { return }
            model = made
            await made.load()
        }
        .sheet(item: $action, onDismiss: reload) { action in
            StakingActionView(model: action, close: { self.action = nil }, viewActivity: {
                self.action = nil
                store.tab = .activity
                dismiss()
            })
            .environment(store)
        }
    }

    /// Back closes an open validator first, then the screen.
    private func back() {
        if model?.validator != nil { model?.closeValidator() } else { dismiss() }
    }

    /// After an action sheet closes, the validator's pools and "Your stakes" are read again.
    private func reload() {
        guard let model else { return }
        Task {
            if let validator = model.validator { await model.open(staker: validator.staker, name: validator.name) }
            await model.loadPositions()
        }
    }
}

/// One whole-row button over a validator or a position, its lines in muted caption under the name
/// and the address.
struct StakingCard: View {
    @Environment(\.skin) private var skin
    let name: String
    let staker: String
    let lines: [String]
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(alignment: .center, spacing: BrambleSpace.sm) {
                VStack(alignment: .leading, spacing: BrambleSpace.xs) {
                    Text(name).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    Text(shortAddress(staker))
                        .brambleText(BrambleTypeScale.mono.sized(BrambleMetrics.SendReview.factCodeSize), mono: true)
                        .foregroundStyle(skin.muted)
                    ForEach(lines, id: \.self) { line in
                        Text(line).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                    }
                }
                Spacer(minLength: 0)
                BrambleIcon(.chevronRight).foregroundStyle(skin.muted).accessibilityHidden(true)
            }
            .foregroundStyle(skin.text)
            .padding(BrambleSpace.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                skin.panel,
                in: RoundedRectangle(cornerRadius: BrambleMetrics.MenuList.radius, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// `stakingPositionsSection`: absent while loading, off, or when a complete list is empty; a failed
/// read is one line; an incomplete list says so, never "none".
struct StakingPositionsSection: View {
    let model: StakingModel

    var body: some View {
        switch model.positions {
        case .loading, .off:
            EmptyView()

        case let .failed(message):
            VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                Eyebrow(text: StakingCopy.positionsTitle)
                StatusLine(text: message, tone: .danger)
            }

        case let .loaded(view):
            if !view.complete || !view.rows.isEmpty {
                VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                    Eyebrow(text: StakingCopy.positionsTitle)
                    ForEach(Array(view.rows.enumerated()), id: \.offset) { _, row in
                        StakingCard(
                            name: model.name(of: row.staker) ?? StakingCopy.validatorName,
                            staker: row.staker,
                            lines: StakingText.positionLines(row)
                        ) {
                            Task { await model.open(staker: row.staker, name: model.name(of: row.staker)) }
                        }
                    }
                    if !view.complete { StatusLine(text: StakingCopy.positionsMayNotBeListed) }
                }
            }
        }
    }
}

/// `stakingDirectorySection`: the list in whatever state it is in, then the paste field, under the
/// list as the fallback or after the line saying the list couldn't load.
struct StakingDirectorySection: View {
    @Environment(\.skin) private var skin
    @Bindable var model: StakingModel

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            switch model.directory {
            case .loading:
                EmptyState(message: StakingCopy.directoryLoading)

            case .off:
                EmptyView()

            case let .failed(message):
                StatusLine(text: message, tone: .danger)

            case let .loaded(listed):
                if listed.incomplete {
                    StatusLine(text: StakingCopy.directoryIncomplete, tone: .danger)
                } else {
                    entries(listed)
                }
            }
            paste
        }
    }

    @ViewBuilder
    private func entries(_ listed: StakingModel.Directory) -> some View {
        Text(StakingCopy.directoryListedBy).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
        if listed.entries.isEmpty {
            EmptyState(message: StakingCopy.directoryNoValidators)
        }
        ForEach(listed.entries, id: \.staker) { entry in
            StakingCard(
                name: entry.name ?? StakingCopy.directoryUnnamed,
                staker: entry.staker,
                lines: [StakingText.figuresLine(entry)] + entry.pools.map(StakingText.poolLine)
                    + (entry.website.map { [$0] } ?? [])
            ) {
                Task { await model.open(staker: entry.staker, name: entry.name) }
            }
        }
        StatusLine(text: listed.moreError, tone: .danger)
        if let cursor = listed.nextCursor {
            PillButton(StakingCopy.directoryShowMore, kind: .ghost, busy: model.loadingMore, small: true) {
                Task { await model.loadDirectory(cursor: cursor) }
            }
        }
    }

    private var paste: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            if case let .loaded(listed) = model.directory, !listed.incomplete {
                Text(StakingCopy.directoryNotListed).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
            BrambleField(
                label: nil,
                placeholder: StakingCopy.directoryPasteAddress,
                text: $model.pasteInput,
                mono: true,
                invalid: model.pasteError != nil
            )
            .accessibilityLabel(StakingCopy.directoryValidatorAddress)
            StatusLine(text: model.pasteError, tone: .danger)
            PillButton(StakingCopy.directoryOpen, kind: .ghost, small: true) {
                Task { await model.openPasted() }
            }
        }
    }
}
