package org.bramble.wallet.ui.ledger

import android.bluetooth.BluetoothAdapter
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import org.bramble.core.AccountFamily
import org.bramble.core.LedgerAccountRequest
import org.bramble.core.LedgerKey
import org.bramble.core.LedgerKeyReader
import org.bramble.core.LedgerScheme
import org.bramble.core.NetworkInfo
import org.bramble.core.accountLabel
import org.bramble.core.ledgerAccountCandidates
import org.bramble.wallet.RpcClient
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.CheckRow
import org.bramble.wallet.design.Disclosure
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
import org.bramble.wallet.ledger.LedgerCore
import org.bramble.wallet.ledger.LedgerGattLink
import org.bramble.wallet.ledger.LedgerGroup
import org.bramble.wallet.ledger.LedgerLinkException
import org.bramble.wallet.ledger.LedgerRoute
import org.bramble.wallet.ledger.LedgerRow
import org.bramble.wallet.ledger.LedgerStage
import org.bramble.wallet.ledger.ledgerActivity
import org.bramble.wallet.ledger.ledgerBluetoothPermissions
import org.bramble.wallet.ledger.title

/**
 * The live model for [route]: Android Bluetooth, a new link and driver per connection, accounts
 * placed on the store's network, and each address checked through its RPC (deployed, and the
 * network's known tokens, as the extension's `readLedgerAccountState`). Asks once, when first
 * shown, for the Bluetooth permissions or for Bluetooth to be turned on, and ends the connection
 * and scan when the screen leaves.
 */
@Composable
fun rememberLedgerModel(
    store: WalletStore,
    route: LedgerRoute,
    existing: Set<String>,
): LedgerConnectModel {
    val context = LocalContext.current
    val scanner = remember { LedgerBleScanner(context) }
    val model = remember { liveModel(context, scanner, route, LiveLedgerCore(store.rpc, store.networkInfo), existing) }
    val permissions =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            model.bluetoothChanged()
        }
    LaunchedEffect(Unit) {
        when (model.stage) {
            LedgerStage.Bluetooth(LedgerBluetooth.UNAUTHORIZED) -> permissions.launch(ledgerBluetoothPermissions())
            LedgerStage.Bluetooth(LedgerBluetooth.OFF) -> askToTurnOnBluetooth(context)
            else -> Unit
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

/** The core and chain calls the live model makes. */
private class LiveLedgerCore(
    private val rpc: RpcClient,
    private val network: NetworkInfo,
) : LedgerCore {
    override fun reader(
        scheme: LedgerScheme,
        startIndex: UInt,
        count: UInt,
    ) = LedgerKeyReader(scheme, startIndex, count)

    override fun place(
        keys: List<LedgerKey>,
        family: AccountFamily,
    ) = ledgerAccountCandidates(network.network, family, keys)

    override suspend fun describe(address: String) = rpc.ledgerActivity(address, network)
}

private fun liveModel(
    context: Context,
    scanner: LedgerBleScanner,
    route: LedgerRoute,
    core: LedgerCore,
    existing: Set<String>,
) = LedgerConnectModel(
    route = route,
    scanner = scanner,
    connect = { ledger ->
        val device = scanner.device(ledger) ?: throw LedgerLinkException.Failed()
        val link = LedgerGattLink(context, device)
        link.connect()
        LedgerBleDriver(link)
    },
    core = core,
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
            when (stage.state) {
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
            LedgerAccountList(model)
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

/**
 * `ledgerAccountPicker`: the route's groups (Bramble and Argent or Ready accounts, each a
 * disclosure that opens once it has an active account), or Ready's one list, then "Show more".
 */
@Composable
private fun LedgerAccountList(model: LedgerConnectModel) {
    val scope = rememberCoroutineScope()
    var opened by remember { mutableStateOf(emptySet<String>()) }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        model.groups.forEach { group ->
            if (model.route == LedgerRoute.READY) {
                StatusLine(listOfNotNull(group.title, LedgerCopy.detected(group.detected)).joinToString(" · "))
                group.rows.forEach { LedgerRowView(model, it, group.namingPath) }
            } else {
                LedgerGroupView(model, group, group.title in opened) { open ->
                    opened = if (open) opened + group.title else opened - group.title
                }
            }
        }
        PillButton("Show more", kind = PillKind.SECONDARY, busy = model.loadingMore) {
            scope.launch { model.more() }
        }
    }
}

/** One group's disclosure; it opens itself once the group has an active account. */
@Composable
private fun LedgerGroupView(
    model: LedgerConnectModel,
    group: LedgerGroup,
    open: Boolean,
    setOpen: (Boolean) -> Unit,
) {
    LaunchedEffect(group.title, group.detected) {
        if (group.detected > 0) setOpen(true)
    }
    Disclosure(group.title, open = open, onToggle = { setOpen(!open) }, detail = LedgerCopy.detected(group.detected)) {
        group.rows.forEach { LedgerRowView(model, it, group.namingPath) }
    }
}

/** `.select-row`: checkbox, title, the 6…4 address and the row's status; dimmed when not pickable. */
@Composable
private fun LedgerRowView(
    model: LedgerConnectModel,
    row: LedgerRow,
    namingPath: Boolean,
) {
    val skin = LocalSkin.current
    CheckRow(
        row.title(namingPath),
        checked = row.selectable && row.id in model.selected,
        enabled = row.selectable,
        onCheckedChange = { model.toggle(row) },
    ) {
        val mono = textStyle(BrambleTypeScale.caption, mono = true)
        Text(accountLabel(row.candidate.address), color = skin.muted, style = mono)
        Text(row.status, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
    }
}

/** The system's prompt to turn Bluetooth on; the adapter's broadcast reports the answer. */
private fun askToTurnOnBluetooth(context: Context) {
    try {
        context.startActivity(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
    } catch (ignored: SecurityException) {
        // Without BLUETOOTH_CONNECT the state reads as unauthorized first.
    }
}

private fun openAppSettings(context: Context) {
    val intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
}
