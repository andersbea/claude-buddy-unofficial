import { Settings } from '../lib/icons';
import { level, type GameStats } from '../lib/stats';
import type { BuddyState } from '../lib/protocol';

export interface StatusStripProps {
  name: string;
  state: BuddyState;
  live: boolean;
  stats: GameStats;
  onOpenSettings: () => void;
}

export function StatusStrip({ name, state, live, stats, onOpenSettings }: StatusStripProps) {
  return (
    <header className="strip">
      <span className={`dot${live ? ' live' : ''}`} title="link status" />
      <span className="name">{name}</span>
      <span className="state" data-state={state}>{state}</span>
      <span className="level">Lv {level(stats)}</span>
      <button className="gear" aria-label="Settings" onClick={onOpenSettings}>
        <Settings size="1em" />
      </button>
    </header>
  );
}
