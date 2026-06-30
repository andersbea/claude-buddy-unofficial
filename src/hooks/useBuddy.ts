import { useEffect, useRef, useState } from 'react';
import {
  permission, ack, stateFromSnapshot,
  isTurn, isTimeSync, isCommand,
  type WireMessage, type Snapshot, type Prompt, type BuddyState, type Decision, type CommandMessage,
} from '../lib/protocol';
import {
  initialStats, onApproved, onDenied, onNapped, onStateEntered, tickEnergy,
  setSessionTokens, toStatusStats, type GameStats,
} from '../lib/stats';
import { type SpeciesKey } from '../lib/buddy';
import { ClaudeSimulator } from '../lib/simulator';
import { createPeripheralLink, isNative, type PeripheralLink, type LogLevel } from '../lib/ble/peripheral';

const NAME_KEY = 'buddyName';
const SLEEP_AFTER_MS = 90_000; // idle → sleep (firmware default)
const SILENCE_MS = 25_000;     // no data this long while connected → "quiet"
const BUDDY_NAMES = ['Mochi', 'Bufo', 'Pip', 'Gizmo', 'Tofu', 'Bean', 'Waffle',
  'Noodle', 'Pixel', 'Sprout', 'Biscuit', 'Yuzu', 'Momo', 'Clawd', 'Bonsai', 'Tater'];

export type ConnMode = 'idle' | 'advertising' | 'connected' | 'error';
export interface ChatMessage { who: 'you' | 'claude'; text: string }
export interface LogEntry { level: LogLevel; text: string }
export interface Totals { total: number; running: number; waiting: number; tokens: number; tokensToday: number }

export interface BuddyView {
  native: boolean;
  animState: BuddyState;
  stats: GameStats;
  prompt: Prompt | null;
  name: string;
  species: SpeciesKey;
  subtitle: string;
  live: boolean;
  mode: ConnMode;
  everConnected: boolean;
  peripheralStatus: string;
  simRunning: boolean;
  totals: Totals;
  messages: ChatMessage[];
  logs: LogEntry[];
  buzzKey: number;
  actions: {
    approve: () => void;
    deny: () => void;
    startFeed: () => void;
    triggerPrompt: () => void;
    connect: () => void;     // native: (re)start advertising
    reconnect: () => void;   // native: full restart of the peripheral
    toggleAdvertise: () => void;
    disconnect: () => void;
    forget: () => void;
    setName: (v: string) => void;
    setSpecies: (k: SpeciesKey) => void;
  };
}

export function useBuddy(): BuddyView {
  const native = isNative();

  // ---- render state ----
  const [animState, setAnimStateRaw] = useState<BuddyState>('idle');
  const [stats, setStatsRaw] = useState<GameStats>(initialStats);
  const [prompt, setPromptRaw] = useState<Prompt | null>(null);
  const [name, setNameRaw] = useState('Buddy');
  const [species, setSpecies] = useState<SpeciesKey>('bufo');
  const [subtitle, setSubtitle] = useState(native ? 'Looking for Claude…' : 'Start the Claude feed');
  const [mode, setModeRaw] = useState<ConnMode>('idle');
  const [peripheralStatus, setPeripheralStatus] = useState('idle');
  const [simRunning, setSimRunning] = useState(false);
  const [totals, setTotals] = useState<Totals>({ total: 0, running: 0, waiting: 0, tokens: 0, tokensToday: 0 });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [buzzKey, setBuzzKey] = useState(0);

  // ---- refs mirroring values read inside async callbacks ----
  const statsRef = useRef(stats);
  const promptRef = useRef(prompt);
  const animRef = useRef(animState);
  const nameRef = useRef(name);
  const modeRef = useRef(mode);
  const ownerRef = useRef('');
  const everRef = useRef(false);
  const periRef = useRef<PeripheralLink | null>(null);
  const simRef = useRef<ClaudeSimulator | null>(null);
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- ref-and-state setters (kept in sync so callbacks read fresh values) ----
  const updateStats = (fn: (s: GameStats) => GameStats) => {
    statsRef.current = fn(statsRef.current);
    setStatsRaw(statsRef.current);
  };
  const setPrompt = (p: Prompt | null) => { promptRef.current = p; setPromptRaw(p); };
  const setMode = (m: ConnMode) => { modeRef.current = m; setModeRaw(m); };
  const log = (level: LogLevel, text: string) => setLogs((l) => [{ level, text }, ...l].slice(0, 50));
  const addMessage = (who: ChatMessage['who'], text: string) =>
    setMessages((m) => [{ who, text }, ...m].slice(0, 30));

  const setBuddyName = (value: string, persist: boolean) => {
    const n = value || 'Buddy';
    nameRef.current = n;
    setNameRaw(n);
    if (persist) { try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ } }
  };

  // ---- buddy state + sleep ----
  function transitionTo(next: BuddyState) {
    if (next === animRef.current) return;
    animRef.current = next;
    setAnimStateRaw(next);
    if (next === 'sleep') updateStats(onNapped);
    else updateStats((s) => onStateEntered(s, next));
  }
  function resetSleep() {
    if (sleepTimer.current) clearTimeout(sleepTimer.current);
    sleepTimer.current = setTimeout(() => {
      if (animRef.current === 'idle') transitionTo('sleep');
    }, SLEEP_AFTER_MS);
  }
  function bump() {
    if (animRef.current === 'sleep') transitionTo('idle');
    resetSleep();
  }
  function buzz() {
    setBuzzKey((k) => k + 1);
    if (navigator.vibrate) { try { navigator.vibrate([40, 60, 40]); } catch { /* ignore */ } }
  }

  // ---- approvals ----
  function showApproval(p: Prompt) {
    const isNew = !promptRef.current || promptRef.current.id !== p.id;
    setPrompt(p);
    transitionTo('attention');
    if (isNew) buzz();
  }
  const hideApproval = () => setPrompt(null);

  function resolvePrompt(id: string, decision: Decision, source: 'screen' | 'device') {
    const toolName = promptRef.current?.tool ?? id;
    if (native) {
      periRef.current?.send(permission(id, decision)).catch((e) => log('warn', 'notify failed: ' + e.message));
    } else {
      simRef.current?.resolve(id, decision);
    }
    addMessage('you', `${decision === 'deny' ? 'Denied' : 'Approved'} ${toolName}${source === 'device' ? ' (from device)' : ''}`);
    updateStats(decision === 'deny' ? onDenied : onApproved);
    hideApproval();
  }

  // ---- snapshot / message handling ----
  function applySnapshot(snap: Snapshot) {
    setTotals((t) => ({
      total: snap.total ?? t.total,
      running: snap.running ?? t.running,
      waiting: snap.waiting ?? t.waiting,
      tokens: snap.tokens ?? t.tokens,
      tokensToday: snap.tokens_today ?? t.tokensToday,
    }));
    if (typeof snap.tokens === 'number') updateStats((s) => setSessionTokens(s, snap.tokens!));
    updateStats((s) => tickEnergy(s, snap.running ?? 0));
    if (snap.msg) setSubtitle(snap.msg);
    if (snap.prompt?.id) showApproval(snap.prompt);
    else hideApproval();
    transitionTo(stateFromSnapshot(snap, {
      justFinished: snap.running === 0 && snap.waiting === 0 && /done|complete|approved/i.test(snap.msg ?? ''),
    }));
  }

  function handleCommand(msg: CommandMessage) {
    const peri = periRef.current;
    if (!peri) return;
    const reply = (obj: unknown) => peri.send(obj).catch((e) => log('warn', 'ack failed: ' + e.message));
    switch (msg.cmd) {
      case 'status':
        reply(ack('status', {
          data: {
            name: nameRef.current || 'Claude Buddy',
            sec: false, // unencrypted/no-bond (see BlePeripheralPlugin)
            // bat/sys are placeholders so the desktop panel treats us as responding
            bat: { pct: 100, mV: 4100, mA: 0, usb: true },
            sys: { up: Math.round(performance.now() / 1000), heap: 100000 },
            stats: toStatusStats(statsRef.current),
          },
        }));
        break;
      case 'name':
        if (typeof msg.name === 'string') setBuddyName(msg.name, true);
        reply(ack('name'));
        break;
      case 'owner':
        if (typeof msg.name === 'string') ownerRef.current = msg.name;
        reply(ack('owner'));
        break;
      case 'unpair':
        peri.unpair().catch(() => {});
        reply(ack('unpair'));
        break;
      // folder push: we decline by not acking char_begin; ignore the rest
      case 'char_begin': case 'file': case 'chunk': case 'file_end': case 'char_end':
        log('info', '[central] ignoring folder-push cmd: ' + msg.cmd);
        break;
      default:
        log('info', '[central] unhandled cmd: ' + msg.cmd);
    }
  }

  function handleMessage(msg: WireMessage) {
    if (native) conn.noteData();
    if (isTimeSync(msg)) { log('info', 'time sync from Claude'); return; }
    if (native && isCommand(msg)) { handleCommand(msg); return; }
    if (isTurn(msg)) {
      const text = (msg.content ?? []).map((c) => c.text ?? '').join(' ').trim();
      if (text) addMessage('claude', text);
      bump();
      return;
    }
    const snap = msg as Snapshot;
    const active = (snap.running ?? 0) > 0 || (snap.waiting ?? 0) > 0 || !!snap.prompt?.id;
    applySnapshot(snap);
    if (active) bump();
  }

  // ---- native connection controller ----
  const conn = {
    markLive(why: string) {
      everRef.current = true;
      if (modeRef.current !== 'connected') {
        setMode('connected');
        log('ok', '[central] live (' + why + ')');
        setSubtitle('Connected to Claude');
        bump();
      }
      if (dataTimer.current) clearTimeout(dataTimer.current);
      dataTimer.current = setTimeout(() => {
        if (modeRef.current === 'connected') {
          setMode(periRef.current?.advertising() ? 'advertising' : 'idle');
          setSubtitle('Claude went quiet');
          transitionTo('sleep');
        }
      }, SILENCE_MS);
    },
    noteData() { conn.markLive('rx'); },
    onConnected(id: string) { conn.markLive('subscribed ' + id); },
    onDisconnected() {
      if (dataTimer.current) clearTimeout(dataTimer.current);
      setMode(periRef.current?.advertising() ? 'advertising' : 'idle');
      log('warn', '[central] disconnected');
      transitionTo('sleep'); // sleep == bridge not connected
      setSubtitle('Claude disconnected');
    },
  };

  async function advertise() {
    const peri = periRef.current;
    if (!peri) return;
    if (modeRef.current !== 'connected') setSubtitle('Looking for Claude…');
    try {
      const advName = await peri.start(nameRef.current || 'Claude Buddy');
      setMode('advertising');
      setPeripheralStatus(`advertising as "${advName}" — waiting for Claude`);
      log('ok', 'advertising as ' + advName);
    } catch (e) {
      const m = (e as Error).message;
      setMode('error'); setPeripheralStatus(m); setSubtitle(m); log('err', m);
    }
  }
  async function reconnect() {
    const peri = periRef.current;
    if (!peri) return;
    setSubtitle('Restarting Bluetooth…');
    try { await peri.stop(); } catch { /* ignore */ }
    await advertise();
  }
  async function stopAdvertising() {
    const peri = periRef.current;
    if (!peri) return;
    try { await peri.stop(); } catch { /* ignore */ }
    setMode('idle'); setPeripheralStatus('idle'); log('info', 'stopped advertising');
  }

  // ---- exposed actions ----
  const actions: BuddyView['actions'] = {
    approve: () => { if (promptRef.current) resolvePrompt(promptRef.current.id, 'once', 'screen'); },
    deny: () => { if (promptRef.current) resolvePrompt(promptRef.current.id, 'deny', 'screen'); },
    startFeed: () => {
      const sim = simRef.current;
      if (!sim) return;
      if (sim.running()) { sim.stop(); setSimRunning(false); setSubtitle('Feed stopped'); }
      else { sim.start(); setSimRunning(true); }
    },
    triggerPrompt: () => simRef.current?.triggerPrompt(),
    connect: () => { void advertise(); },
    reconnect: () => { void reconnect(); },
    toggleAdvertise: () => {
      if (modeRef.current === 'advertising' || modeRef.current === 'connected') void stopAdvertising();
      else void advertise();
    },
    disconnect: async () => {
      const peri = periRef.current;
      if (!peri) return;
      const r = await peri.disconnect();
      log('info', `disconnected ${r.disconnected} link(s)`);
      conn.onDisconnected();
    },
    forget: async () => {
      const peri = periRef.current;
      if (!peri) return;
      try { await peri.disconnect(); } catch { /* ignore */ }
      const r = await peri.forget();
      log('ok', `forgot bond with ${r.forgot} computer(s)`);
      setPeripheralStatus(r.forgot ? `forgot ${r.forgot} pairing(s) — re-pair from Claude` : 'no paired computer found');
      conn.onDisconnected();
    },
    setName: (v: string) => setBuddyName(v, true),
    setSpecies: (k: SpeciesKey) => setSpecies(k),
  };

  // ---- boot (once) ----
  useEffect(() => {
    // stable name: random on first run, persisted thereafter
    let stored: string | null = null;
    try { stored = localStorage.getItem(NAME_KEY); } catch { /* ignore */ }
    const isNew = !stored;
    const startName = stored ?? BUDDY_NAMES[Math.floor(Math.random() * BUDDY_NAMES.length)];
    setBuddyName(startName, isNew);

    if (native) {
      periRef.current = createPeripheralLink({
        onMessage: handleMessage,
        onConnect: (id) => conn.onConnected(id),
        onDisconnect: () => conn.onDisconnected(),
        onLog: (l, m) => log(l, '[ble] ' + m),
      });
      transitionTo('sleep'); // not connected yet
      log('info', 'buddy ready — advertising so Claude can connect.');
      void advertise();
    } else {
      simRef.current = new ClaudeSimulator(handleMessage);
      resetSleep();
      log('info', 'buddy ready. Start the Claude feed.');
    }

    return () => {
      if (sleepTimer.current) clearTimeout(sleepTimer.current);
      if (dataTimer.current) clearTimeout(dataTimer.current);
      simRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- IMU reactions (shake → dizzy, face-down → nap) ----
  useEffect(() => {
    if (typeof window.DeviceMotionEvent === 'undefined') return;
    let lastShake = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      const now = performance.now();
      if (mag > 28 && now - lastShake > 1500) {
        lastShake = now;
        transitionTo('dizzy');
        setTimeout(() => { if (animRef.current === 'dizzy') transitionTo('idle'); }, 1600);
      }
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta != null && Math.abs(e.beta) > 150 && animRef.current !== 'sleep') transitionTo('sleep');
    };
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrient);
    return () => {
      window.removeEventListener('devicemotion', onMotion);
      window.removeEventListener('deviceorientation', onOrient);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = native ? mode === 'connected' : simRunning;

  return {
    native, animState, stats, prompt, name, species, subtitle, live, mode,
    everConnected: everRef.current, peripheralStatus, simRunning, totals,
    messages, logs, buzzKey, actions,
  };
}
