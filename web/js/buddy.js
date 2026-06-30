/*
 * buddy.js — ASCII species + animation engine.
 *
 * Each species defines the seven canonical states. A state is an array of
 * frames; the engine cycles frames at the state's tempo. This mirrors the
 * firmware's "buddies/" folder where each species ships 7 animations.
 */
(function (global) {
  'use strict';

  // Frame helper: keeps multi-line art readable in source.
  const F = (...lines) => lines.join('\n');

  const SPECIES = {
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

  /*
   * Animator: drives one species' frames on a target element, switching states
   * smoothly. The element should be a <pre>.
   */
  function Animator(el) {
    let species = SPECIES.bufo;
    let state = 'idle';
    let frame = 0;
    let timer = null;

    function paint() {
      const frames = species.states[state] || species.states.idle;
      frame = frame % frames.length;
      el.textContent = frames[frame];
    }

    function schedule() {
      clearTimeout(timer);
      const tempo = (species.tempo && species.tempo[state]) || 400;
      timer = setTimeout(() => { frame++; paint(); schedule(); }, tempo);
    }

    function applyColors() {
      const c = species.colors;
      el.style.color = c.text;
      el.style.setProperty('--buddy-body', c.body);
      el.style.setProperty('--buddy-bg', c.bg);
    }

    function setSpecies(key) {
      if (!SPECIES[key]) return;
      species = SPECIES[key];
      frame = 0;
      applyColors();
      paint();
      schedule();
    }

    function setState(next) {
      if (next === state) return;
      if (!species.states[next]) return;
      state = next;
      frame = 0;
      paint();
      schedule();
    }

    setSpecies('bufo');
    return {
      setSpecies, setState,
      get state() { return state; },
      get species() { return species.name; },
      get colors() { return species.colors; },
    };
  }

  global.Buddy = { SPECIES, Animator };
})(window);
