/*
 * stats.ts — the buddy's gamified pet stats, as pure functions.
 *
 * These mirror the firmware's appr/deny/vel/nap/lvl panel, but they are
 * DERIVED/playful (not real telemetry): "fed" is a fun mapping of session
 * tokens, "energy" drains while busy, "mood" reacts to approvals. Kept pure and
 * separate from the DOM so they're unit-testable and easy to reason about.
 */

export const MOOD_MAX = 4;
export const FED_MAX = 9;
export const ENERGY_MAX = 4;
export const FED_TOKENS_PER_PIP = 1800;

export interface GameStats {
  approved: number;
  denied: number;
  napped: number;
  /** 0..MOOD_MAX — rises on approvals/celebration, falls on denials/dizzy */
  mood: number;
  /** 0..1 — drains while the buddy works, recharges while it rests */
  energy: number;
  /** cumulative session tokens; fills the "fed" belly */
  sessionTokens: number;
}

export const initialStats: GameStats = {
  approved: 0,
  denied: 0,
  napped: 0,
  mood: 3,
  energy: 1,
  sessionTokens: 0,
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// ---- derived values ----
export const level = (s: GameStats): number =>
  Math.floor(s.approved / 5) + Math.floor(s.sessionTokens / 60000);
export const moodPips = (s: GameStats): number => Math.round(s.mood);
export const fedPips = (s: GameStats): number =>
  Math.min(FED_MAX, Math.round(s.sessionTokens / FED_TOKENS_PER_PIP));
export const energyPips = (s: GameStats): number => Math.round(s.energy * ENERGY_MAX);

// ---- reducers (return new state; never mutate) ----
export const onApproved = (s: GameStats): GameStats =>
  ({ ...s, approved: s.approved + 1, mood: clamp(s.mood + 1, 0, MOOD_MAX) });
export const onDenied = (s: GameStats): GameStats =>
  ({ ...s, denied: s.denied + 1, mood: clamp(s.mood - 1, 0, MOOD_MAX) });
export const onNapped = (s: GameStats): GameStats =>
  ({ ...s, napped: s.napped + 1 });

/** Mood reactions when the buddy enters certain animation states. */
export function onStateEntered(s: GameStats, state: string): GameStats {
  if (state === 'celebrate') return { ...s, mood: clamp(s.mood + 1, 0, MOOD_MAX) };
  if (state === 'dizzy') return { ...s, mood: clamp(s.mood - 1, 0, MOOD_MAX) };
  if (state === 'heart') return { ...s, mood: MOOD_MAX };
  return s;
}

/** Energy drains while a session is running, recharges while idle. */
export const tickEnergy = (s: GameStats, running: number): GameStats =>
  ({ ...s, energy: running > 0 ? Math.max(0, s.energy - 0.15) : Math.min(1, s.energy + 0.1) });

export const setSessionTokens = (s: GameStats, tokens: number): GameStats =>
  ({ ...s, sessionTokens: tokens });

/** The `stats` block of the status ack (firmware field names). */
export const toStatusStats = (s: GameStats) => ({
  appr: s.approved,
  deny: s.denied,
  vel: energyPips(s),
  nap: s.napped,
  lvl: level(s),
});
