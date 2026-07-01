import type { GameStats } from '../lib/stats';
import type { Totals } from '../hooks/useBuddy';

const fmt = (n: number) => n.toLocaleString();

export function Counters({ stats, totals }: { stats: GameStats; totals: Totals }) {
  return (
    <div className="counters">
      <div className="ctr"><span className="k">approved</span><span className="v">{stats.approved}</span></div>
      <div className="ctr"><span className="k">napped</span><span className="v">{stats.napped}</span></div>
      <div className="ctr"><span className="k">denied</span><span className="v">{stats.denied}</span></div>
      <div className="ctr"><span className="k">tokens</span><span className="v">{fmt(totals.tokens)}</span></div>
      <div className="ctr"><span className="k">today</span><span className="v">{fmt(totals.tokensToday)}</span></div>
    </div>
  );
}
