import { describe, it, expect } from 'vitest';
import {
  initialStats, level, moodPips, fedPips, energyPips,
  onApproved, onDenied, onNapped, onStateEntered, tickEnergy,
  setSessionTokens, toStatusStats, MOOD_MAX, FED_MAX, ENERGY_MAX, FED_TOKENS_PER_PIP,
} from './stats';

describe('reducers are pure (never mutate)', () => {
  it('onApproved returns a new object', () => {
    const next = onApproved(initialStats);
    expect(next).not.toBe(initialStats);
    expect(initialStats.approved).toBe(0);
    expect(next.approved).toBe(1);
  });
});

describe('mood clamping', () => {
  it('approvals raise mood but clamp at MOOD_MAX', () => {
    let s = initialStats; // mood 3
    s = onApproved(s); // 4
    s = onApproved(s); // clamp 4
    expect(s.mood).toBe(MOOD_MAX);
  });
  it('denials lower mood but clamp at 0', () => {
    let s = { ...initialStats, mood: 1 };
    s = onDenied(s); // 0
    s = onDenied(s); // clamp 0
    expect(s.mood).toBe(0);
  });
  it('onStateEntered: dizzy lowers, heart maxes, celebrate raises', () => {
    expect(onStateEntered({ ...initialStats, mood: 2 }, 'dizzy').mood).toBe(1);
    expect(onStateEntered({ ...initialStats, mood: 0 }, 'heart').mood).toBe(MOOD_MAX);
    expect(onStateEntered({ ...initialStats, mood: 1 }, 'celebrate').mood).toBe(2);
    expect(onStateEntered(initialStats, 'idle')).toBe(initialStats); // no-op returns same
  });
});

describe('energy', () => {
  it('drains while running, recharges while idle, stays in [0,1]', () => {
    expect(tickEnergy({ ...initialStats, energy: 1 }, 1).energy).toBeCloseTo(0.85);
    expect(tickEnergy({ ...initialStats, energy: 0.5 }, 0).energy).toBeCloseTo(0.6);
    expect(tickEnergy({ ...initialStats, energy: 0 }, 1).energy).toBe(0);
    expect(tickEnergy({ ...initialStats, energy: 1 }, 0).energy).toBe(1);
  });
  it('energyPips maps to 0..ENERGY_MAX', () => {
    expect(energyPips({ ...initialStats, energy: 1 })).toBe(ENERGY_MAX);
    expect(energyPips({ ...initialStats, energy: 0 })).toBe(0);
  });
});

describe('derived gauges', () => {
  it('fedPips fills with session tokens and caps at FED_MAX', () => {
    expect(fedPips({ ...initialStats, sessionTokens: 0 })).toBe(0);
    expect(fedPips({ ...initialStats, sessionTokens: FED_TOKENS_PER_PIP * 2 })).toBe(2);
    expect(fedPips({ ...initialStats, sessionTokens: FED_TOKENS_PER_PIP * 100 })).toBe(FED_MAX);
  });
  it('moodPips rounds mood', () => {
    expect(moodPips({ ...initialStats, mood: 3 })).toBe(3);
  });
  it('level grows with approvals and tokens', () => {
    expect(level(initialStats)).toBe(0);
    expect(level({ ...initialStats, approved: 10 })).toBe(2);
    expect(level({ ...initialStats, sessionTokens: 120000 })).toBe(2);
  });
});

describe('toStatusStats maps to firmware field names', () => {
  it('uses appr/deny/vel/nap/lvl', () => {
    const s = setSessionTokens(onNapped(onApproved(initialStats)), 0);
    expect(toStatusStats(s)).toEqual({
      appr: 1, deny: 0, vel: energyPips(s), nap: 1, lvl: level(s),
    });
  });
});
