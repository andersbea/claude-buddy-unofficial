import { Bluetooth } from '../lib/icons';

export function ConnectButton({ everConnected, onClick }: { everConnected: boolean; onClick: () => void }) {
  return (
    <div className="action-connect">
      <button className="act act-connect" onClick={onClick}>
        <Bluetooth size="1em" /> {everConnected ? 'Reconnect to Claude' : 'Connect to Claude'}
      </button>
    </div>
  );
}
