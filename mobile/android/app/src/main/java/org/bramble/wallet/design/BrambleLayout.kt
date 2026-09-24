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
    val fieldLabelGap = 6.dp
    val checkBox = 18.dp
    val checkRadius = 4.dp
    val checkStroke = 1.5.dp
    val checkIcon = 13.dp
    val checkNudge = 1.dp
    val segmentHeight = 36.dp
    val segmentInset = 4.dp

    // Surfaces.swift: menu rows, network pill, medallion, option card, detail row, toast.
    val menuRowMin = 52.dp
    val menuIcon = 20.dp
    val menuIconSlot = 28.dp
    val networkRowMin = 64.dp
    val statusDot = 6.dp
    val pillGap = 6.dp
    val pillExtraHeight = 8.dp
    val flowHeaderTop = 2.dp
    val medallion = 54.dp
    val medallionIcon = 24.dp
    val optionCardMin = 82.dp
    val detailRowMin = 44.dp
    val detailIcon = 16.dp
    val toastChip = 30.dp
    val toastPadding = 10.dp
    val toastBottom = 76.dp
    val subtitleGap = 1.dp
    val rowTextGap = 2.dp

    // OnboardingScaffold.swift / OnboardingSteps.swift.
    val cardMaxWidth = 520.dp
    val onboardingGutter = 28.dp
    val onboardingTop = 38.dp
    val onboardingHeadTopWithBack = 46.dp
    val onboardingFoot = 30.dp
    val welcomeTop = 26.dp
    val wordmarkWidth = 220.dp
    val lockNoteIcon = 13.dp
    val meterTrack = 4.dp
    val meterGap = 7.dp
    val reviewCardMin = 76.dp
    val reviewCheckIcon = 17.dp
    val completeGutter = 32.dp
    val completeIcon = 28.dp
    val inlineActionHeight = 36.dp

    // RecoveryGrid.swift.
    val wordNumberWidth = 18.dp
    val wordCellGap = 6.dp
    val suggestionHeight = 32.dp
    /** `blur(radius: 6)` on masked words. */
    val maskBlur = 6.dp

    // UnlockView.swift, WalletShell.swift, ReceiveView.swift, SettingsViews.swift.
    val unlockMark = 34.dp
    val accountChevron = 12.dp
    val dockPaddingVertical = 6.dp
    val qrSide = 156.dp
    val revealAlertIcon = 20.dp

    // Send screens: iOS `BrambleMetrics.Send*`, read from the side panel's send stylesheet
    // (`.send-amount-field input` min-height, `.send-outcome-mark`, the task-list hairline inset).
    val sendAmountMin = 52.dp
    val sendOutcomeMark = 76.dp
    val sendTaskHairlineInset = 24.dp
}
