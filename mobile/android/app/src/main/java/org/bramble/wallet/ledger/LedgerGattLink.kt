package org.bramble.wallet.ledger

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import org.bramble.core.ledgerBleLink
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * A Ledger's Bluetooth LE link over BluetoothGatt, as iOS `LedgerBleLink`: connect, bond,
 * discover, ask for a larger MTU, subscribe, then whole writes and notifications for
 * [LedgerBleDriver]. The GATT identifiers are the core's (`ledgerBleLink()`); this class never
 * reads or alters what it carries.
 *
 * GATT allows one operation in flight, so each operation waits for the previous one's callback.
 * Trust boundary: everything the device sends is untrusted bytes, handed on unparsed. Failure: a
 * disconnect, a failed operation, a timeout or [close] closes the gatt and ends the link; pending
 * and later calls throw [LedgerLinkException]. Needs `BLUETOOTH_CONNECT` granted on API 31+ (a
 * refusal is a failure). Untested on a device: the emulator has no Bluetooth.
 */
class LedgerGattLink(
    private val context: Context,
    private val device: BluetoothDevice,
) : LedgerLink {
    private val specs = ledgerBleLink().specs
    private val ops = Mutex()
    private val closed = AtomicBoolean(false)
    private val inbox = Channel<ByteArray>(INBOX_LIMIT)

    @Volatile private var pending: CompletableDeferred<Int>? = null

    @Volatile private var gatt: BluetoothGatt? = null
    private var writeChar: BluetoothGattCharacteristic? = null
    private var writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT

    override var maximumWriteLength: Int = DEFAULT_ATT_MTU - ATT_HEADER
        private set

    private val callback =
        object : BluetoothGattCallback() {
            override fun onConnectionStateChange(
                gatt: BluetoothGatt,
                status: Int,
                newState: Int,
            ) {
                if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                    settle(status)
                } else {
                    close()
                }
            }

            override fun onServicesDiscovered(
                gatt: BluetoothGatt,
                status: Int,
            ) = settle(status)

            override fun onMtuChanged(
                gatt: BluetoothGatt,
                mtu: Int,
                status: Int,
            ) = settle(status, mtu)

            override fun onDescriptorWrite(
                gatt: BluetoothGatt,
                descriptor: BluetoothGattDescriptor,
                status: Int,
            ) = settle(status)

            // Called for writes without response too, once the stack takes the frame: flow control.
            override fun onCharacteristicWrite(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                status: Int,
            ) = settle(status)

            override fun onCharacteristicChanged(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                value: ByteArray,
            ) = received(value.copyOf())

            @Deprecated("Before API 33 the platform calls this form, with the value on the characteristic")
            override fun onCharacteristicChanged(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
            ) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                    characteristic.value?.let { received(it.copyOf()) }
                }
            }
        }

    /**
     * Connects, bonds when the device is not bonded yet (the system shows the pairing prompt),
     * finds the Ledger service, asks for a larger MTU and subscribes, within [CONNECT_TIMEOUT_MS].
     * On any failure or cancellation the gatt is closed; failures throw [LedgerLinkException].
     */
    suspend fun connect() {
        var ready = false
        try {
            ready = withTimeoutOrNull(CONNECT_TIMEOUT_MS) { open() } != null
        } finally {
            if (!ready) close()
        }
        if (!ready) throw LedgerLinkException.Failed()
    }

    private suspend fun open() {
        gattOp { device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE).also { gatt = it } != null }
        if (device.bondState != BluetoothDevice.BOND_BONDED) bond()
        val gatt = gatt.orFail()
        gattOp { gatt.discoverServices() }
        val (service, spec) =
            specs
                .firstNotNullOfOrNull { spec -> gatt.getService(UUID.fromString(spec.service))?.let { it to spec } }
                .orFail()
        maximumWriteLength = gattOp { gatt.requestMtu(REQUESTED_MTU) } - ATT_HEADER
        val notify = service.find(spec.notify, BluetoothGattCharacteristic.PROPERTY_NOTIFY).orFail()
        val writeCmd = service.find(spec.writeCmd, BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)
        writeChar = writeCmd ?: service.find(spec.write, BluetoothGattCharacteristic.PROPERTY_WRITE).orFail()
        writeType =
            if (writeCmd != null) {
                BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            } else {
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            }
        subscribe(gatt, notify)
    }

    /** Turns notifications on locally, then on the device through its CCCD. */
    private suspend fun subscribe(
        gatt: BluetoothGatt,
        notify: BluetoothGattCharacteristic,
    ) {
        gatt.setCharacteristicNotification(notify, true).takeIf { it }.orFail()
        val cccd = notify.getDescriptor(CCCD).orFail()
        val enable = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        gattOp {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeDescriptor(cccd, enable) == BluetoothStatusCodes.SUCCESS
            } else {
                cccd.value = enable
                gatt.writeDescriptor(cccd)
            }
        }
    }

    /** Creates the bond and waits for it; a refused or cancelled pairing fails. */
    private suspend fun bond() {
        val bonded = CompletableDeferred<Boolean>()
        val receiver =
            object : BroadcastReceiver() {
                override fun onReceive(
                    context: Context,
                    intent: Intent,
                ) {
                    if (bondChangeDevice(intent)?.address != device.address) return
                    when (intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR)) {
                        BluetoothDevice.BOND_BONDED -> bonded.complete(true)
                        BluetoothDevice.BOND_NONE -> bonded.complete(false)
                    }
                }
            }
        val filter = IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }
        try {
            when (device.bondState) {
                BluetoothDevice.BOND_BONDED -> bonded.complete(true)
                BluetoothDevice.BOND_NONE -> if (!device.createBond()) bonded.complete(false)
            }
            bonded.await().takeIf { it }.orFail()
        } finally {
            context.unregisterReceiver(receiver)
        }
    }

    override suspend fun write(frame: ByteArray) {
        val gatt = gatt
        val char = writeChar
        if (closed.get() || gatt == null || char == null) throw LedgerLinkException.Disconnected()
        gattOp {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeCharacteristic(char, frame, writeType) == BluetoothStatusCodes.SUCCESS
            } else {
                char.writeType = writeType
                char.value = frame
                gatt.writeCharacteristic(char)
            }
        }
    }

    override suspend fun nextNotification(): ByteArray =
        inbox.receiveCatching().getOrNull() ?: throw LedgerLinkException.Disconnected()

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        inbox.close()
        pending?.completeExceptionally(LedgerLinkException.Disconnected())
        gatt?.let { open ->
            runCatching {
                open.disconnect()
                open.close()
            }
        }
        gatt = null
    }

    /**
     * Runs one GATT operation: waits for the previous one, starts this one, and returns its
     * callback's value. A refused start (including a missing permission) fails the link.
     */
    private suspend fun gattOp(start: () -> Boolean): Int =
        ops.withLock {
            if (closed.get()) throw LedgerLinkException.Disconnected()
            val done = CompletableDeferred<Int>()
            pending = done
            if (!runCatching(start).getOrDefault(false)) close()
            done.await().also { pending = null }
        }

    private fun settle(
        status: Int,
        value: Int = status,
    ) {
        val done = pending ?: return
        pending = null
        if (status == BluetoothGatt.GATT_SUCCESS) {
            done.complete(value)
        } else {
            done.completeExceptionally(LedgerLinkException.Failed())
            close()
        }
    }

    private fun received(value: ByteArray) {
        // More unread notifications than any reply needs ends the link.
        if (!closed.get() && inbox.trySend(value).isFailure) close()
    }

    /** GATT limits and timeouts. */
    companion object {
        /** Connecting includes the pairing prompt a first connection shows, so this is generous. */
        const val CONNECT_TIMEOUT_MS = 30_000L

        /** Bluetooth's largest ATT MTU; the device's answer decides. */
        private const val REQUESTED_MTU = 517
        private const val DEFAULT_ATT_MTU = 23
        private const val ATT_HEADER = 3

        /** More than any reply needs (64 KiB at 20 bytes a frame). */
        private const val INBOX_LIMIT = 4_096

        /** The Client Characteristic Configuration descriptor, written to turn notifications on. */
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }
}

/** A required GATT value; its absence fails the link. */
private fun <T> T?.orFail(): T = this ?: throw LedgerLinkException.Failed()

/** The service's characteristic [uuid] when it has [property]. */
private fun BluetoothGattService.find(
    uuid: String,
    property: Int,
): BluetoothGattCharacteristic? = getCharacteristic(UUID.fromString(uuid))?.takeIf { it.properties and property != 0 }

private fun bondChangeDevice(intent: Intent): BluetoothDevice? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
    } else {
        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
    }
