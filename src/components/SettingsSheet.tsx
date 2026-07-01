import { SPECIES, SPECIES_KEYS, type SpeciesKey } from '../lib/buddy';
import type { BuddyView } from '../hooks/useBuddy';
import type { Theme } from '../hooks/useTheme';

export interface SettingsSheetProps {
  view: BuddyView;
  theme: Theme;
  onToggleTheme: () => void;
  onClose: () => void;
}

/** Dev controls + transcript, kept off the main view in a bottom sheet. */
export function SettingsSheet({ view, theme, onToggleTheme, onClose }: SettingsSheetProps) {
  const { actions, mode } = view;
  const statusClass = mode === 'connected' ? ' ok' : mode === 'error' ? ' err' : '';

  return (
    <div className="sheet" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-panel">
        <div className="sheet-head">
          <h2>Settings</h2>
          <button className="sheet-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <h3>Theme</h3>
        <button className="btn" onClick={onToggleTheme}>Theme: {theme} — tap to switch</button>

        {view.native ? (
          <section>
            <h3>Buddy device</h3>
            <p className="muted">
              This phone advertises as a Bluetooth buddy. Connect to it from Claude Desktop;
              the A / B buttons send approvals back.
            </p>
            <button className="btn primary" onClick={actions.toggleAdvertise}>
              {mode === 'idle' || mode === 'error' ? 'Start advertising' : 'Stop advertising'}
            </button>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={actions.disconnect}>Disconnect</button>
              <button className="btn" onClick={actions.forget}>Forget pairing</button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Stuck? <b>Forget pairing</b> clears the bond with paired computers (the Mac) so
              you can re-pair fresh — also Forget it in Claude Desktop.
            </p>
            <div className={`status${statusClass}`}>{view.peripheralStatus}</div>
          </section>
        ) : (
          <section>
            <h3>Claude feed</h3>
            <p className="muted">
              Streams heartbeat snapshots, turns, and approval prompts using the real wire
              protocol. Simulated here because a web page can't be a BLE peripheral.
            </p>
            <div className="row">
              <button className="btn primary" onClick={actions.startFeed}>
                {view.simRunning ? 'Stop Claude feed' : 'Start Claude feed'}
              </button>
              <button className="btn" onClick={actions.triggerPrompt}>Force prompt</button>
            </div>
          </section>
        )}

        <h3>Identity</h3>
        <div className="field">
          <label htmlFor="buddy-name">Buddy name</label>
          <input id="buddy-name" type="text" value={view.name}
            onChange={(e) => actions.setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="buddy-species">Pet</label>
          <select id="buddy-species" value={view.species}
            onChange={(e) => actions.setSpecies(e.target.value as SpeciesKey)}>
            {SPECIES_KEYS.map((k) => <option key={k} value={k}>{SPECIES[k].label}</option>)}
          </select>
        </div>

        <h3>Session</h3>
        <div className="sess">
          <span>sessions <b>{view.totals.total}</b></span>
          <span>running <b>{view.totals.running}</b></span>
          <span>waiting <b>{view.totals.waiting}</b></span>
        </div>

        <h3>Transcript</h3>
        <ul className="messages">
          {view.messages.map((m, i) => (
            <li key={i} className={`msg ${m.who}`}>
              <span className="who">{m.who === 'you' ? 'you' : 'claude'}</span>
              <span className="text">{m.text}</span>
            </li>
          ))}
        </ul>

        <h3>Wire log</h3>
        <ul className="log">
          {view.logs.map((l, i) => <li key={i} className={`log-${l.level}`}>{l.text}</li>)}
        </ul>
      </div>
    </div>
  );
}
