"use strict";

// Музыка игры, синтезируется прямо в браузере (Web Audio), без файлов.
// Матчи: энергичный электронный бит; каждый матч — своя тональность и аккорды (от id матча),
// во время отсчёта играет вступление без бочки, на «СТАРТ!» вступает полный бит.
// Меню: спокойные треки по кругу. И в меню, и в матчах можно поставить свой файл игрока
// (он хранится в браузере — IndexedDB).
const music = (() => {
  let ctx = null;
  let master = null;    // общая громкость (и выключение звука)
  let bus = null;       // музыка текущего матча — её плавно гасим в конце
  let duck = null;      // бас и арпеджио «приседают» на каждую бочку
  let delay = null;     // эхо для арпеджио
  let noise = null;     // буфер белого шума для барабанов
  let timer = 0;
  let song = null;      // { bpm, root, chords, step, next, dropAt }
  let muted = false;
  try { muted = localStorage.getItem("arrowrush.music") === "off"; } catch { /* приватный режим */ }

  const VOLUME = 0.45;
  const LOOKAHEAD = 0.12; // на сколько секунд вперёд планируем ноты

  // минорные последовательности аккордов (ступени от тоники) — звучат напористо
  const PROGRESSIONS = [
    [0, 8, 3, 10],   // i – VI – III – VII
    [0, 10, 8, 10],  // i – VII – VI – VII
    [0, 5, 8, 7],    // i – iv – VI – V
    [0, 3, 10, 5],   // i – III – VII – iv
  ];

  /** AudioContext создаём по нажатию игрока — иначе браузер не даст играть звук. */
  function unlock() {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : VOLUME;
      master.connect(ctx.destination);

      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      // свой трек матча раскодируем заранее — иначе в первом матче музыка заиграет с опозданием
      if (matchId === "custom") loadFile("match");
    }
    if (ctx.state === "suspended") ctx.resume();
    if (menuWanted) startMenu(); // меню ждало первого нажатия, чтобы заиграть
  }

  const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

  function env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // ---------- Инструменты ----------

  function kick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    env(g, t, 0.002, 1, 0.28);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.35);

    // всё остальное на мгновение притихает — бит «качает»
    duck.gain.setValueAtTime(0.35, t);
    duck.gain.linearRampToValueAtTime(1, t + 0.18);
  }

  function noiseHit(t, type, cutoff, peak, decay, out = bus) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    env(g, t, 0.001, peak, decay);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + decay + 0.05);
  }

  function snare(t) {
    noiseHit(t, "highpass", 1400, 0.55, 0.16);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    env(g, t, 0.001, 0.35, 0.09);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.12);
  }

  const hat = (t, open) => noiseHit(t, "highpass", 7500, open ? 0.16 : 0.1, open ? 0.12 : 0.035);

  function bass(t, midi, len) {
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = freq(midi);
    f.type = "lowpass";
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(220, t + len);
    env(g, t, 0.005, 0.42, len);
    o.connect(f).connect(g).connect(duck);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  function arp(t, midi, open) {
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = freq(midi);
    f.type = "lowpass";
    f.frequency.value = open ? 4200 : 1200; // во вступлении арпеджио приглушено
    env(g, t, 0.003, 0.11, 0.14);
    o.connect(f).connect(g);
    g.connect(duck);
    g.connect(delay);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** Короткий взлёт шума перед «СТАРТ!». */
  function riser(t, len) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(8000, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + len);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.05);
    s.connect(f).connect(g).connect(bus);
    s.start(t);
    s.stop(t + len + 0.1);
  }

  // ---------- Секвенсор ----------

  /** Одна шестнадцатая: что в ней играет, зависит от позиции в такте и от того, был ли уже «дроп». */
  function playStep(t, n) {
    const s = song;
    const inBar = n % 16;
    const bar = Math.floor(n / 16);
    const chord = s.chords[bar % 4];
    const main = t >= s.dropAt - 0.01;

    if (main) {
      if (inBar % 4 === 0) kick(t);
      if (inBar === 4 || inBar === 12) snare(t);
      // каждый 4-й такт в конце — дробь малого барабана
      if (bar % 4 === 3 && inBar >= 12) snare(t);
      if (inBar % 4 === 2) bass(t, s.root - 12 + chord, s.stepLen * 1.6);
    }
    hat(t, main && inBar % 4 === 2);

    // арпеджио: тоника, терция, квинта, октава аккорда, вверх-вниз
    const shape = [0, 3, 7, 12, 15, 12, 7, 3];
    arp(t, s.root + 12 + chord + shape[n % shape.length], main);
  }

  function schedule() {
    if (!song) return;
    while (song.next < ctx.currentTime + LOOKAHEAD) {
      playStep(song.next, song.step);
      song.step++;
      song.next += song.stepLen;
    }
  }

  /** Музыка матча. introSeconds — длина отсчёта: столько играет вступление, потом вступает бит. */
  function start({ seed = 0, fast = false, introSeconds = 3 } = {}) {
    unlock();
    stop(0);

    bus = ctx.createGain();
    bus.connect(master);
    if (matchId === "custom" && files.match.name) {
      // свой трек; если файл не загрузился — встроенный бит, чтобы матч не прошёл в тишине
      const out = bus;
      playMatchCustom(out, introSeconds).then((ok) => { if (!ok && bus === out) startBeat(seed, fast, introSeconds); });
      return;
    }
    startBeat(seed, fast, introSeconds);
  }

  /** Свой трек в матче: во время отсчёта звучит глухо, как из-за стены, на «СТАРТ!» раскрывается. */
  async function playMatchCustom(out, introSeconds) {
    const buf = await loadFile("match");
    if (bus !== out) return true; // пока грузили, матч уже кончился
    if (!buf) return false;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    const g = ctx.createGain();
    g.gain.value = CUSTOM_LEVEL;
    const t = ctx.currentTime + 0.05;
    lp.frequency.value = 20000;
    if (introSeconds > 0.6) {
      const drop = t + introSeconds;
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.setValueAtTime(700, drop - 0.3);
      lp.frequency.exponentialRampToValueAtTime(20000, drop);
    }
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(lp).connect(g).connect(out);
    s.start(t);
    matchSource = s;
    return true;
  }

  /** Встроенный бит матча: тональность и аккорды — от seed. */
  function startBeat(seed, fast, introSeconds) {
    duck = ctx.createGain();
    duck.connect(bus);
    delay = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(bus);

    const bpm = fast ? 150 : 140;
    const stepLen = 60 / bpm / 4;
    delay.delayTime.value = stepLen * 3; // эхо на точку-восьмую

    const now = ctx.currentTime + 0.06;
    song = {
      bpm,
      stepLen,
      root: 45 + (seed % 7),                          // тоника от A2 до D#3
      chords: PROGRESSIONS[Math.floor(seed / 7) % PROGRESSIONS.length],
      step: 0,
      next: now,
      dropAt: now + introSeconds,
    };
    if (introSeconds > 0.6) riser(song.dropAt - Math.min(1.5, introSeconds), Math.min(1.5, introSeconds));
    schedule();
    timer = setInterval(schedule, 25);
  }

  /** Плавно гасим музыку матча за fade секунд. */
  function stop(fade = 0.8) {
    clearInterval(timer);
    timer = 0;
    song = null;
    if (!bus) return;
    const b = bus, src = matchSource;
    bus = null;
    matchSource = null;
    b.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, fade / 4));
    setTimeout(() => {
      try { if (src) src.stop(); } catch { /* уже */ }
      b.disconnect();
    }, (fade + 0.3) * 1000);
  }

  /** Короткий джингл в конце матча: взлёт на победу, спуск на поражение. */
  function jingle(win) {
    if (!ctx) return;
    const out = ctx.createGain();
    out.connect(master);
    const t0 = ctx.currentTime + 0.05;
    const notes = win ? [72, 76, 79, 84, 88] : [67, 63, 60];
    notes.forEach((m, i) => {
      const t = t0 + i * (win ? 0.09 : 0.16);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = win ? "square" : "triangle";
      o.frequency.value = freq(m);
      env(g, t, 0.005, win ? 0.16 : 0.22, win && i === notes.length - 1 ? 0.7 : 0.22);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1);
    });
    setTimeout(() => out.disconnect(), 2000);
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem("arrowrush.music", m ? "off" : "on"); } catch { /* ничего */ }
    if (master) master.gain.setTargetAtTime(m ? 0 : VOLUME, ctx.currentTime, 0.05);
  }

  // ---------- Музыка меню ----------

  // спокойные треки: аккорды (MIDI) по тактам, вероятность нот электропиано и колокольчиков, ударные
  const MENU_TRACKS = {
    relax: {
      name: "Релакс", desc: "Мягкие пэды, электропиано и тихий бит", bpm: 84,
      chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]], // Fmaj7 Em7 Dm7 Cmaj7
      keys: 0.55, bells: 0, drums: "soft",
    },
    night: {
      name: "Ночной город", desc: "Лоу-фай: джазовые аккорды и ленивый бит", bpm: 88,
      chords: [[45, 55, 60, 64, 67], [50, 57, 60, 64, 65], [43, 53, 57, 59, 64], [48, 55, 59, 62, 64]], // Am9 Dm9 G13 Cmaj9
      keys: 0.4, bells: 0, drums: "lofi",
    },
    space: {
      name: "Космос", desc: "Без ударных: тянущиеся пэды и колокольчики", bpm: 68,
      chords: [[50, 57, 62, 64], [46, 53, 58, 62], [43, 50, 55, 57], [45, 52, 57, 61]], // Dsus2 Bb G A
      keys: 0, bells: 0.14, drums: null,
    },
  };
  const MENU_LEVEL = 0.7;

  let menuWanted = false;   // сейчас экран, где должна звучать музыка меню
  let menuId = "relax";
  let menuBus = null, menuTimer = 0, menuSong = null, menuSource = null;
  let matchId = "beat";     // музыка матча: "beat" — встроенный бит, "custom" — свой файл
  let matchSource = null;
  const CUSTOM_LEVEL = 0.7; // готовые треки громче нашего синтезатора — чуть приглушаем
  // свои файлы: для меню и для матчей отдельно; buffer — раскодированный звук, name — для подписи
  const files = { menu: { buffer: null, name: null }, match: { buffer: null, name: null } };
  try {
    const saved = localStorage.getItem("arrowrush.menuTrack");
    if (saved && (MENU_TRACKS[saved] || saved === "off" || saved === "custom")) menuId = saved;
    if (localStorage.getItem("arrowrush.matchTrack") === "custom") matchId = "custom";
    files.menu.name = localStorage.getItem("arrowrush.menuTrackName");
    files.match.name = localStorage.getItem("arrowrush.matchTrackName");
  } catch { /* приватный режим */ }

  function padChord(t, notes, len, out) {
    for (const m of notes) {
      for (const det of [-8, 8]) { // две чуть расстроенные пилы — «широкий» пэд
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = freq(m);
        o.detune.value = det;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 850;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.02, t + len * 0.35);
        g.gain.linearRampToValueAtTime(0.0001, t + len * 1.05);
        o.connect(f).connect(g).connect(out);
        o.start(t);
        o.stop(t + len * 1.1);
      }
    }
  }

  /** Нота «электропиано»: синус с тихим обертоном, мягко затухает. */
  function keyNote(t, m, out, echo) {
    const g = ctx.createGain();
    env(g, t, 0.012, 0.075, 0.9);
    for (const [type, mul, lvl] of [["sine", 1, 1], ["triangle", 2, 0.22]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq(m) * mul;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 1.2);
    }
    g.connect(out);
    g.connect(echo);
  }

  function bell(t, m, out, echo) {
    const g = ctx.createGain();
    env(g, t, 0.005, 0.05, 1.6);
    for (const [mul, lvl] of [[1, 1], [2.76, 0.3]]) {
      const o = ctx.createOscillator();
      o.frequency.value = freq(m) * mul;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 1.8);
    }
    g.connect(out);
    g.connect(echo);
  }

  function subBass(t, m, len, out) {
    const o = ctx.createOscillator();
    o.frequency.value = freq(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.08);
    g.gain.setValueAtTime(0.13, t + len * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  function softKick(t, out) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    env(g, t, 0.004, 0.42, 0.3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.4);
  }

  /** Одна шестнадцатая меню-трека. */
  function menuStep(t, n) {
    const s = menuSong;
    const tr = s.track;
    const inBar = n % 16;
    const chord = tr.chords[Math.floor(n / 16) % tr.chords.length];

    if (inBar === 0) {
      padChord(t, chord, s.barLen, s.out);
      subBass(t, chord[0] - 12, s.barLen, s.out);
    }
    if (tr.drums) {
      if (inBar === 0 || inBar === (tr.drums === "lofi" ? 10 : 8)) softKick(t, s.out);
      if (tr.drums === "lofi" && (inBar === 4 || inBar === 12)) noiseHit(t, "lowpass", 3200, 0.12, 0.12, s.out);
      if (inBar % 2 === 0) noiseHit(t, "highpass", 8000, inBar % 4 === 2 ? 0.04 : 0.022, 0.03, s.out);
    }
    if (tr.keys && inBar % 2 === 0 && Math.random() < tr.keys) {
      keyNote(t, chord[1 + Math.floor(Math.random() * (chord.length - 1))] + 12, s.out, s.echo);
    }
    if (tr.bells && Math.random() < tr.bells) {
      const pent = [0, 2, 4, 7, 9];
      bell(t, chord[0] + 24 + pent[Math.floor(Math.random() * pent.length)], s.out, s.echo);
    }
  }

  function menuSchedule() {
    if (!menuSong) return;
    while (menuSong.next < ctx.currentTime + 0.15) {
      menuStep(menuSong.next, menuSong.step);
      menuSong.step++;
      menuSong.next += menuSong.stepLen;
    }
  }

  function startMenu() {
    if (!ctx || menuBus || menuId === "off") return;
    const out = ctx.createGain();
    menuBus = out;
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(MENU_LEVEL, ctx.currentTime + 2); // плавно проявляется
    out.connect(master);

    if (menuId === "custom") { playCustom(out); return; }

    const tr = MENU_TRACKS[menuId] || MENU_TRACKS.relax;
    const stepLen = 60 / tr.bpm / 4;
    // тёплое эхо: каждое повторение чуть глуше
    const echo = ctx.createDelay(1);
    echo.delayTime.value = stepLen * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2400;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    echo.connect(lp).connect(fb).connect(echo);
    echo.connect(wet).connect(out);

    menuSong = { track: tr, out, echo, stepLen, barLen: stepLen * 16, step: 0, next: ctx.currentTime + 0.1 };
    menuSchedule();
    menuTimer = setInterval(menuSchedule, 40);
  }

  function stopMenu(fade = 1) {
    clearInterval(menuTimer);
    menuTimer = 0;
    menuSong = null;
    if (!menuBus) return;
    const b = menuBus, src = menuSource;
    menuBus = null;
    menuSource = null;
    b.gain.cancelScheduledValues(ctx.currentTime);
    b.gain.setTargetAtTime(0, ctx.currentTime, fade / 4);
    setTimeout(() => {
      try { if (src) src.stop(); } catch { /* уже */ }
      b.disconnect();
    }, (fade + 0.3) * 1000);
  }

  /** Играть ли музыку меню (зовётся при каждой смене экрана). */
  function menu(on) {
    menuWanted = on;
    if (!ctx) return; // заиграет по первому нажатию — см. unlock()
    if (on) startMenu();
    else stopMenu();
  }

  function setMenuTrack(id) {
    menuId = id;
    try { localStorage.setItem("arrowrush.menuTrack", id); } catch { /* ничего */ }
    stopMenu(0.5);
    if (menuWanted) startMenu(); // старый трек гаснет, новый проявляется — плавная смена
  }

  // свой трек хранится в IndexedDB: в localStorage большой файл не поместится
  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("arrowrush", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function idbRequest(mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const q = fn(db.transaction("files", mode).objectStore("files"));
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  }

  /** Свой файл (kind — "menu" или "match"): из памяти, а если его там нет — из IndexedDB. null — файла нет. */
  async function loadFile(kind) {
    const f = files[kind];
    if (!f.buffer) {
      try {
        const rec = await idbRequest("readonly", (s) => s.get(kind + "Track"));
        if (rec) f.buffer = await ctx.decodeAudioData(await rec.blob.arrayBuffer());
      } catch { /* файла нет или браузер не даёт хранилище */ }
    }
    return f.buffer;
  }

  async function playCustom(out) {
    const buf = await loadFile("menu");
    if (menuBus !== out || !buf) return; // пока грузили, ушли с экрана меню
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(out);
    s.start();
    menuSource = s;
  }

  /** Свой файл для меню или матчей: проверяем, что он читается, сохраняем в браузере и включаем. */
  async function setCustomFile(file, kind = "menu") {
    unlock();
    const f = files[kind];
    f.buffer = await ctx.decodeAudioData(await file.arrayBuffer()); // бросит ошибку, если файл не аудио
    f.name = file.name.replace(/\.[^.]+$/, "") || "Свой трек";
    try { localStorage.setItem(`arrowrush.${kind}TrackName`, f.name); } catch { /* ничего */ }
    let saved = true;
    try { await idbRequest("readwrite", (s) => s.put({ name: f.name, blob: file }, kind + "Track")); } catch { saved = false; }
    if (kind === "menu") setMenuTrack("custom");
    else setMatchTrack("custom");
    return saved;
  }

  function setMatchTrack(id) {
    matchId = id;
    try { localStorage.setItem("arrowrush.matchTrack", id); } catch { /* ничего */ }
  }

  /** Подключить анализатор к общему выходу — для проверки громкости. */
  function tap() {
    unlock();
    const a = ctx.createAnalyser();
    a.fftSize = 2048;
    master.connect(a);
    return a;
  }

  return {
    unlock, start, stop, jingle, setMuted, tap,
    isMuted: () => muted, isPlaying: () => !!song,
    menu, setMenuTrack, setMatchTrack, setCustomFile,
    menuTracks: MENU_TRACKS, menuTrack: () => menuId, matchTrack: () => matchId,
    customName: (kind = "menu") => files[kind].name, isMenuPlaying: () => !!menuBus,
  };
})();
