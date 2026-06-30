import { ApprovalPrompt } from './ApprovalPrompt';
import { ConnectButton } from './ConnectButton';
import type { BuddyView } from '../hooks/useBuddy';

/**
 * The bottom action area: an approval prompt when one is pending, otherwise (on
 * native, when no central is connected) a connect button; nothing otherwise.
 */
export function ActionZone({ view }: { view: BuddyView }) {
  const { prompt, native, live, everConnected, actions } = view;
  return (
    <div className="action">
      {prompt ? (
        <ApprovalPrompt prompt={prompt} onApprove={actions.approve} onDeny={actions.deny} />
      ) : native && !live ? (
        <ConnectButton everConnected={everConnected} onClick={actions.reconnect} />
      ) : null}
    </div>
  );
}
