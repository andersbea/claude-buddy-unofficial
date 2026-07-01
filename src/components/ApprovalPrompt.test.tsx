import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalPrompt } from './ApprovalPrompt';

describe('ApprovalPrompt', () => {
  it('shows the tool + hint and fires the right callback per button', async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(
      <ApprovalPrompt
        prompt={{ id: 'req_1', tool: 'Bash', hint: 'rm -rf /tmp/x' }}
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('rm -rf /tmp/x')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDeny).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /deny/i }));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });
});
