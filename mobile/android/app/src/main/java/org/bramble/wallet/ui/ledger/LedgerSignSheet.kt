package org.bramble.wallet.ui.ledger

import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.window.SecureFlagPolicy
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ledger.LedgerBluetooth
import org.bramble.wallet.ledger.LedgerDevice
import org.bramble.wallet.ledger.LedgerSignStage
import org.bramble.wallet.ledger.LedgerSigner
import org.bramble.wallet.ledger.ledgerBluetoothPermissions
import org.bramble.wallet.ui.CopyButton

/**
 * "Confirm on your Ledger": the sheet every Ledger signature passes through, shown while the
 * app's [LedgerSigner] waits on the device. Dismissing it is Cancel transaction. Asks for the
 * Bluetooth permissions when they are missing.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LedgerSignSheet(store: WalletStore) {
    val signer = LedgerSigner.shared ?: return
    val stage = signer.stage
    if (stage == LedgerSignStage.Idle) return
    val skin = LocalSkin.current
    val permissions =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            signer.bluetoothChanged()
        }
    LaunchedEffect(stage == LedgerSignStage.Bluetooth(LedgerBluetooth.UNAUTHORIZED)) {
        if (stage ==
            LedgerSignStage.Bluetooth(LedgerBluetooth.UNAUTHORIZED)
        ) {
            permissions.launch(ledgerBluetoothPermissions())
        }
    }
    ModalBottomSheet(
        onDismissRequest = signer::cancel,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = RoundedCornerShape(topStart = BrambleRadius.xl, topEnd = BrambleRadius.xl),
        containerColor = skin.panel,
        contentColor = skin.text,
        properties = ModalBottomSheetProperties(securePolicy = SecureFlagPolicy.Inherit),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(start = BrambleSpace.xl, end = BrambleSpace.xl, bottom = BrambleSpace.xl),
            verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        ) {
            Text(
                LedgerSignCopy.title(stage),
                style = textStyle(BrambleTypeScale.title, BrambleWeight.semibold),
                modifier = Modifier.semantics { heading() },
            )
            SignContent(store, signer, stage)
            if (stage is LedgerSignStage.Refused) {
                PillButton(LedgerSignCopy.TRY_AGAIN, kind = PillKind.SECONDARY) { signer.retry() }
            }
            PillButton(LedgerSignCopy.CANCEL, kind = PillKind.SECONDARY) { signer.cancel() }
        }
    }
}

@Composable
private fun SignContent(
    store: WalletStore,
    signer: LedgerSigner,
    stage: LedgerSignStage,
) {
    when (stage) {
        LedgerSignStage.Idle -> {}

        is LedgerSignStage.Bluetooth -> {
            LedgerBluetoothNotice(stage.state)
        }

        LedgerSignStage.Scanning -> {
            StatusLine(LedgerCopy.LEDE)
            LedgerDeviceList(signer.devices, signer::choose)
        }

        is LedgerSignStage.Connecting -> {
            StatusLine("Connecting to ${stage.device.name}…")
            StatusLine("If asked, confirm the pairing code on both devices.")
        }

        LedgerSignStage.Checking -> {
            StatusLine(LedgerSignCopy.VERIFYING_BODY)
        }

        is LedgerSignStage.Confirming -> {
            StatusLine(LedgerSignCopy.CONFIRMING_BODY)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Eyebrow(LedgerSignCopy.HASH_LABEL, Modifier.weight(1f))
                CopyButton(store, stage.hash, LedgerSignCopy.COPY_HASH)
            }
            SelectionContainer {
                Text(LedgerSignCopy.grouped(stage.hash), style = textStyle(BrambleTypeScale.mono, mono = true))
            }
            StatusLine(LedgerSignCopy.HASH_HELP)
        }

        is LedgerSignStage.Refused -> {
            StatusLine(stage.message, StatusTone.DANGER)
            StatusLine(LedgerSignCopy.NOT_SIGNED)
        }
    }
}

/** What Bluetooth's [state] needs, with the control that fixes it; shared by connect and sign. */
@Composable
fun LedgerBluetoothNotice(state: LedgerBluetooth) {
    val context = LocalContext.current
    val tone = if (state == LedgerBluetooth.UNKNOWN) StatusTone.MUTED else StatusTone.DANGER
    StatusLine(LedgerCopy.bluetooth(state), tone)
    when (state) {
        LedgerBluetooth.UNAUTHORIZED -> {
            PillButton("Open Settings", kind = PillKind.SECONDARY) { openAppSettings(context) }
        }

        LedgerBluetooth.OFF -> {
            PillButton("Turn on Bluetooth", kind = PillKind.SECONDARY) { askToTurnOnBluetooth(context) }
        }

        LedgerBluetooth.LOCATION_OFF -> {
            PillButton("Open Settings", kind = PillKind.SECONDARY) {
                context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            }
        }

        else -> {}
    }
}

/** "Ledgers nearby": each Ledger found, or "Searching…"; shared by connect and sign. */
@Composable
fun LedgerDeviceList(
    devices: List<LedgerDevice>,
    choose: (LedgerDevice) -> Unit,
) {
    Eyebrow("Ledgers nearby")
    if (devices.isEmpty()) {
        StatusLine("Searching…")
    } else {
        MenuGroup {
            devices.forEach { device -> MenuRow(BrambleIconName.SHIELD, device.name) { choose(device) } }
        }
    }
}
