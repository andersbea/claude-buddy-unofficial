/*
 * simulator.js — Claude Desktop integration (demo source).
 *
 * Claude Desktop integrates by acting as a BLE *central* that dials into the
 * buddy *peripheral* and streams heartbeat snapshots / turn events, then
 * accepts permission responses. A browser web app cannot expose a BLE
 * peripheral, so it cannot be the literal target of that link.
 *
 * To keep the integration faithful AND demonstrable, this module emits the
 * exact same JSON messages Claude Desktop sends (heartbeat snapshots, turn
 * events, time sync, approval prompts) and consumes the same permission
 * responses. Point app.js at either this simulator or a real feed — both speak
 * Protocol.LineParser output, so the rest of the app is source-agnostic.
 */
(function (global) {
  'use strict';

  const TOOLS = [
    { tool: 'Bash', hint: 'rm -rf build/ && make' },
    { tool: 'Edit', hint: 'modify src/server.ts' },
    { tool: 'Write', hint: 'create migrations/004.sql' },
    { tool: 'WebFetch', hint: 'fetch api.example.com/v2/users' },
    { tool: 'Bash', hint: 'git push origin main' },
  ];

  const ASSISTANT_LINES = [
    'Reading the project structure to get oriented.',
    'Found the bug — an off-by-one in the pagination cursor.',
    'Patching the handler and adding a regression test.',
    'Tests pass. 14 passed, 0 failed.',
    'Need your approval to run this command.',
    'Refactored the auth middleware into its own module.',
    'Looks good — shipping it.',
  ];

  function ClaudeSimulator(emit) {
    // emit(obj) receives messages exactly as if parsed off the wire.
    let timer = null;
    let promptTimer = null;
    let seq = 0;

    const stats = {
      total: 0,        // total sessions seen
      running: 0,      // active turns
      waiting: 0,      // turns blocked on approval
      msg: '',         // latest one-line message
      entries: 0,      // recent-message count
      tokens: 0,       // tokens this session
      tokens_today: 18420,
    };

    let pending = null; // current approval prompt
    let phase = 'idle';

    function snapshot() {
      const snap = Object.assign({}, stats);
      if (pending) snap.prompt = pending;
      emit(snap);
    }

    function turn(content) {
      emit({ evt: 'turn', role: 'assistant', content: [{ type: 'text', text: content }] });
    }

    function tick() {
      seq++;
      if (phase === 'idle') {
        if (Math.random() < 0.5) {
          // start a session
          phase = 'working';
          stats.total++;
          stats.running = 1;
          stats.msg = 'Session started';
          turn(ASSISTANT_LINES[0]);
        }
      } else if (phase === 'working') {
        stats.tokens += 200 + Math.floor(Math.random() * 1500);
        stats.tokens_today += 300;
        stats.entries++;
        const line = ASSISTANT_LINES[1 + (seq % (ASSISTANT_LINES.length - 2))];
        stats.msg = line;
        turn(line);
        if (Math.random() < 0.35) {
          // raise an approval prompt
          const t = TOOLS[Math.floor(Math.random() * TOOLS.length)];
          pending = { id: 'p' + Date.now(), tool: t.tool, hint: t.hint };
          stats.waiting = 1;
          stats.running = 0;
          stats.msg = 'Approval needed: ' + t.tool;
          phase = 'waiting';
          turn('Need your approval to run: ' + t.hint);
        } else if (Math.random() < 0.3) {
          // finish
          phase = 'finishing';
          stats.running = 0;
          stats.msg = 'Done';
          turn('All set — task complete.');
        }
      } else if (phase === 'finishing') {
        phase = 'idle';
        stats.running = 0;
        stats.waiting = 0;
      }
      snapshot();
    }

    // Accept a permission response, just like a real device button press.
    function resolve(id, decision) {
      if (!pending || pending.id !== id) return false;
      const tool = pending.tool;
      pending = null;
      stats.waiting = 0;
      if (decision === 'deny') {
        stats.running = 0;
        stats.msg = tool + ' denied';
        turn('Understood — skipping ' + tool + '.');
        phase = 'finishing';
      } else {
        stats.running = 1;
        stats.msg = tool + ' approved';
        turn('Running ' + tool + '…');
        phase = 'working';
      }
      snapshot();
      return true;
    }

    function start() {
      stop();
      emit({ time: [Math.floor(Date.now() / 1000), -new Date().getTimezoneOffset() * 60] });
      snapshot();
      timer = setInterval(tick, 2600);
    }

    function stop() {
      clearInterval(timer);
      clearTimeout(promptTimer);
      timer = promptTimer = null;
    }

    // Manual trigger so the UI can force an approval prompt on demand.
    function triggerPrompt() {
      const t = TOOLS[Math.floor(Math.random() * TOOLS.length)];
      pending = { id: 'p' + Date.now(), tool: t.tool, hint: t.hint };
      stats.waiting = 1;
      stats.running = 0;
      stats.msg = 'Approval needed: ' + t.tool;
      phase = 'waiting';
      turn('Need your approval to run: ' + t.hint);
      snapshot();
    }

    return { start, stop, resolve, triggerPrompt, running: () => !!timer };
  }

  global.ClaudeSimulator = ClaudeSimulator;
})(window);
