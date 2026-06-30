import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Pips } from './Pips';

describe('Pips', () => {
  it('renders `total` pips with the first `filled` marked on', () => {
    const { container } = render(<Pips kind="dot" filled={2} total={5} />);
    expect(container.querySelectorAll('i')).toHaveLength(5);
    expect(container.querySelectorAll('i.on')).toHaveLength(2);
    expect(container.querySelectorAll('i.off')).toHaveLength(3);
  });

  it('applies the kind class for shape/colour', () => {
    const { container } = render(<Pips kind="heart" filled={4} total={4} />);
    const pips = container.querySelector('.pips');
    expect(pips?.classList.contains('heart')).toBe(true);
    expect(container.querySelectorAll('i.off')).toHaveLength(0);
  });
});
