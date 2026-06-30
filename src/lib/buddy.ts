/*
 * buddy.ts — ASCII species + per-state animation frames.
 *
 * Each species defines all seven canonical states; a state is an array of
 * frames cycled at the state's tempo. Mirrors the firmware's "buddies/" folder.
 */
import type { BuddyState } from './protocol';

/** Frame helper: keeps multi-line art readable in source. */
const F = (...lines: string[]): string => lines.join('\n');

export type SpeciesKey = 'bufo' | 'blip' | 'moth' | 'crab';

export interface Species {
  name: SpeciesKey;
  label: string;
  colors: { body: string; bg: string; text: string };
  tempo: Record<BuddyState, number>;
  states: Record<BuddyState, string[]>;
}

export const SPECIES: Record<SpeciesKey, Species> = {
  bufo: {
    name: 'bufo',
    label: 'Bufo the toad',
    colors: { body: '#7cb342', bg: '#0a0f0a', text: '#dcedc8' },
    tempo: { sleep: 900, idle: 600, busy: 130, attention: 220, celebrate: 160, dizzy: 90, heart: 380 },
    states: {
      sleep: [
        F('   z      ', '  z  __   ', ' z  (--)  ', '   <(  )> ', '   ~~~~   '),
        F('    z     ', '   z__    ', '  (--)  z ', '  <(  )>  ', '   ~~~~   '),
      ],
      idle: [
        F('   __     ', '  (oo)    ', '  <(  )>  ', '   ^^     '),
        F('   __     ', '  (oo)    ', ' <( )>    ', '   ^^     '),
        F('   __     ', '  (-o)    ', '  <(  )>  ', '   ^^     '),
      ],
      busy: [
        F('   __     ', '  (OO)  . ', '  <(  )>* ', '   ^^     '),
        F('   __     ', ' .(OO)    ', ' *<(  )>  ', '   ^^     '),
        F('   __     ', '  (OO). * ', '  <(  )>  ', '   ^^  .  '),
      ],
      attention: [
        F('   !!     ', '  (OO)    ', '  <(!!)>  ', '   ^^     '),
        F('   !!     ', '  (@@)    ', '  <(!!)>  ', '   ^^     '),
      ],
      celebrate: [
        F('  \\__/    ', '  (^^)    ', '  <(  )>  ', '   ^^  *  '),
        F(' * \\__/   ', '  (^^)    ', ' o<(  )>o ', '   ^^     '),
      ],
      dizzy: [
        F('  @ __ @  ', '  (xx)    ', '  <(  )>  ', '   ^^     '),
        F('  * __ *  ', '  (++)    ', '  <(  )>  ', '   ^^     '),
      ],
      heart: [
        F('  <3 __   ', '  (^^) <3 ', '  <(  )>  ', '   ^^     '),
        F('   __ <3  ', ' <3(^^)   ', '  <(  )>  ', '   ^^     '),
      ],
    },
  },

  blip: {
    name: 'blip',
    label: 'Blip the bot',
    colors: { body: '#4fc3f7', bg: '#06080f', text: '#cfeeff' },
    tempo: { sleep: 1000, idle: 650, busy: 120, attention: 200, celebrate: 150, dizzy: 85, heart: 360 },
    states: {
      sleep: [
        F('  .----.  ', '  |-  -|  ', '  | zz |  ', "  '----'  "),
        F('  .----.  ', '  |-  -|  ', '  | z  |  ', "  '----'  "),
      ],
      idle: [
        F('  .----.  ', '  | oo |  ', '  | -- |  ', "  '----'  "),
        F('  .----.  ', '  | oo |  ', '  | __ |  ', "  '----'  "),
        F('  .----.  ', '  | -- |  ', '  | -- |  ', "  '----'  "),
      ],
      busy: [
        F('  .----.  ', '  | ** | /', '  | <> | \\', "  '----'  "),
        F(' \\.----.  ', '  | ** |  ', ' /| >< | \\', "  '----'  "),
        F('  .----./ ', '  | ** |  ', '  | <> |  ', " \\'----'  "),
      ],
      attention: [
        F('  .----.  ', '  | !! |  ', '  | == |  ', "  '----'  "),
        F('  .----.  ', '  | @@ |  ', '  | == |  ', "  '----'  "),
      ],
      celebrate: [
        F(' \\.----./ ', '  | ^^ |  ', '  | \\/ |  ', "  '----'  "),
        F(' o.----.o ', '  | ^^ |  ', '  | \\/ |  ', "  '----'  "),
      ],
      dizzy: [
        F('  .----.  ', '  | xx |  ', '  | ~~ |  ', "  '----'  "),
        F('  .----.  ', '  | ++ |  ', '  | ~~ |  ', "  '----'  "),
      ],
      heart: [
        F('  .----.<3', '  | ^^ |  ', '  | \\/ |  ', "  '----'  "),
        F('<3.----.  ', '  | ^^ |  ', '  | \\/ |  ', "  '----'  "),
      ],
    },
  },

  moth: {
    name: 'moth',
    label: 'Moth',
    colors: { body: '#ce93d8', bg: '#0c0810', text: '#f3e5f5' },
    tempo: { sleep: 950, idle: 520, busy: 110, attention: 210, celebrate: 140, dizzy: 80, heart: 340 },
    states: {
      sleep: [
        F('  W   W   ', ' (  -  )  ', '  \\ - /   ', '   ~ ~    '),
        F('  w   w   ', ' (  -  )  ', '  \\ - /   ', '   ~ ~    '),
      ],
      idle: [
        F('  W   W   ', ' ( o o )  ', '  \\ v /   ', '   | |    '),
        F('  /\\ /\\   ', ' ( o o )  ', '  \\ v /   ', '   | |    '),
        F('  W   W   ', ' ( - - )  ', '  \\ v /   ', '   | |    '),
      ],
      busy: [
        F(' \\W   W/  ', ' ( @ @ )  ', '  \\ v /   ', '   | |  . '),
        F('  W\\ /W   ', ' ( @ @ )  ', ' .\\ v /   ', '   | |    '),
        F(' /W   W\\  ', ' ( @ @ )  ', '  \\ v /.  ', '   | |    '),
      ],
      attention: [
        F('  W ! W   ', ' ( ! ! )  ', '  \\ ^ /   ', '   | |    '),
        F('  W ! W   ', ' ( @ @ )  ', '  \\ ^ /   ', '   | |    '),
      ],
      celebrate: [
        F(' \\W   W/  ', ' ( ^ ^ )  ', '  \\ v /   ', '  o| |o   '),
        F(' *W   W*  ', ' ( ^ ^ )  ', '  \\ v /   ', '   | |    '),
      ],
      dizzy: [
        F('  W @ W   ', ' ( x x )  ', '  \\ ~ /   ', '   | |    '),
        F('  W * W   ', ' ( + + )  ', '  \\ ~ /   ', '   | |    '),
      ],
      heart: [
        F(' <3W W    ', ' ( ^ ^ )<3', '  \\ v /   ', '   | |    '),
        F('  W W<3   ', '<3( ^ ^ ) ', '  \\ v /   ', '   | |    '),
      ],
    },
  },

  crab: {
    name: 'crab',
    label: 'Crab',
    colors: { body: '#ff8a65', bg: '#100806', text: '#ffe0d6' },
    tempo: { sleep: 900, idle: 560, busy: 120, attention: 200, celebrate: 150, dizzy: 80, heart: 360 },
    states: {
      sleep: [
        F(' (\\ -- /) ', '  (．．)   ', '  /    \\  '),
        F(' (\\ -- /) ', '  (z．)   ', '  /    \\  '),
      ],
      idle: [
        F(' (\\ oo /) ', '  (..)    ', '  /    \\  '),
        F(' (/ oo \\) ', '  (..)    ', '  \\    /  '),
        F(' (\\ -- /) ', '  (..)    ', '  /    \\  '),
      ],
      busy: [
        F(' (\\ @@ /) ', '  (><)    ', '  /^^^^\\  '),
        F(' (/ @@ \\) ', '  (><)    ', '  \\vvvv/  '),
        F(' (\\ @@ /) ', '  (><)    ', '  /^^^^\\  '),
      ],
      attention: [
        F(' (\\ !! /) ', '  (!!)    ', '  /    \\  '),
        F(' (/ !! \\) ', '  (@@)    ', '  \\    /  '),
      ],
      celebrate: [
        F(' \\(^^)/   ', '  (^^)    ', '  /    \\  '),
        F(' o(^^)o   ', '  (^^)    ', '  \\    /  '),
      ],
      dizzy: [
        F(' (\\ xx /) ', '  (++)    ', '  /~~~~\\  '),
        F(' (/ ++ \\) ', '  (xx)    ', '  \\~~~~/  '),
      ],
      heart: [
        F(' (\\ ^^ /)<3', '  (^^)    ', '  /    \\  '),
        F('<3(\\ ^^ /)', '  (^^)    ', '  /    \\  '),
      ],
    },
  },
};

export const SPECIES_KEYS = Object.keys(SPECIES) as SpeciesKey[];

/** Frames for a species+state, falling back to idle if a state is missing. */
export const framesFor = (species: Species, state: BuddyState): string[] =>
  species.states[state] ?? species.states.idle;

export const tempoFor = (species: Species, state: BuddyState): number =>
  species.tempo[state] ?? 400;
