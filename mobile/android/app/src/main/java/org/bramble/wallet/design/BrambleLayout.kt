package org.bramble.wallet.design

import androidx.compose.ui.unit.dp

/**
 * Component geometry that the generated scale does not name: each value is the literal the iOS
 * DesignSystem and screens use for the same element (cited per group), which in turn copies the
 * side-panel stylesheet. Screens read these names instead of writing `.dp` literals, so the
 * source-hygiene test can hold UI code to tokens only. When the generator grows a matching token,
 * the entry here is replaced by it.
 */
object BrambleLayout {
    /** A 1px rule: the hairlines between rows. */
    val hairline = 1.dp

    // Controls.swift: field label gap, the check box, the segmented control.

    /** Gap between a field label and its input. */
    val fieldLabelGap = 6.dp

    /** Side of the check-row box. */
    val checkBox = 18.dp

    /** Corner radius of the check-row box. */
    val checkRadius = 4.dp

    /** Border width of the unchecked check-row box. */
    val checkStroke = 1.5.dp

    /** Size of the check mark inside the box. */
    val checkIcon = 13.dp

    /** Top offset that aligns the check box with the first text line. */
    val checkNudge = 1.dp

    /** Height of the segmented control. */
    val segmentHeight = 36.dp

    /** Inset between the segmented control track and its selected segment. */
    val segmentInset = 4.dp

    // Surfaces.swift: menu rows, network pill, medallion, option card, detail row, toast.

    /** Minimum height of a menu row. */
    val menuRowMin = 52.dp

    /** Size of a menu row icon. */
    val menuIcon = 20.dp

    /** Width of the slot that holds a menu row icon. */
    val menuIconSlot = 28.dp

    /** Minimum height of a network row in settings. */
    val networkRowMin = 64.dp

    /** Diameter of the network health dot. */
    val statusDot = 6.dp

    /** Gap between an icon and its label in a pill or compact row. */
    val pillGap = 6.dp

    /** Extra height the network pill adds on top of the pill size. */
    val pillExtraHeight = 8.dp

    /** Top padding of a flow header. */
    val flowHeaderTop = 2.dp

    /** Diameter of the icon medallion. */
    val medallion = 54.dp

    /** Size of the icon inside a medallion. */
    val medallionIcon = 24.dp

    /** Minimum height of an option card. */
    val optionCardMin = 82.dp

    /** Minimum height of a detail row. */
    val detailRowMin = 44.dp

    /** Size of a detail row or chip icon. */
    val detailIcon = 16.dp

    /** Stroke width of a token's price sparkline (iOS `TokenDetailView.sparklineLineWidth`). */
    val sparklineStroke = 1.5.dp

    /** Size of the icon chip inside a toast. */
    val toastChip = 30.dp

    /** Inner padding of a toast. */
    val toastPadding = 10.dp

    /** Distance of the toast from the bottom edge, clearing the dock. */
    val toastBottom = 76.dp

    /** Gap between a title and its subtitle. */
    val subtitleGap = 1.dp

    /** Gap between the text lines of a list row. */
    val rowTextGap = 2.dp

    // OnboardingScaffold.swift / OnboardingSteps.swift.

    /** Maximum width of the onboarding card. */
    val cardMaxWidth = 520.dp

    /** Horizontal gutter of the onboarding screens. */
    val onboardingGutter = 28.dp

    /** Top padding of an onboarding screen. */
    val onboardingTop = 38.dp

    /** Top padding of an onboarding heading when a back button sits above it. */
    val onboardingHeadTopWithBack = 46.dp

    /** Bottom padding of an onboarding screen. */
    val onboardingFoot = 30.dp

    /** Top padding of the welcome step. */
    val welcomeTop = 26.dp

    /** Width of the Bramble wordmark on the welcome step. */
    val wordmarkWidth = 220.dp

    /** Size of the lock icon in the welcome step note. */
    val lockNoteIcon = 13.dp

    /** Height of the passphrase strength meter track. */
    val meterTrack = 4.dp

    /** Gap between the strength meter and its label. */
    val meterGap = 7.dp

    /** Minimum height of an account review card. */
    val reviewCardMin = 76.dp

    /** Size of the check icon on an account review card. */
    val reviewCheckIcon = 17.dp

    /** Horizontal gutter of the onboarding complete step. */
    val completeGutter = 32.dp

    /** Size of the check icon on the onboarding complete step. */
    val completeIcon = 28.dp

    /** Minimum height of an inline onboarding action. */
    val inlineActionHeight = 36.dp

    // RecoveryGrid.swift.

    /** Width of the index column in a recovery-phrase cell. */
    val wordNumberWidth = 18.dp

    /** Gap between recovery-phrase cells. */
    val wordCellGap = 6.dp

    /** Height of a word-suggestion chip. */
    val suggestionHeight = 32.dp

    /** `blur(radius: 6)` on masked words. */
    val maskBlur = 6.dp

    // UnlockView.swift, WalletShell.swift, ReceiveView.swift, SettingsViews.swift.

    /** Size of the brand mark inside the unlock disc. */
    val unlockMark = 34.dp

    /** Size of the chevron beside the account name. */
    val accountChevron = 12.dp

    /** Vertical padding of the floating dock. */
    val dockPaddingVertical = 6.dp

    /** Side of the receive QR code. */
    val qrSide = 156.dp

    /** Size of the alert icon on the secret-reveal screen. */
    val revealAlertIcon = 20.dp

    // Send screens: iOS `BrambleMetrics.Send*`, read from the side panel's send stylesheet
    // (`.send-amount-field input` min-height, `.send-outcome-mark`, the task-list hairline inset).

    /** Minimum height of the send amount field. */
    val sendAmountMin = 52.dp

    /** Size of the send outcome mark. */
    val sendOutcomeMark = 76.dp

    /** Leading inset of the hairline between send task rows. */
    val sendTaskHairlineInset = 24.dp
}
