package se.swimbird.claudebuddy;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the custom BLE peripheral plugin before the bridge initializes.
        registerPlugin(BlePeripheralPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
