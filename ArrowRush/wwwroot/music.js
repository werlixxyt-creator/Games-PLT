"use strict";

// Музыка для матчей: энергичный электронный бит, который синтезируется прямо в браузере (Web Audio),
// без файлов. Каждый матч — своя тональность и последовательность аккордов (от id матча).
// Во время отсчёта играет вступление без бочки, на «СТАРТ!» вступает полный бит.
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
    }
    if (ctx.state === "suspended") ctx.resume();
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

  function noiseHit(t, type, cutoff, peak, decay) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    env(g, t, 0.001, peak, decay);
    s.connect(f).connect(g).connect(bus);
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
    const b = bus;
    bus = null;
    b.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, fade / 4));
    setTimeout(() => b.disconnect(), (fade + 0.3) * 1000);
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

  /** Подключить анализатор к общему выходу — для проверки громкости. */
  function tap() {
    unlock();
    const a = ctx.createAnalyser();
    a.fftSize = 2048;
    master.connect(a);
    return a;
  }

  return { unlock, start, stop, jingle, setMuted, tap, isMuted: () => muted, isPlaying: () => !!song };
})();
