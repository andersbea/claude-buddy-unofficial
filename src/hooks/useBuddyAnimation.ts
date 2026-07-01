import { useEffect, useState } from 'react';
import { SPECIES, framesFor, tempoFor, type SpeciesKey } from '../lib/buddy';
import type { BuddyState } from '../lib/protocol';

/** Cycles a species' frames for the given state at the state's tempo. */
export function useBuddyAnimation(speciesKey: SpeciesKey, state: BuddyState): string {
  const [frame, setFrame] = useState(0);
  const species = SPECIES[speciesKey];
  const frames = framesFor(species, state);

  useEffect(() => {
    setFrame(0);
    const tempo = tempoFor(species, state);
    const id = setInterval(() => setFrame((f) => f + 1), tempo);
    return () => clearInterval(id);
  }, [speciesKey, state, species]);

  return frames[frame % frames.length] ?? '';
}
