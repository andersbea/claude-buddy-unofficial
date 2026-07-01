import { useBuddyAnimation } from '../hooks/useBuddyAnimation';
import type { SpeciesKey } from '../lib/buddy';
import type { BuddyState } from '../lib/protocol';

/** The LCD screen: a faint-scanline area with the animating ASCII pet. */
export function BuddyScreen({ species, state }: { species: SpeciesKey; state: BuddyState }) {
  const frame = useBuddyAnimation(species, state);
  return (
    <div className="screen">
      <pre className="buddy-art">{frame}</pre>
    </div>
  );
}
