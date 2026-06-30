package se.swimbird.claudebuddy;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;
import java.util.UUID;

/**
 * BlePeripheral — exposes this phone as a Bluetooth LE peripheral that advertises
 * the Nordic UART Service (NUS), so a BLE central (Claude Desktop, or the web app
 * running on another machine) can connect to it as if it were a real ESP32 buddy.
 *
 * Role mapping (matches web/js/protocol.js):
 *   - RX characteristic (6e400002): central WRITES here  → we forward bytes to JS ("rx" event)
 *   - TX characteristic (6e400003): we NOTIFY here        → JS calls notify() to send upstream
 *
 * Everything on the wire is newline-delimited UTF-8 JSON; framing/parsing lives in
 * JS (Protocol.LineParser), so this layer is a dumb, byte-faithful pipe.
 */
@CapacitorPlugin(
    name = "BlePeripheral",
    permissions = {
        @Permission(
            alias = "ble",
            strings = { Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT }
        )
    }
)
public class BlePeripheralPlugin extends Plugin {

    private static final String TAG = "BuddyBLE";

    private static final UUID SERVICE_UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID RX_UUID      = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID TX_UUID      = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
    // Client Characteristic Configuration Descriptor — central writes here to enable notifications.
    private static final UUID CCCD_UUID    = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private BluetoothManager bluetoothManager;
    private BluetoothAdapter adapter;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothGattServer gattServer;
    private BluetoothGattCharacteristic txChar;

    // Connected centrals. The buddy presents to one logical central, but a host
    // (e.g. macOS) can briefly open more than one GATT link; we keep the UI
    // "connected" while ANY remain, and only reset when the last one drops.
    private final java.util.HashMap<String, BluetoothDevice> centrals = new java.util.HashMap<>();
    // The device we currently target for TX notifications.
    private BluetoothDevice central;
    private boolean notificationsEnabled = false;
    private int mtu = 23; // default ATT MTU until negotiated

    // Outgoing notification queue, paced by onNotificationSent so chunks aren't dropped.
    private final Deque<byte[]> outgoing = new ArrayDeque<>();
    private boolean sending = false;

    private AdvertiseCallback advertiseCallback;
    // True between startAdvertising() and stopAdvertising(); drives re-advertising
    // after a central disconnects (Android halts advertising once connected).
    private boolean advertisingDesired = false;

    // ---- lifecycle / permissions ----

    @PluginMethod
    public void initialize(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("ble") != PermissionState.GRANTED) {
                requestPermissionForAlias("ble", call, "blePermsCallback");
                return;
            }
        }
        finishInitialize(call);
    }

    @PermissionCallback
    private void blePermsCallback(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && getPermissionState("ble") != PermissionState.GRANTED) {
            call.reject("Bluetooth permissions were denied");
            return;
        }
        finishInitialize(call);
    }

    private void finishInitialize(PluginCall call) {
        Context ctx = getContext();
        bluetoothManager = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = bluetoothManager != null ? bluetoothManager.getAdapter() : null;

        JSObject ret = new JSObject();
        if (adapter == null) {
            ret.put("supported", false);
            ret.put("enabled", false);
            call.resolve(ret);
            return;
        }
        ret.put("supported", adapter.isMultipleAdvertisementSupported());
        ret.put("enabled", adapter.isEnabled());
        call.resolve(ret);
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        Context ctx = getContext();
        BluetoothManager mgr = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter a = mgr != null ? mgr.getAdapter() : null;
        JSObject ret = new JSObject();
        boolean ok = a != null && a.isMultipleAdvertisementSupported();
        ret.put("supported", ok);
        ret.put("enabled", a != null && a.isEnabled());
        call.resolve(ret);
    }

    // ---- advertising + GATT server ----

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startAdvertising(final PluginCall call) {
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth is off or unavailable. Call initialize() and enable Bluetooth.");
            return;
        }

        String name = call.getString("name", null);
        if (name != null && name.length() > 0) {
            try { adapter.setName(name); } catch (SecurityException ignored) {}
        }

        try {
            openGattServer();
        } catch (SecurityException e) {
            call.reject("Missing BLUETOOTH_CONNECT permission");
            return;
        }

        advertiser = adapter.getBluetoothLeAdvertiser();
        if (advertiser == null) {
            call.reject("BLE advertising not supported on this device");
            return;
        }

        advertisingDesired = true;
        beginAdvertising(call);
    }

    /**
     * (Re)start the BLE advertisement. Called on startAdvertising() with a
     * PluginCall to resolve, and again with null on disconnect — Android stops a
     * connectable advertisement once a central connects, so we must resume it
     * when that central drops, or the buddy becomes undiscoverable.
     */
    @SuppressLint("MissingPermission")
    private void beginAdvertising(final PluginCall call) {
        if (advertiser == null || !advertisingDesired) return;

        // Clear any previous advertise instance so we don't hit ALREADY_STARTED.
        if (advertiseCallback != null) {
            try { advertiser.stopAdvertising(advertiseCallback); } catch (Exception ignored) {}
        }

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0)
            .build();

        // Primary packet: the DEVICE NAME, so the desktop picker (which filters to
        // names starting with "Claude") sees it without relying on the scan response
        // or a cached name. The 128-bit NUS UUID won't fit alongside it in 31 bytes,
        // so it goes in the scan response (read during active scanning).
        AdvertiseData data = new AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .build();

        // Scan response: the NUS service UUID (there's room for the 128-bit UUID here).
        AdvertiseData scanResponse = new AdvertiseData.Builder()
            .addServiceUuid(new ParcelUuid(SERVICE_UUID))
            .build();

        advertiseCallback = new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                Log.i(TAG, "advertising started OK as name='" + adapter.getName() + "'");
                if (call != null) {
                    JSObject ret = new JSObject();
                    ret.put("advertising", true);
                    call.resolve(ret);
                }
            }

            @Override
            public void onStartFailure(int errorCode) {
                Log.e(TAG, "advertising FAILED, code=" + errorCode);
                if (call != null) call.reject("Advertising failed to start (code " + errorCode + ")");
            }
        };

        try {
            advertiser.startAdvertising(settings, data, scanResponse, advertiseCallback);
        } catch (SecurityException e) {
            if (call != null) call.reject("Missing BLUETOOTH_ADVERTISE permission");
        }
    }

    /**
     * Recover a stuck link: drop any current central connections so the host
     * reconnects and re-subscribes cleanly, then make sure we're advertising.
     * The GATT server is left intact so cached attribute handles stay valid.
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    public void reconnect(PluginCall call) {
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth is off or unavailable.");
            return;
        }
        try { openGattServer(); } catch (SecurityException e) { call.reject("Missing BLUETOOTH_CONNECT permission"); return; }
        if (advertiser == null) advertiser = adapter.getBluetoothLeAdvertiser();

        java.util.List<BluetoothDevice> devs;
        synchronized (centrals) { devs = new java.util.ArrayList<>(centrals.values()); }
        for (BluetoothDevice d : devs) {
            Log.i(TAG, "reconnect: dropping stale link " + d.getAddress());
            try { gattServer.cancelConnection(d); } catch (Exception ignored) {}
        }
        central = null;
        notificationsEnabled = false;
        mtu = 23;
        synchronized (centrals) { centrals.clear(); }
        synchronized (outgoing) { outgoing.clear(); sending = false; }

        advertisingDesired = true;
        beginAdvertising(null);
        JSObject ret = new JSObject();
        ret.put("advertising", true);
        call.resolve(ret);
    }

    /** The subscribed central went away (unsubscribed or link dropped). Reset and
     *  resume advertising so Claude can find the buddy again. */
    private void onActiveCentralLost(String addr) {
        central = null;
        notificationsEnabled = false;
        mtu = 23;
        synchronized (outgoing) { outgoing.clear(); sending = false; }
        JSObject ev = new JSObject();
        ev.put("deviceId", addr);
        notifyListeners("disconnected", ev);
        new Handler(Looper.getMainLooper()).post(() -> beginAdvertising(null));
    }

    /** Pause the advertisement (e.g. once a central subscribes) without giving up
     *  the intent to advertise, so beginAdvertising() can resume it later. */
    @SuppressLint("MissingPermission")
    private void pauseAdvertising() {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (advertiser != null && advertiseCallback != null) {
                try { advertiser.stopAdvertising(advertiseCallback); } catch (Exception ignored) {}
            }
        });
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void stopAdvertising(PluginCall call) {
        advertisingDesired = false;
        try {
            if (advertiser != null && advertiseCallback != null) {
                advertiser.stopAdvertising(advertiseCallback);
            }
        } catch (SecurityException ignored) {}
        advertiseCallback = null;

        try {
            if (gattServer != null) {
                gattServer.close();
            }
        } catch (SecurityException ignored) {}
        gattServer = null;
        txChar = null;
        central = null;
        synchronized (centrals) { centrals.clear(); }
        notificationsEnabled = false;
        synchronized (outgoing) { outgoing.clear(); sending = false; }

        call.resolve();
    }

    /** Drop the OS bond with the current/last central so a subsequent pairing is
     *  fresh. Called when the desktop sends {"cmd":"unpair"} (user clicked Forget).
     *  removeBond() is a hidden API, so this is best-effort via reflection. */
    @PluginMethod
    public void unpair(PluginCall call) {
        try {
            BluetoothDevice dev = central;
            if (dev == null) {
                synchronized (centrals) {
                    if (!centrals.isEmpty()) dev = centrals.values().iterator().next();
                }
            }
            if (dev != null) {
                dev.getClass().getMethod("removeBond").invoke(dev);
                Log.i(TAG, "removeBond invoked for " + dev.getAddress());
            }
        } catch (Exception e) {
            Log.w(TAG, "removeBond unavailable: " + e.getMessage());
        }
        call.resolve();
    }

    /** Drop all current GATT links (the active central + any extras like the OS
     *  ghost or earbuds). Lets the user kick a stuck connection from the phone. */
    @SuppressLint("MissingPermission")
    @PluginMethod
    public void disconnectCentral(PluginCall call) {
        int n = 0;
        java.util.List<BluetoothDevice> devs;
        synchronized (centrals) { devs = new java.util.ArrayList<>(centrals.values()); }
        for (BluetoothDevice d : devs) {
            try { if (gattServer != null) { gattServer.cancelConnection(d); n++; } } catch (Exception ignored) {}
        }
        central = null;
        notificationsEnabled = false;
        synchronized (centrals) { centrals.clear(); }
        synchronized (outgoing) { outgoing.clear(); sending = false; }
        Log.i(TAG, "disconnectCentral dropped " + n + " link(s)");
        JSObject r = new JSObject(); r.put("disconnected", n); call.resolve(r);
    }

    /** Forget the OS bond with paired *computers* (i.e. the Mac running Claude
     *  Desktop) so a stuck/stale bond can't block re-pairing. Audio devices,
     *  phones, watches etc. are left alone. removeBond() is a hidden API → reflection. */
    @SuppressLint("MissingPermission")
    @PluginMethod
    public void forgetClaude(PluginCall call) {
        int n = 0;
        try {
            java.util.Set<BluetoothDevice> bonded = adapter != null ? adapter.getBondedDevices() : null;
            if (bonded != null) {
                for (BluetoothDevice d : bonded) {
                    BluetoothClass cls = d.getBluetoothClass();
                    int major = cls != null ? cls.getMajorDeviceClass() : -1;
                    if (major == BluetoothClass.Device.Major.COMPUTER) {
                        try {
                            d.getClass().getMethod("removeBond").invoke(d);
                            n++;
                            Log.i(TAG, "forgot bond with computer " + d.getAddress());
                        } catch (Exception e) { Log.w(TAG, "removeBond failed: " + e.getMessage()); }
                    }
                }
            }
        } catch (Exception e) { Log.w(TAG, "forgetClaude: " + e.getMessage()); }
        JSObject r = new JSObject(); r.put("forgot", n); call.resolve(r);
    }

    @SuppressLint("MissingPermission")
    private void openGattServer() {
        // Keep a single, stable GATT server for the app's lifetime. Re-opening it
        // shifts attribute handles, which breaks a central's cached handles and
        // stops it from re-subscribing — so open exactly once.
        if (gattServer != null) return;
        gattServer = bluetoothManager.openGattServer(getContext(), gattServerCallback);

        BluetoothGattService service =
            new BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY);

        // UNENCRYPTED / no-bond on purpose. Bonding makes macOS cache our GATT and
        // skip re-discovery/re-subscribe on reconnect — fine for an always-on ESP32,
        // but fatal for a phone app whose GATT server is recreated on every restart
        // (the cached subscription becomes stale → "No response", and Android can't
        // send a Service-Changed indication to fix it). Without a bond, each connect
        // is a fresh discovery + subscribe, so restarting the app works reliably.
        BluetoothGattCharacteristic rxChar = new BluetoothGattCharacteristic(
            RX_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE
                | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        );

        txChar = new BluetoothGattCharacteristic(
            TX_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        );
        BluetoothGattDescriptor cccd = new BluetoothGattDescriptor(
            CCCD_UUID,
            BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE
        );
        txChar.addDescriptor(cccd);

        service.addCharacteristic(rxChar);
        service.addCharacteristic(txChar);
        gattServer.addService(service);
    }

    // ---- sending: JS -> central via TX notify ----

    @PluginMethod
    public void notify(PluginCall call) {
        String b64 = call.getString("value");
        if (b64 == null) {
            call.reject("value (base64) is required");
            return;
        }
        if (gattServer == null || txChar == null || central == null || !notificationsEnabled) {
            Log.w(TAG, "notify REJECTED — gatt=" + (gattServer != null) + " tx=" + (txChar != null)
                + " central=" + (central != null) + " notif=" + notificationsEnabled);
            call.reject("no subscribed central");
            return;
        }
        byte[] bytes = Base64.decode(b64, Base64.NO_WRAP);
        Log.i(TAG, "TX notify " + bytes.length + "B: " + new String(bytes).trim());

        // Chunk under the negotiated ATT MTU (3 bytes of ATT header overhead).
        int chunkSize = Math.max(20, mtu - 3);
        synchronized (outgoing) {
            for (int i = 0; i < bytes.length; i += chunkSize) {
                outgoing.add(Arrays.copyOfRange(bytes, i, Math.min(i + chunkSize, bytes.length)));
            }
        }
        pump();
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    private void pump() {
        byte[] chunk;
        synchronized (outgoing) {
            if (sending || outgoing.isEmpty() || central == null) return;
            chunk = outgoing.peekFirst();
            sending = true;
        }
        try {
            boolean ok;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                int status = gattServer.notifyCharacteristicChanged(central, txChar, false, chunk);
                ok = status == BluetoothGatt.GATT_SUCCESS;
            } else {
                txChar.setValue(chunk);
                ok = gattServer.notifyCharacteristicChanged(central, txChar, false);
            }
            if (!ok) {
                Log.w(TAG, "notifyCharacteristicChanged FAILED (not queued) — will retry on next notify()");
                // Couldn't queue; release the latch so a later notify() can retry.
                synchronized (outgoing) { sending = false; }
            }
        } catch (SecurityException e) {
            Log.w(TAG, "notify SecurityException: " + e.getMessage());
            synchronized (outgoing) { sending = false; }
        }
    }

    // ---- GATT server callbacks ----

    private final BluetoothGattServerCallback gattServerCallback = new BluetoothGattServerCallback() {
        @SuppressLint("MissingPermission")
        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            Log.i(TAG, "onConnectionStateChange status=" + status + " newState=" + newState
                + " device=" + device.getAddress());
            if (newState == BluetoothGatt.STATE_CONNECTED) {
                // NOTE: don't filter by Bluetooth "class of device" here — macOS
                // connects via a resolvable private address whose class reads as
                // AUDIO, indistinguishable from earbuds. Contending links are
                // instead dropped when the REAL central subscribes (CCCD), below.
                int count;
                synchronized (centrals) {
                    centrals.put(device.getAddress(), device);
                    count = centrals.size();
                }
                // Don't signal "connected" yet. A host can open extra GATT links
                // that never subscribe (e.g. macOS keeps a passive connection),
                // so the REAL central is the one that subscribes to TX (CCCD).
                Log.i(TAG, "link up (" + count + " total) — awaiting TX subscription; bond="
                    + device.getBondState() + " (10=none,11=bonding,12=bonded)");
            } else if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                boolean wasActive;
                int count;
                synchronized (centrals) {
                    centrals.remove(device.getAddress());
                    count = centrals.size();
                    wasActive = central != null && central.getAddress().equals(device.getAddress());
                }
                Log.i(TAG, "link down (" + count + " remain)" + (wasActive ? " — was the active central" : " — extra link"));
                if (wasActive) onActiveCentralLost(device.getAddress());
            }
        }

        @Override
        public void onMtuChanged(BluetoothDevice device, int newMtu) {
            mtu = newMtu;
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onCharacteristicWriteRequest(BluetoothDevice device,
                int requestId, BluetoothGattCharacteristic characteristic,
                boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {

            if (RX_UUID.equals(characteristic.getUuid()) && value != null) {
                Log.i(TAG, "RX write " + value.length + "B: " + new String(value).trim());
                // Whoever writes to us IS our active central — make sure we can
                // notify back even if we never observed its CCCD write. A bonded
                // reconnect reuses a cached TX subscription and does NOT re-write
                // the descriptor on our (fresh) GATT server, which previously left
                // central=null/notif=false and got the desktop "No response".
                if (central == null || !central.getAddress().equals(device.getAddress())) {
                    central = device;
                    synchronized (centrals) { centrals.put(device.getAddress(), device); }
                    Log.i(TAG, "active central = " + device.getAddress() + " (via RX write)");
                }
                notificationsEnabled = true;
                JSObject ev = new JSObject();
                ev.put("value", Base64.encodeToString(value, Base64.NO_WRAP));
                notifyListeners("rx", ev);
            }
            if (responseNeeded) {
                try {
                    gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
                } catch (SecurityException ignored) {}
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onDescriptorWriteRequest(BluetoothDevice device, int requestId,
                BluetoothGattDescriptor descriptor, boolean preparedWrite,
                boolean responseNeeded, int offset, byte[] value) {

            if (CCCD_UUID.equals(descriptor.getUuid())) {
                boolean enable = value != null && value.length > 0
                    && (value[0] & 0x01) != 0; // ENABLE_NOTIFICATION_VALUE first byte
                if (enable) {
                    central = device;
                    notificationsEnabled = true;
                    Log.i(TAG, "CCCD ENABLED by " + device.getAddress() + " — this is the active central");
                    // Enforce a single central: drop any other links (e.g. the macOS
                    // OS-level ghost connection) so they don't contend with the real one.
                    java.util.List<BluetoothDevice> others;
                    synchronized (centrals) { others = new java.util.ArrayList<>(centrals.values()); }
                    for (BluetoothDevice d : others) {
                        if (!d.getAddress().equals(device.getAddress())) {
                            Log.i(TAG, "dropping contending link " + d.getAddress());
                            try { gattServer.cancelConnection(d); } catch (Exception ignored) {}
                            synchronized (centrals) { centrals.remove(d.getAddress()); }
                        }
                    }
                    JSObject ev = new JSObject();
                    ev.put("deviceId", device.getAddress());
                    notifyListeners("connected", ev);
                    pauseAdvertising(); // stop being discoverable while a central is subscribed
                } else {
                    Log.i(TAG, "CCCD disabled by " + device.getAddress());
                    if (central != null && central.getAddress().equals(device.getAddress())) {
                        onActiveCentralLost(device.getAddress());
                    }
                }
            }
            if (responseNeeded) {
                try {
                    gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
                } catch (SecurityException ignored) {}
            }
        }

        @Override
        public void onNotificationSent(BluetoothDevice device, int status) {
            synchronized (outgoing) {
                if (!outgoing.isEmpty()) outgoing.pollFirst();
                sending = false;
            }
            pump(); // send the next queued chunk, if any
        }
    };
}
