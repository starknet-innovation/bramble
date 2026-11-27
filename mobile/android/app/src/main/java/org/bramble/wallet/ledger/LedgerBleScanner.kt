package org.bramble.wallet.ledger

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import org.bramble.core.ledgerBleLink
import java.util.UUID

/**
 * The runtime permissions scanning for and connecting to a Ledger needs: `BLUETOOTH_SCAN` and
 * `BLUETOOTH_CONNECT` from API 31, fine location before (a scan finds nothing without it).
 */
fun ledgerBluetoothPermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

/**
 * Finds Ledgers over [android.bluetooth.le.BluetoothLeScanner]: advertisers of the services
 * `ledgerBleLink()` names, plus bonded Ledgers, as iOS `LedgerBleScanner`. Watches the adapter's
 * state, and Location services (needed for a scan before Android 12), until [release].
 *
 * Trust boundary: a name is whatever the device advertises and is only shown. A refused
 * permission is [LedgerBluetooth.UNAUTHORIZED]; the screen asks for it at the point of use and
 * calls [LedgerConnectModel.bluetoothChanged] after. Untested on a device: the emulator has no
 * Bluetooth. Main-thread only; scan results arrive on the main thread.
 */
class LedgerBleScanner(
    private val context: Context,
) : LedgerScanning {
    private val adapter: BluetoothAdapter? = context.getSystemService(BluetoothManager::class.java)?.adapter
    private val filters =
        ledgerBleLink().specs.map { spec ->
            ScanFilter.Builder().setServiceUuid(ParcelUuid(UUID.fromString(spec.service))).build()
        }
    private var scanning = false

    override var devices: List<LedgerDevice> = emptyList()
        private set

    override var changed: (() -> Unit)? = null

    private val stateReceiver =
        object : BroadcastReceiver() {
            override fun onReceive(
                context: Context,
                intent: Intent,
            ) {
                if (bluetooth != LedgerBluetooth.READY) {
                    scanning = false
                    devices = emptyList()
                }
                changed?.invoke()
            }
        }

    private val callback =
        object : ScanCallback() {
            override fun onScanResult(
                callbackType: Int,
                result: ScanResult,
            ) = found(result)

            override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach(::found)

            override fun onScanFailed(errorCode: Int) {
                scanning = false
            }
        }

    init {
        ContextCompat.registerReceiver(
            context,
            stateReceiver,
            IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED).apply {
                addAction(LocationManager.PROVIDERS_CHANGED_ACTION)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    override val bluetooth: LedgerBluetooth
        get() =
            when {
                adapter == null || !context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) -> {
                    LedgerBluetooth.UNSUPPORTED
                }

                !granted() -> {
                    LedgerBluetooth.UNAUTHORIZED
                }

                !adapter.isEnabled -> {
                    LedgerBluetooth.OFF
                }

                Build.VERSION.SDK_INT < Build.VERSION_CODES.S && !locationOn() -> {
                    LedgerBluetooth.LOCATION_OFF
                }

                else -> {
                    LedgerBluetooth.READY
                }
            }

    override fun startScan() {
        val scanner = adapter?.bluetoothLeScanner
        if (scanning || bluetooth != LedgerBluetooth.READY || scanner == null) return
        bonded().forEach { found(it.address, it.name) }
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        scanning =
            try {
                scanner.startScan(filters, settings, callback)
                true
            } catch (ignored: SecurityException) {
                false
            }
    }

    override fun stopScan() {
        if (!scanning) return
        scanning = false
        try {
            adapter?.bluetoothLeScanner?.stopScan(callback)
        } catch (ignored: SecurityException) {
            // The permission went away; the scan ended with it.
        }
    }

    /** The device behind [ledger], for [LedgerGattLink]. */
    fun device(ledger: LedgerDevice): BluetoothDevice? = adapter?.getRemoteDevice(ledger.id)

    /** Stops the scan and stops watching the adapter; the screen has gone. */
    fun release() {
        stopScan()
        changed = null
        runCatching { context.unregisterReceiver(stateReceiver) }
    }

    private fun granted(): Boolean =
        ledgerBluetoothPermissions().all {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }

    private fun found(result: ScanResult) = found(result.device.address, result.scanRecord?.deviceName)

    private fun found(
        id: String,
        name: String?,
    ) {
        if (devices.any { it.id == id }) return
        devices = devices + LedgerDevice(id, name ?: "Ledger")
        changed?.invoke()
    }

    /**
     * Ledgers bonded to the phone, which a scan can miss while they are connected elsewhere: a
     * bonded LE device whose cached services include a Ledger service, or, when the stack cached
     * none, whose name is a Ledger model's. ponytail: the name check is a heuristic for devices
     * with no cached services; a bonded non-Ledger named "Nano …" would be listed, and fail to connect.
     */
    private fun bonded(): List<BluetoothDevice> {
        val services = filters.mapNotNull { it.serviceUuid }.toSet()
        return try {
            adapter?.bondedDevices.orEmpty().filter { device ->
                val cached = device.uuids?.toSet().orEmpty()
                device.type != BluetoothDevice.DEVICE_TYPE_CLASSIC &&
                    if (cached.isEmpty()) {
                        LEDGER_NAMES.any { device.name.orEmpty().startsWith(it) }
                    } else {
                        cached.any {
                            it in
                                services
                        }
                    }
            }
        } catch (ignored: SecurityException) {
            emptyList()
        }
    }

    private fun locationOn(): Boolean =
        context.getSystemService(LocationManager::class.java)?.let { LocationManagerCompat.isLocationEnabled(it) }
            ?: false

    private companion object {
        /** The names Ledger models advertise ("Nano X 1A2B", "Ledger Stax 1A2B", ...). */
        val LEDGER_NAMES = listOf("Nano ", "Ledger ")
    }
}
