export type PipKind = 'heart' | 'dot' | 'bar';

export interface PipsProps {
  kind: PipKind;
  filled: number;
  total: number;
}

/**
 * A row of identical pips; the first `filled` are "on". The filled/empty look is
 * a CSS fill change (not a different glyph), so they always line up.
 */
export function Pips({ kind, filled, total }: PipsProps) {
  return (
    <span className={`pips ${kind}`} role="img" aria-label={`${filled} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < filled ? 'on' : 'off'} />
      ))}
    </span>
  );
}
