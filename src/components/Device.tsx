import { useEffect, useState } from 'react';
import { StatusStrip } from './StatusStrip';
import { BuddyScreen } from './BuddyScreen';
import { Gauge } from './Gauge';
import { Counters } from './Counters';
import { Ticker } from './Ticker';
import { ActionZone } from './ActionZone';
import { SettingsSheet } from './SettingsSheet';
import { useTheme } from '../hooks/useTheme';
import { moodPips, fedPips, energyPips, MOOD_MAX, FED_MAX, ENERGY_MAX } from '../lib/stats';
import type { BuddyView } from '../hooks/useBuddy';

/** The whole device — the buddy is the entire UI; dev controls live in a sheet. */
export function Device({ view }: { view: BuddyView }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [buzzing, setBuzzing] = useState(false);
  const { theme, toggle } = useTheme();
  const approving = !!view.prompt;

  // light + shake when a prompt arrives (buzzKey changes)
  useEffect(() => {
    if (view.buzzKey === 0) return;
    setBuzzing(true);
    const id = setTimeout(() => setBuzzing(false), 400);
    return () => clearTimeout(id);
  }, [view.buzzKey]);

  return (
    <main className="room">
      <div className={`device${buzzing ? ' buzz' : ''}`}>
        <div className="bezel">
          <StatusStrip
            name={view.name}
            state={view.animState}
            live={view.live}
            stats={view.stats}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <BuddyScreen species={view.species} state={view.animState} />
          <div className="info">
            {/* during an approval the stats give way to the prompt (no scroll on small screens) */}
            {!approving && (
              <>
                <div className="gauges">
                  <Gauge label="mood" kind="heart" filled={moodPips(view.stats)} total={MOOD_MAX} />
                  <Gauge label="fed" kind="dot" filled={fedPips(view.stats)} total={FED_MAX} />
                  <Gauge label="energy" kind="bar" filled={energyPips(view.stats)} total={ENERGY_MAX} />
                </div>
                <Counters stats={view.stats} totals={view.totals} />
                <Ticker text={view.subtitle} />
              </>
            )}
            <ActionZone view={view} />
          </div>
        </div>
      </div>
      {settingsOpen && (
        <SettingsSheet view={view} theme={theme} onToggleTheme={toggle} onClose={() => setSettingsOpen(false)} />
      )}
    </main>
  );
}
