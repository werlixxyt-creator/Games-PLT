"use strict";

// Музыка игры, синтезируется прямо в браузере (Web Audio), без файлов.
// Матчи: трек с разделами, как в уровнях GD: дроп, затишье, нарастание, второй дроп.
// У каждого матча своя тональность, аккорды и мелодия (от id матча). Отсчёт — нарастание,
// на «СТАРТ!» сразу бьёт дроп. Трек следит за игрой: у ивентов уровня своё звучание (mood),
// а чем ближе финиш, тем он плотнее (progress); в самом конце — быстрее и на тон выше.
// Меню: спокойные треки по кругу. И в меню, и в матчах можно поставить свой файл игрока
// (он хранится в браузере — IndexedDB).
const music = (() => {
  let ctx = null;
  let master = null;    // общая громкость (и выключение звука)
  let bus = null;       // музыка текущего матча — её плавно гасим в конце
  let duck = null;      // бас и арпеджио «приседают» на каждую бочку
  let delay = null;     // эхо для арпеджио
  let noise = null;     // буфер белого шума для барабанов
  let tone = null;      // общий фильтр музыки матча: ивенты и ошибки делают её глуше
  let toneOpen = 20000; // на сколько он открыт сейчас, без учёта ошибки
  let moodNow = null;   // какой ивент звучит
  let meter = null;    // анализатор музыки матча: по нему сцена качается в такт
  let meterData = null;
  let meterAvg = 0;     // средняя громкость низов — удар считается от неё
  let timer = 0;
  let song = null;      // { bpm, root, chords, hook, step, next, part }
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

  // разделы трека в тактах; после последнего — снова по кругу
  const FORM = [["drop", 8], ["break", 2], ["build", 2], ["drop2", 8], ["verse", 4], ["build", 2]];
  const FORM_BARS = FORM.reduce((sum, p) => sum + p[1], 0);
  // ритмы мелодии на такт: 1 — нота
  const HOOK_RHYTHMS = [
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0],
    [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0],
  ];
  const PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17, 19];

  // звучание ивентов: раздел трека, темп, сдвиг в полутонах, фильтр; rate — скорость своего файла игрока
  const MOODS = {
    swam: { part: "drop2", tempo: 1, shift: 0, tone: 20000, rate: 1 },
    over: { part: "drop2", tempo: 1.14, shift: 1, tone: 20000, rate: 1.12 },
    storm: { part: "storm", tempo: 0.92, shift: 0, tone: 1100, rate: 0.94 },
    flip: { part: "flip", tempo: 1, shift: 0, tone: 3200, rate: 1 },
    rast: { part: "rast", tempo: 1.25, shift: 3, tone: 20000, rate: 1.2 },
    rainbow: { part: "rainbow", tempo: 1.08, shift: 2, tone: 20000, rate: 1.06 },
    cloud: { part: "cloud", tempo: 1.12, shift: 5, tone: 20000, rate: 1.08 },
  };
  const FINAL_AT = 0.85;      // с какой доли уровня начинается финал
  const FINAL_TEMPO = 1.06;
  const FINAL_SHIFT = 2;

  /** AudioContext создаём по нажатию игрока — иначе браузер не даст играть звук. */
  function unlock() {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : VOLUME;
      // трек матча плотный — компрессор не даёт ему перегружать выход
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -9;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.16;
      master.connect(limiter).connect(ctx.destination);
      tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = toneOpen;
      tone.connect(master);
      meter = ctx.createAnalyser();
      meter.fftSize = 1024;
      meter.smoothingTimeConstant = 0.35;
      meterData = new Uint8Array(meter.frequencyBinCount);

      noise =ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
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

  function kick(t, level = 1) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    env(g, t, 0.002, level, 0.28);
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

  function snare(t, level = 1) {
    noiseHit(t, "highpass", 1400, 0.55 * level, 0.16);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    env(g, t, 0.001, 0.35 * level, 0.09);
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

  /** Жирный аккорд или удар: у каждой ноты три расстроенные пилы. */
  function supersaw(t, notes, len, cutoff, peak) {
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    f.type = "lowpass";
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(300, cutoff * 0.35), t + len);
    env(g, t, 0.006, peak, len);
    f.connect(g);
    g.connect(duck);
    g.connect(delay);
    for (const midi of notes) {
      for (const cents of [-14, 0, 14]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = freq(midi);
        o.detune.value = cents;
        o.connect(f);
        o.start(t);
        o.stop(t + len + 0.05);
      }
    }
  }

  /** Качающийся бас дропа: фильтр открывается rate раз в секунду, снизу держит чистый синус. */
  function wobble(t, midi, len, rate) {
    const saw = ctx.createOscillator();
    const square = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const subGain = ctx.createGain();
    saw.type = "sawtooth";
    square.type = "square";
    sub.type = "sine";
    saw.frequency.value = freq(midi);
    square.frequency.value = freq(midi);
    square.detune.value = 9;
    sub.frequency.value = freq(midi);
    lfo.frequency.value = rate;
    depth.gain.value = 900;
    f.type = "lowpass";
    f.Q.value = 8;
    f.frequency.value = 1050;
    env(g, t, 0.006, 0.3, len);
    env(subGain, t, 0.006, 0.42, len);
    lfo.connect(depth).connect(f.frequency);
    saw.connect(f);
    square.connect(f);
    f.connect(g).connect(duck);
    sub.connect(subGain).connect(duck);
    for (const o of [saw, square, sub, lfo]) {
      o.start(t);
      o.stop(t + len + 0.05);
    }
  }

  /** Мелодия: две расстроенные пилы с быстрым затуханием. */
  function lead(t, midi, len) {
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    f.type = "lowpass";
    f.frequency.setValueAtTime(5200, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + len);
    env(g, t, 0.004, 0.13, len);
    f.connect(g);
    g.connect(duck);
    g.connect(delay);
    for (const cents of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq(midi);
      o.detune.value = cents;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.05);
    }
  }

  const crash = (t) => noiseHit(t, "highpass", 3500, 0.5, 1.5);

  /** Короткий взлёт шума перед «СТАРТ!». */
  function riser(t, len, out = bus) {
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
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + len + 0.1);
  }

  // ---------- Секвенсор ----------

  /** Какой раздел играет на шаге n: до нуля — нарастание под отсчёт. */
  function partAt(n) {
    if (n < 0) return { name: "intro", bar: Math.floor(n / 16), left: Math.ceil(-n / 16) };
    let bar = Math.floor(n / 16) % FORM_BARS;
    for (const [name, bars] of FORM) {
      if (bar < bars) return { name, bar, left: bars - bar };
      bar -= bars;
    }
    return { name: "drop", bar: 0, left: 8 };
  }

  /** Дробь малого барабана: чем ближе к концу нарастания, тем чаще и громче — но тише дропа, чтобы он ударил. */
  function roll(t, inBar, lastBar) {
    if (inBar % (lastBar ? 1 : 2) === 0) snare(t, (lastBar ? 0.3 : 0.14) + (inBar / 16) * 0.2);
  }

  /** Раздел с учётом игры: ивент и финал важнее того, что идёт по форме трека. */
  function partNow(n, s) {
    if (n >= 0 && s.mood) return { name: MOODS[s.mood].part, bar: 1, left: 8 };
    if (n >= 0 && s.final) return { name: "drop2", bar: 1, left: 8 };
    return partAt(n);
  }

  /** Темп с учётом ивента и финала. */
  function applyTempo(s) {
    const k = (s.mood ? MOODS[s.mood].tempo : 1) * (s.final ? FINAL_TEMPO : 1);
    s.stepLen = 60 / (s.bpm * k) / 4;
    delay.delayTime.setTargetAtTime(s.stepLen * 3, ctx.currentTime, 0.05);
  }

  /** Одна шестнадцатая: что в ней играет, задаёт раздел трека. */
  function playStep(t, n) {
    const s = song;
    const inBar = ((n % 16) + 16) % 16;
    const bar = Math.floor(n / 16);

    // ивент вступает по сильной доле, чтобы трек не сбивался
    if (s.nextMood !== undefined && inBar % 4 === 0) {
      s.mood = s.nextMood;
      s.nextMood = undefined;
      applyTempo(s);
      if (s.mood) {
        crash(t);
        s.part = MOODS[s.mood].part;
      }
    }

    const chord = s.chords[((bar % 4) + 4) % 4];
    const part = partNow(n, s);
    const beatLen = s.stepLen * 4;
    const root = s.root + (s.mood ? MOODS[s.mood].shift : 0) + (s.final ? FINAL_SHIFT : 0);
    const bassNote = root - 12 + chord;
    const triad = [0, 3, 7].map((d) => root + 12 + chord + d);
    const shape = [0, 3, 7, 12, 15, 12, 7, 3];
    const arpStep = ((n % 8) + 8) % 8;
    const arpNote = root + 12 + chord + shape[arpStep];
    const hookStep = ((n % 32) + 32) % 32;
    const hookNote = s.hook[hookStep] === null ? null : s.hook[hookStep] + root - s.root;
    if (inBar === 0) setTimeout(() => { if (song === s) s.part = part.name; }, Math.max(0, (t - ctx.currentTime) * 1000));

    if (part.name === "drop" || part.name === "drop2") {
      const second = part.name === "drop2";
      if (n >= 0 && part.bar === 0 && inBar === 0) crash(t);
      if (inBar % 4 === 0) kick(t);
      if (inBar === 14 && bar % 2 === 1) kick(t);
      if (inBar === 4 || inBar === 12) snare(t);
      if (part.left === 1 && inBar >= 12) snare(t);
      hat(t, inBar % 4 === 2);
      if (inBar % 8 === 0) wobble(t, bassNote, beatLen * 1.9, (s.bpm / 60) * (bar % 2 ? 4 : 2));
      if ([0, 3, 6, 10, 12].includes(inBar)) supersaw(t, triad, s.stepLen * 2.2, 5200, second ? 0.13 : 0.11);
      if (hookNote !== null) lead(t, hookNote + (second ? 12 : 0), s.stepLen * 2.4);
      // ближе к финишу вступает верхний слой, а в финале — дробь на каждую долю
      if (second || s.heat >= 0.5) arp(t, arpNote + 12, true);
      if (s.final && inBar % 2 === 1) hat(t, true);
    } else if (part.name === "cloud") {
      // кловд: цепкий ломаный бит и арпеджио, бегущее вверх-вниз, как гусеница по облакам
      if ([0, 3, 6, 10].includes(inBar)) kick(t);
      if (inBar === 4 || inBar === 12) snare(t, 0.9);
      hat(t, inBar % 2 === 1);
      if (inBar % 4 === 0) wobble(t, bassNote, beatLen * 0.9, (s.bpm / 60) * 3);
      arp(t, (n % 2 ? arpNote + 12 : arpNote + 24), true);
    } else if (part.name === "rainbow") {
      // радуга: задорный прыгающий ритм, мелодия октавой выше и верхнее арпеджио
      if (inBar % 4 === 0) kick(t);
      if (inBar === 4 || inBar === 12 || inBar === 14) snare(t, 0.8);
      hat(t, inBar % 4 === 2);
      if (inBar % 4 === 2) bass(t, bassNote + 12, s.stepLen * 1.6);
      arp(t, arpNote + 12, true);
      if (hookNote !== null) lead(t, hookNote + 12, s.stepLen * 2);
    } else if (part.name === "rast") {
      // погоня: бочка на каждую восьмую, дробь без остановки и рваный бас
      if (inBar % 2 === 0) kick(t, 0.9);
      snare(t, 0.22 + (inBar / 16) * 0.3);
      hat(t, inBar % 4 === 2);
      if (inBar % 4 === 0) wobble(t, bassNote, beatLen * 0.95, (s.bpm / 60) * 6);
      if (inBar % 2 === 0) arp(t, arpNote + 12, true);
      if ([0, 3, 6, 8, 11, 14].includes(inBar)) supersaw(t, triad, s.stepLen * 1.5, 6000, 0.1);
    } else if (part.name === "storm") {
      // шторм: тяжёлый медленный бас и редкие удары
      if (inBar === 0) supersaw(t, triad.map((m) => m - 12), beatLen * 3.8, 800, 0.12);
      if (inBar === 0 || inBar === 10) kick(t);
      if (inBar === 8) snare(t, 0.7);
      if (inBar % 8 === 0) wobble(t, bassNote, beatLen * 1.9, s.bpm / 60);
      if (inBar % 8 === 6) hat(t, true);
    } else if (part.name === "flip") {
      // переворот: всё задом наперёд — арпеджио и мелодия идут обратно, бит вдвое реже
      if (inBar === 0 || inBar === 6) kick(t);
      if (inBar === 8) snare(t);
      hat(t, inBar % 4 === 2);
      arp(t, root + 24 + chord + shape[7 - arpStep], true);
      const back = s.hook[31 - hookStep];
      if (back !== null) lead(t, back + root - s.root, s.stepLen * 2);
    } else if (part.name === "verse") {
      if (inBar === 0 || inBar === 8 || inBar === 10 || (s.heat >= 0.35 && inBar === 4)) kick(t);
      if (inBar === 4 || inBar === 12) snare(t);
      if (inBar % 4 === 2) bass(t, bassNote, s.stepLen * 1.6);
      hat(t, inBar % 4 === 2);
      arp(t, arpNote, true);
      if (hookNote !== null && bar % 2 === 1) lead(t, hookNote, s.stepLen * 2);
    } else if (part.name === "break") {
      // затишье: бочка уходит, остаются аккорд и приглушённое арпеджио
      if (inBar === 0) supersaw(t, triad, beatLen * 3.6, 1100, 0.11);
      if (inBar % 4 === 2) hat(t, false);
      arp(t, arpNote, false);
    } else {
      // нарастание и отсчёт: дробь, бочка четвертями, в самом конце — вдох перед дропом
      const lastBar = part.left === 1;
      if (inBar === 0 && part.left === (part.name === "build" ? 2 : 1)) riser(t, s.stepLen * 16 * part.left - s.stepLen * 2);
      if (!(lastBar && inBar >= 14)) {
        roll(t, inBar, lastBar);
        if (inBar % (lastBar ? 2 : 4) === 0) kick(t, 0.45);
        hat(t, false);
        arp(t, arpNote, lastBar);
      }
    }
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
    bus.connect(tone);
    bus.connect(meter);
    moodNow = null;
    toneOpen = 20000;
    tone.frequency.cancelScheduledValues(ctx.currentTime);
    tone.frequency.setValueAtTime(toneOpen, ctx.currentTime);
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

  /** Мелодия на два такта: один из ритмов и ход по пентатонике; null — пауза. */
  function buildHook(seed, root) {
    let r = seed % 233280;
    const next = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    const hook = [];
    let at = 4;
    for (let bar = 0; bar < 2; bar++) {
      const rhythm = HOOK_RHYTHMS[Math.floor(next() * HOOK_RHYTHMS.length)];
      for (const on of rhythm) {
        if (!on) { hook.push(null); continue; }
        at = Math.min(PENTATONIC.length - 1, Math.max(0, at + Math.round((next() - 0.5) * 5)));
        hook.push(root + 24 + PENTATONIC[at]);
      }
    }
    return hook;
  }

  /** Встроенный трек матча: тональность, аккорды и мелодия — от seed. */
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

    const bpm = fast ? 174 : 160;
    const stepLen = 60 / bpm / 4;
    delay.delayTime.value = stepLen * 3; // эхо на точку-восьмую

    // шаг 0 — ровно «СТАРТ!»: отсчёт идёт отрицательными шагами
    const dropAt = ctx.currentTime + 0.06 + introSeconds;
    const steps = Math.floor(introSeconds / stepLen);
    const root = 45 + (seed % 7);                     // тоника от A2 до D#3
    song = {
      bpm,
      stepLen,
      root,
      chords: PROGRESSIONS[Math.floor(seed / 7) % PROGRESSIONS.length],
      hook: buildHook(seed, root),
      step: -steps,
      next: dropAt - steps * stepLen,
      part: "intro",
      mood: null,        // какой ивент уже звучит; nextMood — какой вступит на следующей доле
      nextMood: undefined,
      heat: 0,           // пройденная доля уровня
      final: false,
    };
    schedule();
    timer = setInterval(schedule, 25);
  }

  /**
   * Сила удара в музыке матча, 0..1: насколько низы сейчас громче своего среднего.
   * Сцена качается по этому числу; работает и со своим файлом игрока. Вызывать раз в кадр.
   */
  function energy() {
    if (!bus || !meter) return 0;
    meter.getByteFrequencyData(meterData);
    const bins = 5; // до ~230 Гц
    let sum = 0;
    for (let i = 0; i < bins; i++) sum += meterData[i];
    const v = sum / bins / 255;
    const onset = Math.max(0, v - meterAvg);
    meterAvg += (v - meterAvg) * 0.08;
    return Math.min(1, onset * 3.5);
  }

  /** Какой ивент сейчас на уровне (null — никакого). Встроенный трек меняет раздел, свой файл игрока — скорость и фильтр. */
  function mood(name) {
    if (!ctx || !bus || name === moodNow) return;
    moodNow = name;
    const m = name ? MOODS[name] : null;
    toneOpen = m ? m.tone : 20000;
    tone.frequency.setTargetAtTime(toneOpen, ctx.currentTime, 0.12);
    if (song) song.nextMood = name;
    if (matchSource) matchSource.playbackRate.setTargetAtTime(m ? m.rate : 1, ctx.currentTime, 0.15);
  }

  /** Какая доля уровня пройдена, 0..1: от неё зависит плотность трека. Вызывать раз в кадр. */
  function progress(k) {
    if (!song) return;
    song.heat = k;
    if (k >= FINAL_AT && !song.final) {
      song.final = true;
      applyTempo(song);
    }
  }

  function boom(t, out, peak) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.5);
    env(g, t, 0.003, peak, 1);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 1.1);
  }

  function sweep(t, from, to, len, out) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + len);
    env(g, t, 0.01, 0.14, len);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  /** Звук начала ивента поверх музыки; thunder — гром от молнии, devour — дыра поглотила игрока. */
  function sting(kind) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + 0.01;
    if (kind === "thunder") {
      noiseHit(t, "lowpass", 420, 0.75, 1.3, master);
      return;
    }
    if (kind === "devour") {
      sweep(t, 900, 30, 0.9, master);
      boom(t + 0.8, master, 1);
      return;
    }
    if (kind === "laser") {
      sweep(t, 2400, 260, 0.14, master);
      return;
    }
    if (kind === "hop") {
      sweep(t, 500, 1500, 0.08, master);
      return;
    }
    if (kind === "dodge") {
      noiseHit(t, "highpass", 2600, 0.3, 0.16, master);
      return;
    }
    if (kind === "brick") {
      noiseHit(t, "bandpass", 900, 0.5, 0.09, master);
      return;
    }
    if (kind === "wallBroken") {
      noiseHit(t, "lowpass", 1200, 0.8, 0.5, master);
      boom(t, master, 0.5);
      return;
    }
    boom(t, master, 0.7);
    noiseHit(t, "highpass", 3000, 0.4, 1.4, master);
    if (kind === "swam") sweep(t, 180, 1400, 0.7, master);
    else if (kind === "over") sweep(t, 300, 2400, 0.35, master);
    else if (kind === "storm") noiseHit(t, "lowpass", 420, 0.75, 1.6, master);
    else if (kind === "cloud") {
      noiseHit(t, "bandpass", 700, 0.7, 0.9, master);
      sweep(t, 200, 2600, 0.5, master);
      sweep(t + 0.12, 300, 3600, 0.5, master);
    } else if (kind === "rainbow") {
      sweep(t, 500, 2000, 0.3, master);
      sweep(t + 0.15, 750, 3000, 0.3, master);
    } else if (kind === "rast") {
      boom(t + 0.12, master, 0.9);
      sweep(t, 90, 40, 1.2, master);
    } else if (kind === "flip") {
      sweep(t, 1400, 120, 0.4, master);
      sweep(t + 0.4, 120, 1400, 0.4, master);
    }
  }

  /** Заполненный ползунок: нота в тональности трека, серия ползунков поднимается по гамме. */
  function ding(i) {
    if (!ctx || muted) return;
    const root = song ? song.root : 45;
    const midi = root + 24 + PENTATONIC[i % PENTATONIC.length];
    const t = ctx.currentTime + 0.005;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = freq(midi);
    env(g, t, 0.003, 0.2, 0.16);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.22);
  }

  /** Ошибка: глухой удар вниз. */
  function miss() {
    if (!ctx || muted) return;
    const t = ctx.currentTime + 0.005;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.16);
    env(g, t, 0.003, 0.22, 0.18);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.24);

    // на миг музыка глохнет, как от удара
    if (!bus) return;
    tone.frequency.cancelScheduledValues(t);
    tone.frequency.setTargetAtTime(600, t, 0.01);
    tone.frequency.setTargetAtTime(toneOpen, t + 0.1, 0.12);
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

  /** Сцена победы: нарастание, через impact секунд — удар баса с тарелкой и мажорный аккорд, за ним взлёт нот. */
  function fanfare(impact) {
    if (!ctx) return;
    const out = ctx.createGain();
    out.connect(master);
    const t = ctx.currentTime + impact;
    riser(ctx.currentTime, impact, out);
    noiseHit(t, "highpass", 3500, 0.5, 2.2, out);

    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.frequency.setValueAtTime(140, t);
    boom.frequency.exponentialRampToValueAtTime(36, t + 0.5);
    env(boomGain, t, 0.003, 0.9, 1);
    boom.connect(boomGain).connect(out);
    boom.start(t);
    boom.stop(t + 1.1);

    for (const m of [48, 60, 67, 72, 76, 79]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.value = freq(m);
      env(g, t, 0.01, 0.08, 2.6);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 2.7);
    }
    [84, 88, 91, 96].forEach((m, i) => {
      const at = t + 0.3 + i * 0.1;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = freq(m);
      env(g, at, 0.005, 0.1, i === 3 ? 1.3 : 0.25);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + 1.4);
    });
    setTimeout(() => out.disconnect(), (impact + 3.5) * 1000);
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
    unlock, start, stop, jingle, fanfare, setMuted, tap, energy, ding, miss, mood, progress, sting,
    isMuted: () => muted, isPlaying: () => !!song, part: () => (song ? song.part : null),
    menu, setMenuTrack, setMatchTrack, setCustomFile,
    menuTracks: MENU_TRACKS, menuTrack: () => menuId, matchTrack: () => matchId,
    customName: (kind = "menu") => files[kind].name, isMenuPlaying: () => !!menuBus,
  };
})();
