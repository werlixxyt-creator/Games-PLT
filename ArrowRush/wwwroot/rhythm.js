"use strict";

// Режим «Свой трек»: ритм-уровень из музыкального файла игрока.
// Всё происходит в браузере — файл никуда не загружается.
// Удары ищем по резким всплескам громкости в трёх полосах частот (бочка, малый барабан, тарелки)
// и на каждый ставим стрелку; стрелки падают к линии и нажимаются в момент удара.
const rhythm = (() => {
  const $ = (id) => document.getElementById(id);
  const css = getComputedStyle(document.documentElement);
  const COLORS = [0, 1, 2, 3].map((i) => css.getPropertyValue("--a" + i).trim());
  const OUTLINE = css.getPropertyValue("--outline").trim() || "#1d1340";
  // стрелки: 0 ← 1 ↑ 2 → 3 ↓; символ смотрит вверх
  const ROT = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  const ARROW = new Path2D("M12 3 L21 13 H15.5 V21 H8.5 V13 H3 Z");
  const LANES = [0, 3, 1, 2]; // дорожки слева направо: ← ↓ ↑ →

  // анализ звука: частота пересчёта и окно, в котором меряем громкость
  const SR = 22050;
  const HOP = 256;
  const WIN = 512;
  const FRAME = HOP / SR; // ≈ 11.6 мс

  // окна попадания (секунды от удара) и награды за них
  const JUDGE = [
    { max: 0.05, name: "Идеально", cls: "perfect", score: 300, acc: 1 },
    { max: 0.1, name: "Хорошо", cls: "good", score: 100, acc: 0.7 },
    { max: 0.15, name: "Норм", cls: "ok", score: 50, acc: 0.4 },
  ];
  const MISS_AFTER = 0.15;
  const LEAD_IN = 2.4; // секунд до начала музыки — успеть приготовиться

  // сложность: насколько удар должен выделяться, минимальный промежуток между стрелками, время падения
  const DIFF = {
    easy: { name: "Лёгкая", thr: 1.9, gap: 0.42, approach: 1.9 },
    normal: { name: "Нормальная", thr: 1.5, gap: 0.25, approach: 1.5 },
    hard: { name: "Сложная", thr: 1.22, gap: 0.14, approach: 1.15 },
  };

  let opts = null;          // { show, difficulty, back } из app.js
  let audio = null;         // AudioContext
  let buffer = null;        // раскодированный трек
  let analysis = null;      // огибающая ударов — по ней быстро пересобираем уровень при смене сложности
  let track = "";
  let diffName = "normal";
  let notes = [];
  let offsetMs = 0;
  try { offsetMs = Number(localStorage.getItem("arrowrush.rhythm.offset")) || 0; } catch { /* приватный режим */ }

  // игра
  let source = null, gain = null, startAt = 0, endAt = 0, running = false;
  let head = 0;             // первая стрелка, которая ещё может быть на экране или не оценена
  let score = 0, combo = 0, maxCombo = 0, accSum = 0, judged = 0;
  let counts = { perfect: 0, good: 0, ok: 0, miss: 0 };
  const flash = [0, 0, 0, 0];   // когда последний раз нажимали дорожку (для подсветки)
  const pressed = [false, false, false, false];

  // ---------- Анализ трека ----------

  /** Громкость трека в одной полосе частот, кадр за кадром. */
  async function bandEnergy(buf, filters) {
    const ctx = new OfflineAudioContext(1, Math.ceil(buf.duration * SR), SR);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let node = src;
    for (const f of filters) {
      const b = ctx.createBiquadFilter();
      b.type = f.type;
      b.frequency.value = f.freq;
      if (f.q) b.Q.value = f.q;
      node.connect(b);
      node = b;
    }
    node.connect(ctx.destination);
    src.start();
    const data = (await ctx.startRendering()).getChannelData(0);

    const n = Math.max(0, Math.floor((data.length - WIN) / HOP));
    const e = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const o = i * HOP;
      for (let j = 0; j < WIN; j++) s += data[o + j] * data[o + j];
      e[i] = Math.sqrt(s / WIN);
    }
    return e;
  }

  /** Насколько громкость выросла по сравнению с прошлым кадром; нормировано, чтобы полосы весили одинаково. */
  function flux(e) {
    const out = new Float32Array(e.length);
    let mean = 0;
    for (let i = 1; i < e.length; i++) {
      out[i] = Math.max(0, e[i] - e[i - 1]);
      mean += out[i];
    }
    mean = mean / out.length || 1;
    for (let i = 0; i < out.length; i++) out[i] /= mean;
    return out;
  }

  /** Темп по автокорреляции огибающей: на каком сдвиге (70–180 BPM) удары сильнее всего совпадают. */
  function tempo(env) {
    const minLag = Math.round(60 / 180 / FRAME);
    const maxLag = Math.round(60 / 70 / FRAME);
    const n = Math.min(env.length, Math.round(90 / FRAME)); // первых полутора минут хватает
    let best = 0, bestLag = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
      if (s > best) { best = s; bestLag = lag; }
    }
    return Math.round(60 / (bestLag * FRAME));
  }

  async function analyze(buf) {
    const bands = (await Promise.all([
      bandEnergy(buf, [{ type: "lowpass", freq: 150 }]),               // бочка, бас
      bandEnergy(buf, [{ type: "bandpass", freq: 1200, q: 0.7 }]),     // малый барабан, вокал
      bandEnergy(buf, [{ type: "highpass", freq: 6000 }]),             // тарелки, хэты
    ])).map(flux);

    const n = Math.min(...bands.map((b) => b.length));
    const weight = [1, 0.8, 0.5];
    const env = new Float32Array(n);
    const band = new Uint8Array(n);   // какая полоса сильнее всего ударила в этом кадре
    for (let i = 0; i < n; i++) {
      const v = bands.map((b, k) => b[i] * weight[k]);
      env[i] = v[0] + v[1] + v[2];
      band[i] = v[0] >= v[1] && v[0] >= v[2] ? 0 : v[1] >= v[2] ? 1 : 2;
    }
    const pre = new Float64Array(n + 1); // префиксные суммы — для среднего по окну
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + env[i];
    return { env, band, pre, bpm: tempo(env) };
  }

  /** Повторяемый генератор случайных чисел: один и тот же трек — один и тот же уровень. */
  function rng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Удары → стрелки: пики огибающей, заметно выше среднего вокруг, не чаще минимального промежутка. */
  function buildNotes(an, diff) {
    const d = DIFF[diff];
    const { env, band, pre } = an;
    const W = Math.round(0.5 / FRAME); // среднее берём по ±0.5 с
    const L = 3;                       // пик должен быть выше соседей на ±35 мс
    const peaks = [];

    for (let i = L; i < env.length - L; i++) {
      const v = env[i];
      let top = true;
      for (let k = 1; k <= L && top; k++) top = env[i - k] <= v && env[i + k] < v;
      if (!top) continue;

      const a = Math.max(0, i - W), b = Math.min(env.length, i + W + 1);
      const mean = (pre[b] - pre[a]) / (b - a);
      if (v < mean * d.thr + 0.3) continue;

      const t = i * FRAME + WIN / 2 / SR;
      const last = peaks[peaks.length - 1];
      if (last && t - last.t < d.gap) {
        // слишком близко к прошлой — оставляем более сильный удар
        if (v > last.v) Object.assign(last, { t, v, band: band[i] });
        continue;
      }
      peaks.push({ t, v, band: band[i] });
    }

    // бочка чаще уходит на ← →, малый барабан — на ↓ ↑, тарелки — куда угодно
    const pools = [[0, 2], [3, 1], [0, 1, 2, 3]];
    const rand = rng(Math.round(buffer.duration * 1000) + peaks.length);
    let prev = -1, prev2 = -1;
    return peaks.map((p) => {
      const pool = rand() < 0.7 ? pools[p.band] : pools[2];
      let lane = pool[Math.floor(rand() * pool.length)];
      // не больше двух одинаковых подряд
      if (lane === prev && lane === prev2) lane = (lane + 1 + Math.floor(rand() * 3)) % 4;
      prev2 = prev;
      prev = lane;
      return { t: p.t, lane, judged: null };
    });
  }

  // ---------- Панель: загрузка, готовность, итоги ----------

  const panel = () => $("rh-panel");

  function showPanel(html) {
    const el = panel();
    el.innerHTML = html;
    el.hidden = false;
  }

  function showLoading(text) {
    showPanel(`<div class="rh-card"><div class="rh-spin" aria-hidden="true"><i></i><i></i><i></i><i></i></div><p class="rh-meta"></p></div>`);
    panel().querySelector(".rh-meta").textContent = text;
  }

  function showError(text) {
    showPanel(`
      <div class="rh-card">
        <div class="rh-icon bad" aria-hidden="true">!</div>
        <p class="rh-error"></p>
        <div class="rh-buttons">
          <button class="btn primary" data-action="pick">Выбрать другой трек</button>
          <button class="btn ghost" data-action="back">Назад</button>
        </div>
      </div>`);
    panel().querySelector(".rh-error").textContent = text;
  }

  function fmtTime(sec) {
    const s = Math.round(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function bestKey() {
    return `arrowrush.rhythm.best:${track}:${Math.round(buffer.duration)}:${diffName}`;
  }

  function loadBest() {
    try { return Number(localStorage.getItem(bestKey())) || 0; } catch { return 0; }
  }

  function showReady() {
    const best = loadBest();
    showPanel(`
      <div class="rh-card">
        <div class="rh-icon" aria-hidden="true">♪</div>
        <h3 class="rh-track"></h3>
        <p class="rh-meta">≈ ${analysis.bpm} BPM · ${notes.length} стрелок · ${fmtTime(buffer.duration)}</p>
        <div class="rh-diffs" role="radiogroup" aria-label="Сложность">
          ${Object.entries(DIFF).map(([id, d]) => `<button class="rh-diff${id === diffName ? " on" : ""}" data-diff="${id}" role="radio" aria-checked="${id === diffName}">${d.name}</button>`).join("")}
        </div>
        <label class="rh-offset">
          <span>Сдвиг стрелок: <b id="rh-offset-val">${offsetMs > 0 ? "+" : ""}${offsetMs} мс</b></span>
          <input id="rh-offset" type="range" min="-250" max="250" step="10" value="${offsetMs}">
          <small>Стрелки приходят раньше бита — двигай вправо, позже — влево</small>
        </label>
        <p class="rh-best">${best ? `Рекорд: <b>${best.toLocaleString("ru-RU")}</b>` : "Рекорда пока нет"}</p>
        <div class="rh-buttons">
          <button class="btn primary big" data-action="start"><span>Играть</span><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#arrow"/></svg></button>
          <button class="btn ghost" data-action="pick">Другой трек</button>
          <button class="btn ghost" data-action="back">Назад</button>
        </div>
      </div>`);
    panel().querySelector(".rh-track").textContent = track;
    $("rh-offset").addEventListener("input", (e) => {
      offsetMs = Number(e.target.value);
      try { localStorage.setItem("arrowrush.rhythm.offset", offsetMs); } catch { /* ничего */ }
      $("rh-offset-val").textContent = `${offsetMs > 0 ? "+" : ""}${offsetMs} мс`;
    });
  }

  function grade(acc, misses) {
    if (acc >= 0.95 && misses === 0) return "S";
    if (acc >= 0.9) return "A";
    if (acc >= 0.8) return "B";
    if (acc >= 0.65) return "C";
    return "D";
  }

  function showResults() {
    const acc = judged ? accSum / judged : 0;
    const g = grade(acc, counts.miss);
    const final = Math.round(score);
    const best = loadBest();
    const record = final > best;
    if (record) { try { localStorage.setItem(bestKey(), final); } catch { /* ничего */ } }

    showPanel(`
      <div class="rh-card results">
        <div class="rh-grade g-${g}">${g}</div>
        <h3 class="rh-track"></h3>
        <p class="rh-meta">${DIFF[diffName].name} · ${notes.length} стрелок</p>
        ${record ? `<p class="rh-record">Новый рекорд!</p>` : best ? `<p class="rh-best">Рекорд: <b>${best.toLocaleString("ru-RU")}</b></p>` : ""}
        <div class="rh-sum">
          <div><b>${final.toLocaleString("ru-RU")}</b><span>счёт</span></div>
          <div><b>${Math.round(acc * 100)}%</b><span>точность</span></div>
          <div><b>${maxCombo}</b><span>макс. комбо</span></div>
        </div>
        <div class="rh-counts">
          <span class="perfect">Идеально <b>${counts.perfect}</b></span>
          <span class="good">Хорошо <b>${counts.good}</b></span>
          <span class="ok">Норм <b>${counts.ok}</b></span>
          <span class="miss">Мимо <b>${counts.miss}</b></span>
        </div>
        <div class="rh-buttons">
          <button class="btn primary big" data-action="start"><span>Ещё раз</span><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#arrow"/></svg></button>
          <button class="btn ghost" data-action="pick">Другой трек</button>
          <button class="btn ghost" data-action="back">В меню</button>
        </div>
      </div>`);
    panel().querySelector(".rh-track").textContent = track;

    // праздник — за отличную игру или за побитый прошлый рекорд (первый результат рекордом не считаем)
    if (g === "S" || g === "A" || (record && best > 0)) {
      fx.confetti(140);
      const [x, y] = fx.anchor(panel().querySelector(".rh-grade"));
      fx.arrowsFrom(x, y, 24);
    }
  }

  // кнопки на панели — одним обработчиком
  function onPanelClick(e) {
    const diffBtn = e.target.closest("[data-diff]");
    if (diffBtn) {
      if (diffBtn.dataset.diff === diffName) return;
      diffName = diffBtn.dataset.diff;
      notes = buildNotes(analysis, diffName);
      showReady();
      return;
    }
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "start") start();
    else if (action === "pick") $("rh-file").click();
    else if (action === "back") { stop(); opts.back(); }
  }

  // ---------- Загрузка файла ----------

  async function open(file) {
    stop();
    opts.show("rhythm");
    track = file.name.replace(/\.[^.]+$/, "") || "Без названия";
    $("rh-title").textContent = track;
    resetHud();

    if (file.size > 80 * 1024 * 1024) return showError("Файл больше 80 МБ — выбери трек поменьше.");

    try {
      showLoading("Загружаем трек…");
      audio = audio || new AudioContext();
      buffer = await audio.decodeAudioData(await file.arrayBuffer());
    } catch {
      return showError("Не получилось прочитать файл. Подойдут mp3, ogg, wav или m4a.");
    }
    if (buffer.duration < 10) return showError("Трек слишком короткий — нужно хотя бы 10 секунд.");

    showLoading("Слушаем трек и ищем бит…");
    await new Promise((r) => setTimeout(r, 30)); // дать экрану нарисоваться до тяжёлых вычислений
    analysis = await analyze(buffer);
    diffName = opts.difficulty();
    notes = buildNotes(analysis, diffName);
    if (notes.length < 8) return showError("В треке почти не нашлось ударов. Попробуй музыку с чётким битом.");
    showReady();
  }

  // ---------- Игра ----------

  function resetHud() {
    score = combo = maxCombo = accSum = judged = 0;
    counts = { perfect: 0, good: 0, ok: 0, miss: 0 };
    $("rh-score").textContent = "0";
    $("rh-combo").textContent = "0";
    $("rh-acc").textContent = "100%";
    $("rh-judge").textContent = "";
    $("rh-progress").firstElementChild.style.width = "0%";
  }

  async function start() {
    if (!buffer) return;
    stop();
    await audio.resume();
    resetHud();
    for (const n of notes) n.judged = null;
    head = 0;

    gain = audio.createGain();
    gain.connect(audio.destination);
    source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    startAt = audio.currentTime + LEAD_IN;
    source.start(startAt);
    // уровень кончается через пару секунд после последней стрелки — длинное затихание ждать не нужно
    endAt = Math.min(buffer.duration, (notes.length ? notes[notes.length - 1].t : 0) + 2.5);

    panel().hidden = true;
    running = true;
    requestAnimationFrame(frame);
  }

  /** Время песни с учётом задержки звука в системе и ручного сдвига. */
  function songTime() {
    return audio.currentTime - startAt - (audio.outputLatency || audio.baseLatency || 0) - offsetMs / 1000;
  }

  function stop() {
    running = false;
    if (source) {
      try { source.stop(); } catch { /* ещё не стартовал или уже остановлен */ }
      source.disconnect();
      source = null;
    }
  }

  function finish() {
    running = false;
    // музыка плавно стихает
    if (gain && source) {
      gain.gain.setTargetAtTime(0, audio.currentTime, 0.25);
      const s = source;
      source = null;
      setTimeout(() => { try { s.stop(); } catch { /* уже */ } }, 1200);
    }
    showResults();
  }

  function updateHud() {
    $("rh-score").textContent = Math.round(score).toLocaleString("ru-RU");
    $("rh-combo").textContent = combo;
    $("rh-acc").textContent = `${judged ? Math.round((accSum / judged) * 100) : 100}%`;
  }

  /** Надпись над линией: «Идеально», «Хорошо · рано», «Мимо». */
  function showJudge(text, cls, hint) {
    const el = $("rh-judge");
    el.className = `rh-judge ${cls}`;
    el.innerHTML = "";
    el.append(text);
    if (hint) {
      const s = document.createElement("small");
      s.textContent = hint;
      el.append(s);
    }
    fx.retrigger(el, "pop");
  }

  function laneGeometry() {
    const canvas = $("rh-canvas");
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const laneW = Math.min(120, w / 4.4);
    return { w, h, laneW, x0: (w - laneW * 4) / 2, hitY: h * 0.84 };
  }

  function hit(n, d) {
    const j = JUDGE.find((x) => Math.abs(d) <= x.max);
    n.judged = j.cls;
    combo++;
    maxCombo = Math.max(maxCombo, combo);
    score += j.score * (1 + Math.min(combo, 100) / 100); // комбо до +100% к очкам
    accSum += j.acc;
    judged++;
    counts[j.cls]++;
    showJudge(j.name, j.cls, j.cls === "perfect" ? "" : d < 0 ? "рано" : "поздно");

    // искры над рецептором дорожки
    const g = laneGeometry();
    const r = $("rh-canvas").getBoundingClientRect();
    const k = LANES.indexOf(n.lane);
    fx.burst(r.left + g.x0 + (k + 0.5) * g.laneW, r.top + g.hitY, COLORS[n.lane], j.cls === "perfect" ? 22 : 12, j.cls === "perfect" ? 1 : 0.7);
    if (combo > 0 && combo % 50 === 0) fx.ring(r.left + g.w / 2, r.top + g.hitY, COLORS[3], 220, 5);
    updateHud();
  }

  function miss(n) {
    n.judged = "miss";
    combo = 0;
    judged++;
    counts.miss++;
    showJudge("Мимо", "miss");
    updateHud();
  }

  /** Нажали дорожку: ближайшая неоценённая стрелка в ней в пределах окна попадания. */
  function press(lane) {
    pressed[lane] = true;
    flash[lane] = performance.now();
    if (!running) return;
    const t = songTime();
    let best = null, bestD = Infinity;
    for (let i = head; i < notes.length; i++) {
      const n = notes[i];
      const d = t - n.t;
      if (d < -MISS_AFTER) break; // дальше только будущие стрелки
      if (n.judged || n.lane !== lane || Math.abs(d) > MISS_AFTER) continue;
      if (Math.abs(d) < Math.abs(bestD)) { best = n; bestD = d; }
    }
    if (best) hit(best, bestD);
  }

  function release(lane) {
    pressed[lane] = false;
  }

  // ---------- Отрисовка ----------

  function ensureSize(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return dpr;
  }

  /** Квадратная «клавиша» со стрелкой: падающая стрелка или рецептор на линии удара. */
  function drawKey(ctx, x, y, s, lane, kind, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.22);
    if (kind === "note") {
      ctx.fillStyle = COLORS[lane];
      ctx.fill();
      ctx.lineWidth = Math.max(3, s * 0.06);
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    } else {
      ctx.fillStyle = kind === "down" ? COLORS[lane] : "rgba(255, 255, 255, .06)";
      ctx.fill();
      ctx.lineWidth = Math.max(3, s * 0.05);
      ctx.strokeStyle = kind === "down" ? "#fff" : COLORS[lane];
      ctx.stroke();
    }
    ctx.rotate(ROT[lane]);
    const a = s * 0.56;
    ctx.scale(a / 24, a / 24);
    ctx.translate(-12, -12);
    ctx.fillStyle = kind === "idle" ? COLORS[lane] : OUTLINE;
    ctx.fill(ARROW);
    ctx.restore();
  }

  function draw(t) {
    const canvas = $("rh-canvas");
    const dpr = ensureSize(canvas);
    const ctx = canvas.getContext("2d");
    const { w, h, laneW, x0, hitY } = laneGeometry();
    const approach = DIFF[diffName].approach;
    const now = performance.now();
    const keyS = laneW * 0.76;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // дорожки; нажатая — подсвечена своим цветом
    for (let k = 0; k < 4; k++) {
      const lane = LANES[k];
      const x = x0 + k * laneW;
      ctx.fillStyle = k % 2 ? "rgba(255, 255, 255, .035)" : "rgba(255, 255, 255, .06)";
      ctx.fillRect(x, 0, laneW, h);
      const glow = pressed[lane] ? 1 : Math.max(0, 1 - (now - flash[lane]) / 220);
      if (glow > 0) {
        ctx.globalAlpha = 0.18 * glow;
        ctx.fillStyle = COLORS[lane];
        ctx.fillRect(x, 0, laneW, h);
        ctx.globalAlpha = 1;
      }
    }
    // линия удара
    ctx.fillStyle = "rgba(255, 255, 255, .5)";
    ctx.fillRect(x0, hitY - 1.5, laneW * 4, 3);

    for (let k = 0; k < 4; k++) {
      const lane = LANES[k];
      drawKey(ctx, x0 + (k + 0.5) * laneW, hitY, keyS, lane, pressed[lane] ? "down" : "idle");
    }

    // падающие стрелки; оценённые попадания исчезают, промахи гаснут и уходят вниз
    for (let i = head; i < notes.length; i++) {
      const n = notes[i];
      const dy = (n.t - t) / approach;
      if (dy > 1.05) break;
      if (n.judged && n.judged !== "miss") continue;
      const y = hitY - dy * hitY;
      if (y > h + keyS) continue;
      const k = LANES.indexOf(n.lane);
      drawKey(ctx, x0 + (k + 0.5) * laneW, y, keyS, n.lane, "note", n.judged === "miss" ? 0.3 : 1);
    }

    // отсчёт до начала музыки
    if (t < 0) {
      const sec = Math.ceil(-t);
      ctx.font = `900 ${Math.round(Math.min(w, h) * 0.22)}px Unbounded, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 10;
      ctx.strokeStyle = OUTLINE;
      ctx.fillStyle = COLORS[3];
      const label = sec > 0 && -t > 0.4 ? String(sec) : "ИГРАЙ!";
      ctx.strokeText(label, w / 2, h * 0.42);
      ctx.fillText(label, w / 2, h * 0.42);
    }
  }

  function frame() {
    if (!running) return;
    const t = songTime();

    // стрелки, которые проехали линию, — промах
    for (let i = head; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > t - MISS_AFTER) break;
      if (!n.judged) miss(n);
    }
    // далеко ушедшие вниз больше не рисуем и не проверяем
    const approach = DIFF[diffName].approach;
    while (head < notes.length && notes[head].judged && notes[head].t < t - approach * 0.3) head++;

    draw(t);
    $("rh-progress").firstElementChild.style.width = `${Math.min(100, Math.max(0, (t / endAt) * 100))}%`;

    if (t >= endAt) return finish();
    requestAnimationFrame(frame);
  }

  function init(o) {
    opts = o;
    panel().addEventListener("click", onPanelClick);
    $("rh-leave").addEventListener("click", () => { stop(); opts.back(); });
  }

  return { init, open, press, release, stop, isRunning: () => running };
})();
