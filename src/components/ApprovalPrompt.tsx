import { Check, X } from '../lib/icons';
import type { Prompt } from '../lib/protocol';

export interface ApprovalPromptProps {
  prompt: Prompt;
  onApprove: () => void;
  onDeny: () => void;
}

export function ApprovalPrompt({ prompt, onApprove, onDeny }: ApprovalPromptProps) {
  return (
    <div className="approval">
      <div className="approval-head">Approval needed</div>
      <div className="approval-tool">
        <span>{prompt.tool ?? 'tool'}</span>
        <code>{prompt.hint ?? ''}</code>
      </div>
      <div className="hw">
        <button className="act act-ok" onClick={onApprove}>
          <Check size="1em" /> A · Approve
        </button>
        <button className="act act-deny" onClick={onDeny}>
          <X size="1em" /> B · Deny
        </button>
      </div>
    </div>
  );
}
