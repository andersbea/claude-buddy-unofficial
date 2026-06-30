/*
 * app.js — wires the buddy display, Claude Desktop feed, and BLE relay together.
 *
 * Data flow:
 *
 *   Claude Desktop feed (simulator or real) --\
 *                                              >-- handleMessage() --> buddy state
 *   ESP32 buddy device (Web Bluetooth)      --/                   --> stats / messages
 *
 *   Approvals from either the on-screen buttons or a connected device's button
 *   press flow back to the feed as Protocol.permission() responses, and are
 *   mirrored to the BLE device so a physical buddy stays in sync.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const P = window.Protocol;

  // ---- elements ----
  const deviceEl  = $('device');
  const buddyEl   = $('buddy-art');
  const stateBadge = $('state-badge');
  const nameEl    = $('device-name');
  // Owner is provided by Claude (the desktop sends {cmd:"owner", name:…} with the
  // account's first name); we just remember whatever it tells us, no manual field.
  let owner = '';

  const btnBleConnect = $('btn-ble-connect');
  const bleStatus = $('ble-status');

  const btnClaudeStart = $('btn-claude-start');
  const btnTrigger = $('btn-trigger');
  const claudeStatus = $('claude-status');

  // native (phone-as-peripheral) mode controls
  const btnAdvertise = $('btn-advertise');
  const peripheralStatus = $('peripheral-status');
  const native = !!(window.BlePeripheral && window.BlePeripheral.isNative());

  const actionZone = $('action');
  const approvalTool = $('approval-tool');
  const approvalHint = $('approval-hint');
  const btnApprove = $('btn-approve');
  const btnDeny = $('btn-deny');

  const connDot = $('conn-dot');
  const levelBadge = $('level-badge');
  const gaugeMood = $('gauge-mood');
  const gaugeFed = $('gauge-fed');
  const gaugeEnergy = $('gauge-energy');

  const sheet = $('settings-sheet');
  const btnSettings = $('btn-settings');
  const btnSettingsClose = $('btn-settings-close');

  const msgList = $('messages');
  const logList = $('log');
  const speciesSel = $('species');

  // session readout (settings sheet)
  const stTotal = $('st-total');
  const stRunning = $('st-running');
  const stWaiting = $('st-waiting');
  const stTokens = $('st-tokens');
  const stTokensToday = $('st-tokens-today');
  // pet counters (device face)
  const stApproved = $('st-approved');
  const stDenied = $('st-denied');
  const stNapped = $('st-napped');

  // ---- gamified pet stats (mirror the firmware's appr/deny/vel/nap/lvl) ----
  // The hardware buddy gamifies session activity; we derive the same gauges so
  // the screen feels alive and the status ack can report real numbers.
  const MOOD_MAX = 4, FED_MAX = 9, ENERGY_MAX = 4, FED_TOKENS_PER_PIP = 1800;
  const game = {
    approved: 0,
    denied: 0,
    napped: 0,
    mood: 3,           // 0..MOOD_MAX — rises on approvals/celebration, falls on denials/dizzy
    energy: 1,         // 0..1 — drains while busy, recharges while resting
    sessionTokens: 0,  // resets when a session ends; fills the "fed" belly
  };

  // Render a row of identical pips; the first `filled` get the `on` class. The
  // filled/empty look is a CSS fill change (not a different glyph), so the pips
  // always align. The shape comes from the container class (heart/dot/bar).
  function renderPips(el, filled, total) {
    let html = '';
    for (let i = 0; i < total; i++) html += '<i class="' + (i < filled ? 'on' : 'off') + '"></i>';
    el.innerHTML = html;
  }

  function level() { return Math.floor(game.approved / 5) + Math.floor(game.sessionTokens / 60000); }

  function renderStats() {
    renderPips(gaugeMood, Math.round(game.mood), MOOD_MAX);
    renderPips(gaugeFed, Math.min(FED_MAX, Math.round(game.sessionTokens / FED_TOKENS_PER_PIP)), FED_MAX);
    renderPips(gaugeEnergy, Math.round(game.energy * ENERGY_MAX), ENERGY_MAX);
    levelBadge.textContent = 'Lv ' + level();
    stApproved.textContent = game.approved;
    stDenied.textContent = game.denied;
    stNapped.textContent = game.napped;
  }

  function setLive(on) { connDot.classList.toggle('live', !!on); }

  // ---- core objects ----
  const anim = window.Buddy.Animator(buddyEl);
  let currentPrompt = null;
  let lastActivity = Date.now();
  let sleepTimer = null;
  const btnConnect = $('btn-connect');
  const infoEl = document.querySelector('.info');

  // Decide what the action zone shows: an approval, a connect button, or nothing.
  function refreshAction() {
    const approving = !!currentPrompt;
    actionZone.classList.toggle('pending', approving);
    // the connect button is native-only (the phone advertises; it can't dial out)
    actionZone.classList.toggle('connect', native && !conn.isConnected() && !approving);
    // during an approval the stats give way to the prompt, so small screens never scroll
    if (infoEl) infoEl.classList.toggle('approving', approving);
    if (btnConnect) btnConnect.textContent = conn.everConnected() ? 'Reconnect to Claude' : 'Connect to Claude';
  }

  // ---- peripheral connection controller (native mode) ----
  // Single source of truth for the phone-as-buddy link, shared by BOTH the
  // main-view connect button and the settings advertise control so they can't
  // drift. All status strings and indicators are derived from `mode` in one
  // place (render). `peripheral` itself is created further below; these methods
  // only run after boot, by which point it's wired up.
  const conn = (function () {
    let mode = 'idle';   // 'idle' | 'advertising' | 'connected' | 'error'
    let advName = '';
    let lastError = '';
    let ever = false;    // has a central ever talked to us this session
    let dataTimer = null;
    const SILENCE_MS = 25000; // Claude polls ~2s + heartbeats ~10s; 25s quiet = gone

    function render() {
      if (mode === 'connected') {
        peripheralStatus.textContent = 'connected to Claude';
        peripheralStatus.className = 'status ok';
      } else if (mode === 'advertising') {
        peripheralStatus.textContent = 'advertising as "' + advName + '" — waiting for Claude';
        peripheralStatus.className = 'status ok';
      } else if (mode === 'error') {
        peripheralStatus.textContent = lastError;
        peripheralStatus.className = 'status err';
      } else {
        peripheralStatus.textContent = 'idle';
        peripheralStatus.className = 'status';
      }
      if (btnAdvertise) {
        btnAdvertise.textContent =
          (mode === 'advertising' || mode === 'connected') ? 'Stop advertising' : 'Start advertising';
      }
      setLive(mode === 'connected');
      refreshAction(); // drives the main-view connect button + ticker layout
    }

    function isConnected() { return mode === 'connected'; }
    function everConnected() { return ever; }

    async function advertise() {
      if (!peripheral) return;
      if (!isConnected()) setSubtitle('Looking for Claude…');
      try {
        advName = await peripheral.start(nameEl.value || 'Claude Buddy');
        mode = 'advertising';
        log('ok', 'advertising as ' + advName);
      } catch (e) {
        mode = 'error'; lastError = e.message; setSubtitle(e.message); log('err', e.message);
      }
      render();
    }

    // Full restart of the BLE peripheral: close + reopen the GATT server (like an
    // app relaunch, in one tap) and advertise fresh. This is the reliable way to
    // recover a stuck link — pair it with a fresh scan on the desktop. Only the
    // button (shown when not connected) triggers this, so it won't kill a live link.
    async function reconnect() {
      if (!peripheral) return;
      setSubtitle('Restarting Bluetooth…');
      log('info', 'reconnect: restarting GATT server');
      try { await peripheral.stop(); } catch (_) {}
      await advertise(); // server was closed by stop(), so this reopens it fresh
    }

    async function stop() {
      if (!peripheral) return;
      try { await peripheral.stop(); } catch (_) {}
      mode = 'idle';
      log('info', 'stopped advertising');
      render();
    }

    function toggle() { return (mode === 'advertising' || mode === 'connected') ? stop() : advertise(); }

    // We treat the link as live whenever Claude is actually talking to us —
    // either it subscribes to TX (onConnected) OR we receive any message
    // (noteData). This is robust to a central that reconnects with a cached
    // subscription and never re-writes the CCCD. If it then goes silent past
    // SILENCE_MS, we drop back to "looking" so the connect button returns.
    function markLive(why) {
      ever = true;
      if (mode !== 'connected') {
        mode = 'connected';
        log('ok', '[central] live (' + why + ')');
        setSubtitle('Connected to Claude');
        bump(); // wake the pet from sleep; the next snapshot sets the real state
        render();
      }
      clearTimeout(dataTimer);
      dataTimer = setTimeout(() => {
        if (mode === 'connected') {
          mode = (peripheral && peripheral.advertising()) ? 'advertising' : 'idle';
          setSubtitle('Claude went quiet');
          setState('sleep'); // bridge effectively down → sleep
          render();
        }
      }, SILENCE_MS);
    }

    // Called from the peripheral transport's lifecycle callbacks.
    function onConnected(id) { markLive('subscribed ' + id); }
    function noteData() { markLive('rx'); }
    function onDisconnected() {
      clearTimeout(dataTimer);
      // the plugin auto-resumes advertising once the active central drops
      mode = (peripheral && peripheral.advertising()) ? 'advertising' : 'idle';
      log('warn', '[central] disconnected');
      setState('sleep'); // "sleep" == bridge not connected (matches the firmware)
      setSubtitle('Claude disconnected');
      render();
    }

    return { advertise, reconnect, stop, toggle, onConnected, onDisconnected, noteData, isConnected, everConnected };
  })();

  const ble = window.BleLink({
    onConnect: (dev) => {
      bleStatus.textContent = 'connected: ' + (dev.name || 'device');
      bleStatus.className = 'status ok';
      btnBleConnect.textContent = 'Disconnect';
      setLive(true);
      // greet the device the way the desktop does on connect
      ble.send(P.timeSync()).catch(() => {});
      if (owner) ble.send(P.setOwner(owner)).catch(() => {});
    },
    onDisconnect: () => {
      bleStatus.textContent = 'not connected';
      bleStatus.className = 'status';
      btnBleConnect.textContent = 'Connect device';
      setLive(false);
    },
    onMessage: (msg) => handleDeviceMessage(msg),
    onLog: (level, m) => log(level, '[ble] ' + m),
  });

  const sim = window.ClaudeSimulator((msg) => handleMessage(msg));

  // In native mode the phone is the buddy peripheral: a central (Claude Desktop)
  // connects to us, its writes are the message source, and approvals go back as
  // TX notifications instead of through the simulator.
  let peripheral = null;
  if (native) {
    peripheral = window.BlePeripheral.BlePeripheralLink({
      onMessage: (msg) => handleMessage(msg),
      onConnect: (id) => conn.onConnected(id),
      onDisconnect: () => conn.onDisconnected(),
      onLog: (level, m) => log(level, '[ble] ' + m),
    });
  }

  // ---- message handling (from Claude feed) ----
  function handleMessage(msg) {
    // any inbound message means the central is live (native peripheral mode)
    if (native) conn.noteData();
    if (msg.time) { log('info', 'time sync from Claude'); return; }

    // In native (peripheral) mode we ARE the device, so the desktop's cmd
    // messages (status polls, name/owner, unpair) need matching acks.
    if (native && msg.cmd) { handleCommand(msg); return; }

    if (msg.evt === 'turn') {
      const text = (msg.content || []).map((c) => c.text || '').join(' ').trim();
      if (text) addMessage('assistant', text);
      // forward turn to a connected physical buddy (drop if >4KB per spec)
      relayToDevice(msg);
      bump();
      return;
    }

    // otherwise treat as a heartbeat snapshot
    const active = msg.running > 0 || msg.waiting > 0 || !!(msg.prompt && msg.prompt.id);
    applySnapshot(msg);
    relayToDevice(msg);
    // Only count real session activity as a wake/keep-awake signal — the desktop
    // sends a keepalive heartbeat every 10s, which must not block idle→sleep.
    if (active) bump();
  }

  // Respond to desktop commands when acting as the buddy peripheral.
  // See docs/REFERENCE.md → "Commands and acks".
  function handleCommand(msg) {
    if (!peripheral) return;
    const reply = (obj) => peripheral.send(obj).catch((e) => log('warn', 'ack failed: ' + e.message));
    switch (msg.cmd) {
      case 'status':
        reply(P.ack('status', { data: {
          name: nameEl.value || 'Claude Buddy',
          sec: false, // unencrypted/no-bond (see ble_bridge plugin comment)
          // bat/sys included to fully match REFERENCE.md's status response — some
          // desktop builds may treat a device without them as not responding.
          bat: { pct: 100, mV: 4100, mA: 0, usb: true },
          sys: { up: Math.round(performance.now() / 1000), heap: 100000 },
          stats: {
            appr: game.approved, deny: game.denied,
            vel: Math.round(game.energy * ENERGY_MAX),
            nap: game.napped, lvl: level(),
          },
        } }));
        break;
      case 'name':
        if (msg.name) setBuddyName(msg.name, true);
        reply(P.ack('name'));
        break;
      case 'owner':
        if (msg.name) owner = msg.name;
        reply(P.ack('owner'));
        break;
      case 'unpair':
        // desktop "Forget" — erase the OS bond so the next pairing is fresh
        if (peripheral && peripheral.unpair) peripheral.unpair();
        reply(P.ack('unpair'));
        break;
      // Folder push: we don't accept pushed files. Per spec, decline by NOT
      // acking char_begin; silently ignore the rest of the sequence.
      case 'char_begin':
      case 'file':
      case 'chunk':
      case 'file_end':
      case 'char_end':
        break;
      default:
        log('info', '[central] unhandled cmd: ' + msg.cmd);
    }
  }

  function applySnapshot(snap) {
    if ('total' in snap) stTotal.textContent = snap.total;
    if ('running' in snap) stRunning.textContent = snap.running;
    if ('waiting' in snap) stWaiting.textContent = snap.waiting;
    if ('tokens' in snap) { stTokens.textContent = fmt(snap.tokens); game.sessionTokens = snap.tokens; }
    if ('tokens_today' in snap) stTokensToday.textContent = fmt(snap.tokens_today);
    if (snap.msg) setSubtitle(snap.msg);

    // energy drains while the buddy works, recharges while it rests
    if (snap.running > 0) game.energy = Math.max(0, game.energy - 0.15);
    else game.energy = Math.min(1, game.energy + 0.1);
    renderStats();

    if (snap.prompt && snap.prompt.id) {
      showApproval(snap.prompt);
    } else {
      hideApproval();
    }

    const state = P.stateFromSnapshot(snap, {
      justFinished: snap.running === 0 && snap.waiting === 0 && /done|complete|approved/i.test(snap.msg || ''),
    });
    setState(state);
  }

  // ---- message handling (from a connected device) ----
  function handleDeviceMessage(msg) {
    if (msg.cmd === 'permission' && msg.id) {
      log('ok', '[device] permission ' + msg.decision + ' for ' + msg.id);
      resolvePrompt(msg.id, msg.decision, 'device');
      return;
    }
    if (msg.ack) {
      log('info', '[device] ack ' + msg.ack + ' ok=' + msg.ok + (msg.n != null ? ' n=' + msg.n : ''));
      return;
    }
    if (msg.battery != null || msg.heap != null) {
      log('info', '[device] status batt=' + msg.battery + '% heap=' + msg.heap);
      return;
    }
    log('info', '[device] ' + JSON.stringify(msg));
  }

  function relayToDevice(obj) {
    if (ble.connected()) ble.send(obj).catch((e) => log('warn', 'relay failed: ' + e.message));
  }

  // ---- approvals ----
  function showApproval(prompt) {
    const isNew = !currentPrompt || currentPrompt.id !== prompt.id;
    currentPrompt = prompt;
    approvalTool.textContent = prompt.tool || 'tool';
    approvalHint.textContent = prompt.hint || '';
    refreshAction();
    setState('attention');
    if (isNew) buzz(); // light the screen + buzz, like the hardware
  }

  function hideApproval() {
    currentPrompt = null;
    refreshAction();
  }

  // Visual + haptic alert when a decision is needed.
  function buzz() {
    deviceEl.classList.remove('buzz');
    void deviceEl.offsetWidth; // reflow so the animation can restart
    deviceEl.classList.add('buzz');
    if (navigator.vibrate) { try { navigator.vibrate([40, 60, 40]); } catch (_) {} }
  }

  function resolvePrompt(id, decision, source) {
    // capture the tool name before hideApproval() clears currentPrompt
    const toolName = currentPrompt ? currentPrompt.tool : id;
    if (native) {
      // phone-as-peripheral: notify the connected central directly
      if (peripheral) {
        peripheral.send(P.permission(id, decision))
          .catch((e) => log('warn', 'notify failed: ' + e.message));
      }
    } else {
      // browser: send the response upstream to the simulated Claude feed,
      // and mirror to a connected physical device unless it originated there
      sim.resolve(id, decision);
      if (source !== 'device') relayToDevice(P.permission(id, decision));
    }
    addMessage('you', (decision === 'deny' ? 'Denied' : 'Approved') + ' ' + toolName + (source === 'device' ? ' (from device)' : ''));
    if (decision === 'deny') { game.denied++; game.mood = Math.max(0, game.mood - 1); }
    else { game.approved++; game.mood = Math.min(MOOD_MAX, game.mood + 1); }
    renderStats();
    hideApproval();
  }

  btnApprove.addEventListener('click', () => {
    if (currentPrompt) resolvePrompt(currentPrompt.id, 'once', 'screen');
  });
  btnDeny.addEventListener('click', () => {
    if (currentPrompt) resolvePrompt(currentPrompt.id, 'deny', 'screen');
  });

  // ---- buddy state + sleep timer ----
  function setState(s) {
    const prev = anim.state;
    anim.setState(s);
    stateBadge.textContent = s;
    stateBadge.dataset.state = s;
    if (s !== prev) {
      if (s === 'sleep') game.napped++;
      else if (s === 'celebrate') game.mood = Math.min(MOOD_MAX, game.mood + 1);
      else if (s === 'dizzy') game.mood = Math.max(0, game.mood - 1);
      else if (s === 'heart') game.mood = MOOD_MAX;
      renderStats();
    }
  }

  function bump() {
    lastActivity = Date.now();
    if (anim.state === 'sleep') setState('idle');
    resetSleep();
  }

  function resetSleep() {
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      if (anim.state === 'idle') setState('sleep');
    }, 90000); // sleep after 90s idle, matching firmware default
  }

  // ---- BLE button ----
  btnBleConnect.addEventListener('click', async () => {
    try {
      if (ble.connected()) { await ble.disconnect(); return; }
      await ble.connect();
    } catch (e) {
      bleStatus.textContent = e.message;
      bleStatus.className = 'status err';
      log('err', e.message);
    }
  });

  // ---- Claude feed buttons ----
  btnClaudeStart.addEventListener('click', () => {
    if (sim.running()) {
      sim.stop();
      btnClaudeStart.textContent = 'Start Claude feed';
      claudeStatus.textContent = 'stopped';
      claudeStatus.className = 'status';
      setLive(false);
    } else {
      sim.start();
      btnClaudeStart.textContent = 'Stop Claude feed';
      claudeStatus.textContent = 'streaming (simulated desktop)';
      claudeStatus.className = 'status ok';
      setLive(true);
    }
  });
  btnTrigger.addEventListener('click', () => sim.triggerPrompt());

  // ---- settings sheet ----
  btnSettings.addEventListener('click', () => { sheet.hidden = false; });
  btnSettingsClose.addEventListener('click', () => { sheet.hidden = true; });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });

  // ---- IMU reactions (mirrors the hardware: shake to dizzy, face-down to nap) ----
  function setupMotion() {
    if (typeof window.DeviceMotionEvent === 'undefined') return;
    let lastShake = 0;
    window.addEventListener('devicemotion', (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
      const now = performance.now();
      if (mag > 28 && now - lastShake > 1500) { // a hard shake
        lastShake = now;
        setState('dizzy');
        setTimeout(() => { if (anim.state === 'dizzy') setState('idle'); }, 1600);
      }
    });
    if (typeof window.DeviceOrientationEvent !== 'undefined') {
      window.addEventListener('deviceorientation', (e) => {
        if (e.beta != null && Math.abs(e.beta) > 150 && anim.state !== 'sleep') setState('sleep'); // face-down → nap
      });
    }
  }

  // Both connection controls route through the one `conn` controller:
  //  - settings: toggle advertising on/off
  //  - main view: reconnect (drop stale link + re-advertise)
  if (btnAdvertise) btnAdvertise.addEventListener('click', () => conn.toggle());

  // Recovery controls (settings): kick a stuck link / clear a stale bond.
  const btnDisconnect = $('btn-disconnect');
  const btnForget = $('btn-forget');
  if (btnDisconnect) {
    btnDisconnect.addEventListener('click', async () => {
      if (!peripheral || !peripheral.disconnect) return;
      const r = await peripheral.disconnect();
      log('info', 'disconnected ' + ((r && r.disconnected) || 0) + ' link(s)');
      conn.onDisconnected();
    });
  }
  if (btnForget) {
    btnForget.addEventListener('click', async () => {
      if (!peripheral || !peripheral.forget) return;
      try { await peripheral.disconnect(); } catch (_) {}
      const r = await peripheral.forget();
      const n = (r && r.forgot) || 0;
      log('ok', 'forgot bond with ' + n + ' computer(s)');
      peripheralStatus.textContent = n
        ? 'forgot ' + n + ' pairing(s) — now Forget it in Claude Desktop too, then re-scan'
        : 'no paired computer found to forget';
      peripheralStatus.className = 'status';
      conn.onDisconnected();
    });
  }
  if (btnConnect) {
    btnConnect.addEventListener('click', async () => {
      // Full restart of the peripheral (only available when not connected).
      btnConnect.disabled = true;
      try { await conn.reconnect(); } finally { btnConnect.disabled = false; }
    });
  }

  // ---- species + identity ----
  Object.keys(window.Buddy.SPECIES).forEach((key) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = window.Buddy.SPECIES[key].label;
    speciesSel.appendChild(opt);
  });
  speciesSel.value = 'bufo';
  speciesSel.addEventListener('change', () => anim.setSpecies(speciesSel.value));

  nameEl.addEventListener('change', () => {
    setBuddyName(nameEl.value, true);
    if (ble.connected()) ble.send(P.setName(nameEl.value)).catch(() => {});
  });

  // ---- helpers ----
  function addMessage(who, text) {
    const li = document.createElement('li');
    li.className = 'msg ' + who;
    const tag = document.createElement('span');
    tag.className = 'who';
    tag.textContent = who === 'you' ? 'you' : 'claude';
    const body = document.createElement('span');
    body.className = 'text';
    body.textContent = text;
    li.append(tag, body);
    msgList.prepend(li);
    while (msgList.children.length > 30) msgList.lastChild.remove();
  }

  function setSubtitle(text) { $('device-subtitle').textContent = text; }

  // Single place to set the buddy's name: updates the input + face label, and
  // optionally persists it so it survives restarts.
  function setBuddyName(value, persist) {
    const name = value || 'Buddy';
    nameEl.value = name;
    $('device-name-label').textContent = name;
    if (persist) { try { localStorage.setItem('buddyName', name); } catch (_) {} }
  }

  function log(level, m) {
    const li = document.createElement('li');
    li.className = 'log-' + level;
    li.textContent = m;
    logList.prepend(li);
    while (logList.children.length > 50) logList.lastChild.remove();
  }

  function fmt(n) {
    if (n == null) return '0';
    return n.toLocaleString();
  }

  // ---- boot ----
  // The buddy keeps a stable name: a fun random one is chosen the first time and
  // stored, then reused on every launch (advertised as "Claude <name>" so Claude
  // Desktop, which filters on that prefix, still finds it). Rename it in settings.
  const BUDDY_NAMES = ['Mochi', 'Bufo', 'Pip', 'Gizmo', 'Tofu', 'Bean', 'Waffle',
    'Noodle', 'Pixel', 'Sprout', 'Biscuit', 'Yuzu', 'Momo', 'Clawd', 'Bonsai', 'Tater'];
  let storedName = null;
  try { storedName = localStorage.getItem('buddyName'); } catch (_) {}
  const isNewName = !storedName;
  if (isNewName) storedName = BUDDY_NAMES[Math.floor(Math.random() * BUDDY_NAMES.length)];
  setBuddyName(storedName, isNewName); // persist only when freshly assigned

  renderStats();
  setupMotion();
  refreshAction();
  if (native) {
    // phone is the buddy peripheral: hide the simulator + central controls
    $('sim-section').hidden = true;
    $('central-section').hidden = true;
    $('peripheral-section').hidden = false;
    setState('sleep'); // not connected to Claude yet → asleep
    log('info', 'buddy ready — advertising so Claude can connect.');
    // Auto-advertise on launch so there's nothing to do but connect from Claude.
    conn.advertise();
  } else {
    if (!ble.supported()) {
      bleStatus.textContent = 'Web Bluetooth unavailable (use Chrome/Edge, https or localhost)';
      bleStatus.className = 'status err';
      btnBleConnect.disabled = true;
    }
    setState('idle');
    resetSleep();
    log('info', 'buddy ready. Start the Claude feed, or connect a device.');
  }
})();
