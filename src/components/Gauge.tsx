import { Pips, type PipKind } from './Pips';

export interface GaugeProps {
  label: string;
  kind: PipKind;
  filled: number;
  total: number;
}

export function Gauge({ label, kind, filled, total }: GaugeProps) {
  return (
    <div className="gauge">
      <span className="lbl">{label}</span>
      <Pips kind={kind} filled={filled} total={total} />
    </div>
  );
}
