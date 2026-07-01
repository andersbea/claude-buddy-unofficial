import { describe, it, expect } from 'vitest';
import { SPECIES, SPECIES_KEYS, framesFor, tempoFor } from './buddy';
import { STATES } from './protocol';

describe('species data', () => {
  it('defines all four species', () => {
    expect(SPECIES_KEYS).toEqual(['bufo', 'blip', 'moth', 'crab']);
  });

  it('every species defines all seven canonical states with >=1 frame', () => {
    for (const key of SPECIES_KEYS) {
      const sp = SPECIES[key];
      for (const state of STATES) {
        expect(sp.states[state], `${key}.${state}`).toBeDefined();
        expect(sp.states[state].length, `${key}.${state} frames`).toBeGreaterThan(0);
      }
    }
  });

  it('every species has a tempo for each state', () => {
    for (const key of SPECIES_KEYS) {
      for (const state of STATES) {
        expect(typeof SPECIES[key].tempo[state]).toBe('number');
      }
    }
  });
});

describe('helpers', () => {
  it('framesFor returns the state frames', () => {
    expect(framesFor(SPECIES.bufo, 'idle')).toBe(SPECIES.bufo.states.idle);
  });
  it('tempoFor returns the per-state tempo', () => {
    expect(tempoFor(SPECIES.bufo, 'busy')).toBe(SPECIES.bufo.tempo.busy);
  });
});
