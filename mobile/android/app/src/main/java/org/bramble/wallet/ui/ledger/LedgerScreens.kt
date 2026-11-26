package org.bramble.wallet.ui.ledger

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import org.bramble.core.AccountFamily
import org.bramble.core.LedgerAccountRequest
import org.bramble.core.LedgerCandidate
import org.bramble.core.LedgerKeyReader
import org.bramble.core.LedgerScheme
import org.bramble.core.NetworkId
import org.bramble.core.accountLabel
import org.bramble.core.ledgerAccountCandidates
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.CheckRow
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ledger.LedgerBleDriver
import org.bramble.wallet.ledger.LedgerBleScanner
import org.bramble.wallet.ledger.LedgerBluetooth
import org.bramble.wallet.ledger.LedgerConnectModel
import org.bramble.wallet.ledger.LedgerGattLink
import org.bramble.wallet.ledger.LedgerLinkException
import org.bramble.wallet.ledger.LedgerStage
import org.bramble.wallet.ledger.ledgerBluetoothPermissions

/**
 * The live model for a screen: Android Bluetooth, a new link and driver per connection, and
 * Bramble (OpenZeppelin) accounts placed on [network]. Asks for the Bluetooth permissions once,
 * when first shown without them, and ends the connection and scan when the screen leaves.
 */
@Composable
fun rememberLedgerModel(
    network: NetworkId,
    existing: Set<String>,
): LedgerConnectModel {
    val context = LocalContext.current
    val scanner = remember { LedgerBleScanner(context) }
    val model = remember { liveModel(context, scanner, network, existing) }
    val permissions =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            model.bluetoothChanged()
        }
    LaunchedEffect(Unit) {
        if (model.stage == LedgerStage.Bluetooth(LedgerBluetooth.UNAUTHORIZED)) {
            permissions.launch(ledgerBluetoothPermissions())
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            model.close()
            scanner.release()
        }
    }
    return model
}

private fun liveModel(
    context: Context,
    scanner: LedgerBleScanner,
    network: NetworkId,
    existing: Set<String>,
) = LedgerConnectModel(
    scanner = scanner,
    connect = { ledger ->
        val device = scanner.device(ledger) ?: throw LedgerLinkException.Failed()
        val link = LedgerGattLink(context, device)
        link.connect()
        LedgerBleDriver(link)
    },
    reader = { start, count -> LedgerKeyReader(LedgerScheme.BRAMBLE, start, count) },
    place = { keys -> ledgerAccountCandidates(network, AccountFamily.OPEN_ZEPPELIN, keys) },
    existing = existing,
)

/** The stage's content: Bluetooth's state, the Ledgers found, progress, a failure, or the list. */
@Composable
fun ColumnScope.LedgerConnectContent(model: LedgerConnectModel) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    when (val stage = model.stage) {
        is LedgerStage.Bluetooth -> {
            val tone = if (stage.state == LedgerBluetooth.UNKNOWN) StatusTone.MUTED else StatusTone.DANGER
            StatusLine(LedgerCopy.bluetooth(stage.state), tone)
            if (stage.state == LedgerBluetooth.UNAUTHORIZED) {
                PillButton("Open Settings", kind = PillKind.SECONDARY) { openAppSettings(context) }
            }
        }

        LedgerStage.Scanning -> {
            Eyebrow("Ledgers nearby")
            if (model.devices.isEmpty()) {
                StatusLine("Searching…")
            } else {
                MenuGroup {
                    model.devices.forEach { device ->
                        MenuRow(BrambleIconName.SHIELD, device.name) { scope.launch { model.choose(device) } }
                    }
                }
            }
        }

        is LedgerStage.Connecting -> {
            StatusLine("Connecting to ${stage.device.name}…")
            StatusLine("If asked, confirm the pairing code on both devices.")
        }

        LedgerStage.Reading -> {
            StatusLine("Reading accounts…")
        }

        is LedgerStage.Failed -> {
            StatusLine(stage.message, StatusTone.DANGER)
            PillButton("Try again", kind = PillKind.SECONDARY) { model.retry() }
        }

        LedgerStage.Picking -> {
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
                model.candidates.forEach { CandidateRow(model, it) }
                PillButton("Show more", kind = PillKind.SECONDARY, busy = model.loadingMore) {
                    scope.launch { model.more() }
                }
            }
        }
    }
}

/** The confirm button while picking, enabled with a pick; nothing otherwise. */
@Composable
fun LedgerConnectAction(
    model: LedgerConnectModel,
    title: String,
    busy: Boolean = false,
    confirm: (List<LedgerAccountRequest>) -> Unit,
) {
    if (model.stage != LedgerStage.Picking) return
    PillButton(title, busy = busy, enabled = model.chosen.isNotEmpty() && !model.loadingMore) {
        confirm(model.chosen)
    }
}

/** `.select-row`: checkbox, "Account <index>", the 6…4 address; one already held is disabled. */
@Composable
private fun CandidateRow(
    model: LedgerConnectModel,
    candidate: LedgerCandidate,
) {
    val skin = LocalSkin.current
    val existing = model.isExisting(candidate)
    CheckRow(
        "Account ${candidate.request.accountIndex}",
        checked = candidate.address in model.selected,
        enabled = !existing,
        onCheckedChange = { model.toggle(candidate) },
    ) {
        val mono = textStyle(BrambleTypeScale.caption, mono = true)
        Text(accountLabel(candidate.address), color = skin.muted, style = mono)
        if (existing) {
            Text("Already in this wallet", color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        }
    }
}

private fun openAppSettings(context: Context) {
    val intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
}
