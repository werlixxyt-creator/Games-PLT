"use strict";

// Сцена матча в духе Geometry Dash: ползунки изогнуты вдоль траектории, по которой летит персонаж.
// Ползунок — участок пути, стрелка стоит в его конце: держишь стрелку — летишь к ней.
// Логику считает сервер, здесь только картинка. Траектория строится из id матча,
// поэтому у всех игроков она одинаковая. На ней только свой персонаж: прогресс соперников — на панели снизу.
// Участки пути идут секциями, у каждой своя форма пути и своя палитра; между ними — портал.
// Иногда секции идут в особом стиле (scenes.js): вместо космоса со стенами — другая картинка.
// Персонаж при этом не меняется, а цвет стрелки зависит только от её направления.
const course = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const COLORS = [0, 1, 2, 3].map((i) => css.getPropertyValue("--a" + i).trim());
  const OUTLINE = css.getPropertyValue("--outline").trim() || "#1d1340";
  // стрелки: 0 ← 1 ↑ 2 → 3 ↓; символ смотрит вверх
  const ROT = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  const ARROW = new Path2D("M12 3 L21 13 H15.5 V21 H8.5 V13 H3 Z");

  // мир: единицы, высота экрана всегда VIEW_H, x растёт по ходу полёта
  const VIEW_H = 720;
  const PLAYER_AT = 0.3;     // доля ширины экрана, где держится персонаж
  const HOLD_SPEED = 230;    // обычный темп: единиц в секунду заполнения
  const FAST_STEP = 130;     // быстрый темп: длина одного ползунка
  const Y_LIMIT = 190;       // насколько путь уходит от середины
  const GAP = 215;           // от пути до стен коридора
  const CELL = 40;           // шаг стен коридора
  const TO_PORTAL = 340;     // от последнего ползунка до финишного портала

  const KINDS = ["wave", "ship", "ball", "dash"];

  // палитры: небо сверху и снизу, два цвета туманности, стены, их узор, свет
  const THEMES = [
    { sky: [88, 58, 232], sky2: [58, 104, 232], neb: [255, 110, 235], neb2: [120, 90, 255], wall: [64, 38, 168], wall2: [120, 84, 230], glow: [255, 200, 255] },
    { sky: [8, 22, 58], sky2: [16, 66, 120], neb: [50, 170, 255], neb2: [20, 90, 190], wall: [20, 48, 96], wall2: [70, 200, 240], glow: [150, 240, 255] },
    { sky: [62, 24, 160], sky2: [150, 40, 210], neb: [255, 80, 220], neb2: [90, 210, 255], wall: [64, 96, 220], wall2: [120, 240, 250], glow: [255, 235, 255] },
    { sky: [10, 8, 40], sky2: [4, 4, 18], neb: [110, 60, 230], neb2: [230, 60, 150], wall: [34, 34, 88], wall2: [150, 160, 240], glow: [210, 215, 255] },
  ];

  const canvas = document.getElementById("course");
  const ctx = canvas.getContext("2d");
  let cssW = 0, cssH = 0, dpr = 1, scale = 1, viewW = 1280;

  let map = null;       // { segs, sections, deco, ... } из build()
  let opts = null;      // { level, fast, blind, mirror, hero, trailOf }
  let s = 0;            // где персонаж на экране: номер ползунка + доля
  let lastNow = 0, time = 0;
  let camX = 0, camY = 0, tilt = 0;
  let section = 0;
  let palette = THEMES[0], from = THEMES[0], fade = 1;
  let flash = 0, shake = 0, beat = 0, heat = 0, lastPart = null;
  let parts = [];       // пиксели

  /** Повторяемый генератор случайных чисел: один и тот же матч — одна и та же траектория. */
  function rng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mixRgb = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

  // ---------- Построение уровня ----------

  /** Точки одного ползунка. `st` хранит, куда идёт волна, — она ломается на каждом ползунке. */
  function shape(kind, x, y, len, rand, st) {
    const pts = [];
    if (kind === "wave") {
      // 45°, как режим волны в GD
      const d = len * 0.71;
      if (Math.abs(y + st.up * d) > Y_LIMIT) st.up = -st.up;
      pts.push([x, y], [x + d, y + st.up * d]);
      st.up = -st.up;
    } else if (kind === "ship") {
      const to = clamp(y + (rand() - 0.5) * Math.min(len * 1.3, 2 * Y_LIMIT), -Y_LIMIT, Y_LIMIT);
      for (let i = 0; i <= 14; i++) {
        const k = i / 14;
        pts.push([x + len * k, y + (to - y) * k * k * (3 - 2 * k)]);
      }
    } else if (kind === "ball") {
      // прыжок: дуга всегда к середине экрана, чтобы не упереться в стену
      const to = clamp(y + (rand() - 0.5) * 120, -Y_LIMIT, Y_LIMIT);
      const h = Math.min(len * 0.42, 130) * (y < 0 ? 1 : -1);
      for (let i = 0; i <= 14; i++) {
        const k = i / 14;
        pts.push([x + len * k, y + (to - y) * k + h * 4 * k * (1 - k)]);
      }
    } else {
      pts.push([x, y], [x + len, y]);
    }
    return pts;
  }

  function build(level, fast, seed) {
    const rand = rng(seed);
    const segs = [], sections = [];
    const st = { up: rand() < 0.5 ? -1 : 1 };
    let x = 0, y = 0, kind = -1;
    let theme = Math.floor(rand() * THEMES.length);
    // особые стили идут по кругу с разного места, чтобы матчи не были похожи
    let nextScene = Math.floor(rand() * scenes.names.length);
    let scene = null, sceneLeft = 0, sinceScene = 0, shown = 0;

    for (let i = 0; i < level.length;) {
      const prev = kind;
      do kind = Math.floor(rand() * KINDS.length); while (kind === prev);

      if (sceneLeft > 0) {
        sceneLeft--;
      } else {
        scene = null;
        sinceScene++;
        // иногда стиль меняется; хотя бы один особый стиль за матч будет
        if (sinceScene >= 2 && (rand() < 0.45 || shown === 0)) {
          scene = scenes.names[nextScene++ % scenes.names.length];
          sceneLeft = fast ? 1 : 2;
          sinceScene = 0;
          shown++;
        }
      }

      const end = Math.min(level.length, i + (fast ? 6 + Math.floor(rand() * 7) : 2 + Math.floor(rand() * 2)));
      sections.push({ from: i, to: end, kind: KINDS[kind], theme, scene, x });
      for (; i < end; i++) {
        const len = fast ? FAST_STEP : level[i].fill * HOLD_SPEED;
        const pts = shape(KINDS[kind], x, y, len, rand, st);
        segs.push(pts);
        [x, y] = pts[pts.length - 1];
      }
      theme = (theme + 1) % THEMES.length;
    }

    const endX = x + TO_PORTAL, endY = y;
    const walls = buildWalls(segs, endX, endY, rand);
    return { segs, sections, endX, endY, walls, deco: buildDeco(walls, endX, rand) };
  }

  /** Стены коридора: середина идёт за сглаженным путём, зазор немного дышит. */
  function buildWalls(segs, endX, endY, rand) {
    const x0 = -1400;
    const n = Math.ceil((endX + 1600 - x0) / CELL);
    const raw = new Float32Array(n);
    let seg = 0, p = 0;
    for (let k = 0; k < n; k++) {
      const wx = x0 + k * CELL;
      while (seg < segs.length) {
        const pts = segs[seg];
        if (p >= pts.length - 1) { seg++; p = 0; continue; }
        if (pts[p + 1][0] < wx) { p++; continue; }
        break;
      }
      if (wx < 0) raw[k] = 0;
      else if (seg >= segs.length) raw[k] = endY;
      else {
        const a = segs[seg][p], b = segs[seg][p + 1];
        raw[k] = a[1] + (b[1] - a[1]) * clamp((wx - a[0]) / (b[0] - a[0] || 1), 0, 1);
      }
    }
    const mid = new Float32Array(n), top = new Float32Array(n), bot = new Float32Array(n);
    const R = 5;
    for (let k = 0; k < n; k++) {
      let sum = 0, c = 0;
      for (let j = Math.max(0, k - R); j <= Math.min(n - 1, k + R); j++) { sum += raw[j]; c++; }
      mid[k] = sum / c;
    }
    for (let k = 0; k < n; k++) {
      // ступеньками, как блоки
      top[k] = Math.round((mid[k] - GAP - rand() * 46) / 20) * 20;
      bot[k] = Math.round((mid[k] + GAP + rand() * 46) / 20) * 20;
    }
    return { x0, n, mid, top, bot };
  }

  const wallAt = (w, wx, arr) => arr[clamp(Math.round((wx - w.x0) / CELL), 0, w.n - 1)];

  /** Что стоит у стен: шестерни, пилы, шипы и наклонные балки. */
  function buildDeco(w, endX, rand) {
    const deco = [];
    for (let x = -500; x < endX + 1000; x += 110 + rand() * 190) {
      const side = rand() < 0.5 ? -1 : 1;
      const edge = wallAt(w, x, side < 0 ? w.top : w.bot);
      const r = rand();
      // центр за краем стены: внутрь коридора выступает только часть, путь остаётся свободным
      if (r < 0.34) deco.push({ type: "gear", x, y: edge + side * 34, size: 56 + rand() * 38, spin: (rand() < 0.5 ? -1 : 1) * (0.5 + rand()), side });
      else if (r < 0.58) deco.push({ type: "saw", x, y: edge + side * 22, size: 40 + rand() * 30, spin: (rand() < 0.5 ? -2 : 2) * (0.6 + rand()), side });
      else if (r < 0.86) deco.push({ type: "spike", x, y: edge, size: 42 + rand() * 34, side, count: 1 + Math.floor(rand() * 3) });
      else deco.push({ type: "blade", x, y: edge - side * 14, size: 96, side, lean: rand() < 0.5 ? -0.6 : 0.6 });
    }
    return deco;
  }

  /** Точка пути: s — номер ползунка плюс доля; после последнего — разгон к порталу. */
  function at(pos) {
    const n = map.segs.length;
    if (pos >= n) {
      const last = map.segs[n - 1], e = last[last.length - 1];
      return { x: e[0] + (pos - n) * TO_PORTAL, y: e[1], a: 0 };
    }
    const i = Math.max(0, Math.floor(pos));
    const pts = map.segs[i];
    const f = clamp(pos - i, 0, 1) * (pts.length - 1);
    const j = Math.min(pts.length - 2, Math.floor(f));
    const a = pts[j], b = pts[j + 1];
    return { x: a[0] + (b[0] - a[0]) * (f - j), y: a[1] + (b[1] - a[1]) * (f - j), a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }

  // ---------- Формы ----------

  const GEAR = gearPath(12);
  const SAW = sawPath(9);
  const SWIRL = new Path2D("M0 -7 C5 -11 11 -8 13 -2 C8 -6 4 -4 2 -1 C7 -1 11 3 9 9 C7 4 3 3 0 4 C2 9 -1 13 -7 13 C-3 9 -4 6 -5 2 C-9 5 -13 3 -14 -3 C-10 0 -6 -1 -4 -3 C-8 -6 -7 -11 -2 -14 C-3 -10 -2 -8 0 -7 Z");

  function gearPath(teeth) {
    const p = new Path2D();
    const step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i++) {
      const a = i * step;
      for (const [da, r] of [[-0.3, 0.8], [-0.2, 1], [0.2, 1], [0.3, 0.8]]) {
        const b = a + da * step * 1.1;
        p.lineTo(Math.cos(b) * r, Math.sin(b) * r);
      }
    }
    p.closePath();
    return p;
  }

  function sawPath(teeth) {
    const p = new Path2D();
    const step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i++) {
      p.lineTo(Math.cos(i * step) * 1, Math.sin(i * step) * 1);
      p.lineTo(Math.cos((i + 0.5) * step) * 0.66, Math.sin((i + 0.5) * step) * 0.66);
    }
    p.closePath();
    return p;
  }

  /** Многоугольник-звезда: чётные вершины на радиусе a, нечётные на b. */
  function starPath(points, a, b) {
    const p = new Path2D();
    const step = Math.PI / points;
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 ? b : a;
      p.lineTo(Math.cos(i * step - Math.PI / 2) * r, Math.sin(i * step - Math.PI / 2) * r);
    }
    p.closePath();
    return p;
  }

  /** Кольцо: внешний круг с вырезом, заливается по правилу evenodd. */
  function ringPath(outer, inner) {
    const p = new Path2D();
    p.arc(0, 0, outer, 0, Math.PI * 2);
    p.moveTo(inner, 0);
    p.arc(0, 0, inner, 0, Math.PI * 2);
    return p;
  }

  // скины персонажа: форма, цвет (не из цветов стрелок) и как он крутится.
  // Какие скины есть и чем открываются — решает сервер (Data/Skins.cs), здесь только их вид.
  // nose — смотрит по ходу полёта, иначе вращается сам по себе; у всех форм нос справа
  const HEROES = {
    circle: { path: ringPath(24, 9), color: "#ff2448" },
    cube: { path: new Path2D("M-21 -21 H21 V21 H-21 Z M-9 -9 V9 H9 V-9 Z"), color: "#ffffff" },
    arrow: { path: new Path2D("M-26 -17 L32 0 L-26 17 L-13 0 Z"), color: "#ff2448", nose: true },
    ship: { path: new Path2D("M36 3 L-4 -15 L-27 -24 L-17 -5 L-31 -2 L-17 8 L-27 24 L-3 17 Z"), color: "#ffffff", nose: true },
    spike: { path: starPath(7, 31, 19), color: "#ff2448" },
    star: { path: starPath(5, 33, 14), color: "#ffd84d" },
  };

  // ---------- Частицы ----------

  function pixel(x, y, vx, vy, life, size, color) {
    if (parts.length > 260) parts.shift();
    parts.push({ x, y, vx, vy, life, max: life, size, color });
  }

  function pixels(x, y, n, color, power = 1) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (60 + Math.random() * 240) * power;
      pixel(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.3 + Math.random() * 0.5, 5 + Math.random() * 9, color);
    }
  }

  // ---------- Рисование ----------

  /** Небо, туманность и чёрная дыра вдали; они едут медленнее мира. */
  function drawSky(w, h) {
    const sky = ctx.createLinearGradient(0, 0, w * 0.4, h);
    sky.addColorStop(0, rgba(palette.sky));
    sky.addColorStop(1, rgba(palette.sky2));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = "lighter";
    const blob = (x, y, r, c, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(c, a));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const drift = camX * 0.04 * scale;
    blob(w * 0.72 - (drift % (w * 0.3)), h * 0.46, h * 0.95, palette.neb, 0.34 + beat * 0.14);
    blob(w * 0.18 + Math.sin(time * 0.2) * 40, h * 0.8, h * 0.8, palette.neb2, 0.3);
    blob(w * 0.45 + Math.cos(time * 0.13) * 60, h * 0.12, h * 0.6, palette.neb2, 0.2);

    const hx = w * 0.7 - camX * 0.012 * scale % (w * 0.14), hy = h * (0.5 - clamp(camY / 2400, -0.08, 0.08));
    const r = h * (0.17 + beat * 0.025 + heat * 0.03);
    blob(hx, hy, r * 3.2, palette.glow, 0.34 + beat * 0.3);

    // лучи от дыры
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(time * 0.08);
    const beams = 8 + Math.round(heat * 6);
    for (let i = 0; i < beams; i++) {
      const a = (i / beams) * Math.PI * 2 + Math.sin(time * 0.4 + i) * 0.1;
      const len = r * (3 + Math.sin(time + i * 2) * 0.7 + heat * 1.5);
      ctx.save();
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, rgba(palette.glow, 0.16 + heat * 0.16 + beat * 0.1));
      g.addColorStop(1, rgba(palette.glow, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(r * 0.8, -r * 0.05);
      ctx.lineTo(len, -r * 0.34);
      ctx.lineTo(len, r * 0.34);
      ctx.lineTo(r * 0.8, r * 0.05);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";

    const hole = ctx.createRadialGradient(hx, hy, r * 0.55, hx, hy, r);
    hole.addColorStop(0, "rgba(6,4,28,.95)");
    hole.addColorStop(0.82, rgba(palette.sky2, 0.75));
    hole.addColorStop(1, rgba(palette.sky2, 0));
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "lighter";
    for (const [k, width, a] of [[1, 5, 0.95], [1.42, 2, 0.34], [1.9, 1, 0.2]]) {
      ctx.strokeStyle = rgba(palette.glow, a);
      ctx.lineWidth = width * (1 + beat);
      ctx.beginPath();
      ctx.arc(hx, hy, r * k * (k > 1 ? 1 + beat * 0.08 : 1), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /** Дальние слои: звёзды, колонны с узором и силуэты шестерён. */
  function drawFar(w, h) {
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 70; i++) {
      const rx = (i * 7919) % 1000 / 1000, ry = (i * 6271) % 1000 / 1000;
      const depth = 0.03 + (i % 5) * 0.03;
      const x = ((rx * w * 1.2 - camX * depth * scale) % (w * 1.2) + w * 1.2) % (w * 1.2) - w * 0.1;
      ctx.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(time * 1.3 + i));
      const size = 1 + (i % 3) * scale * 1.6;
      ctx.fillRect(x, ry * h, size, size);
    }
    ctx.globalAlpha = 1;

    // колонны
    const pitch = 420 * scale, off = (camX * 0.3 * scale) % pitch;
    for (let x = -off - pitch; x < w + pitch; x += pitch) {
      const bw = 78 * scale;
      const g = ctx.createLinearGradient(x, 0, x + bw, 0);
      g.addColorStop(0, rgba(palette.wall, 0));
      g.addColorStop(0.5, rgba(palette.wall2, 0.2 + beat * 0.12));
      g.addColorStop(1, rgba(palette.wall, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, bw, h);
      ctx.fillStyle = rgba(palette.wall2, 0.22 + beat * 0.14);
      const cell = 34 * scale;
      for (let y = -(time * 16 * scale) % (cell * 2); y < h; y += cell * 2) {
        ctx.fillRect(x + bw * 0.34, y, bw * 0.32, cell * 0.8);
      }
    }

    // силуэты шестерён
    ctx.fillStyle = rgba(palette.wall, 0.42);
    const gp = 560 * scale, go = (camX * 0.5 * scale) % gp;
    let n = 0;
    for (let x = -go - gp; x < w + gp; x += gp, n++) {
      const up = n % 2 === 0;
      ctx.save();
      ctx.translate(x, up ? h * 0.1 : h * 0.92);
      ctx.rotate(time * (up ? 0.25 : -0.25));
      ctx.scale(150 * scale, 150 * scale);
      ctx.fill(GEAR);
      ctx.restore();
    }
  }

  /** Стены: блочная масса сверху и снизу, с глубиной и светлым краем. */
  function drawWalls(left, right) {
    const w = map.walls;
    const a = clamp(Math.floor((left - w.x0) / CELL), 0, w.n - 2);
    const b = clamp(Math.ceil((right - w.x0) / CELL), a + 1, w.n - 1);
    const reach = VIEW_H * 2;

    for (const [arr, side] of [[w.top, -1], [w.bot, 1]]) {
      ctx.beginPath();
      ctx.moveTo(w.x0 + a * CELL, camY + side * reach);
      for (let k = a; k <= b; k++) {
        const x = w.x0 + k * CELL;
        ctx.lineTo(x, arr[k]);
        ctx.lineTo(x + CELL, arr[k]);
      }
      ctx.lineTo(w.x0 + b * CELL + CELL, camY + side * reach);
      ctx.closePath();

      const g = ctx.createLinearGradient(0, camY + side * 200, 0, camY + side * 420);
      g.addColorStop(0, rgba(palette.wall, 0.92));
      g.addColorStop(1, rgba(mixRgb(palette.wall, [0, 0, 8], 0.72), 0.98));
      ctx.fillStyle = g;
      ctx.fill();

      // узор — столбики света внутри блоков
      ctx.save();
      ctx.clip();
      ctx.fillStyle = rgba(palette.wall2, 0.22 + beat * 0.24);
      for (let k = a - (a % 6); k <= b; k += 6) {
        const x = w.x0 + k * CELL;
        for (let row = 0; row < 7; row++) {
          ctx.fillRect(x + (row % 2) * 12, camY + side * (250 + row * 26), 34, 13);
        }
      }
      ctx.restore();

      ctx.strokeStyle = rgba(palette.wall2, 0.8);
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let k = a; k <= b; k++) {
        const x = w.x0 + k * CELL;
        ctx.lineTo(x, arr[k]);
        ctx.lineTo(x + CELL, arr[k]);
      }
      ctx.stroke();
    }
  }

  function drawDeco(left, right) {
    for (const d of map.deco) {
      if (d.x < left - 620 || d.x > right + 620) continue;
      ctx.save();
      ctx.translate(d.x, d.y);
      if (d.type === "gear" || d.type === "saw") {
        ctx.rotate(time * d.spin);
        const k = d.size * (1 + beat * 0.08);
        ctx.save();
        ctx.scale(k, k);
        ctx.fillStyle = rgba(mixRgb(palette.wall, [0, 0, 0], 0.18));
        ctx.fill(d.type === "gear" ? GEAR : SAW);
        ctx.lineWidth = 2.5 / k;
        ctx.strokeStyle = rgba(palette.wall2, 0.75);
        ctx.stroke(d.type === "gear" ? GEAR : SAW);
        ctx.restore();
        const core = ctx.createRadialGradient(0, 0, 0, 0, 0, k * 0.56);
        core.addColorStop(0, rgba(palette.glow, 0.5 + beat * 0.45));
        core.addColorStop(1, rgba(palette.glow, 0));
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(0, 0, k * 0.56, 0, Math.PI * 2);
        ctx.fill();
        ctx.scale(k / 22, k / 22);
        ctx.fillStyle = "#fff";
        ctx.fill(SWIRL);
      } else if (d.type === "spike") {
        for (let i = 0; i < d.count; i++) {
          const x = (i - (d.count - 1) / 2) * d.size * 0.85;
          const h = d.size * (1.1 + beat * 0.14);
          ctx.beginPath();
          ctx.moveTo(x - d.size * 0.42, 0);
          ctx.lineTo(x, -d.side * h);
          ctx.lineTo(x + d.size * 0.42, 0);
          ctx.closePath();
          ctx.fillStyle = rgba(palette.wall);
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = rgba(palette.wall2, 0.9);
          ctx.stroke();
        }
      } else {
        // балка: острый конец смотрит в коридор, тело уходит за стену
        ctx.rotate(d.lean);
        const len = 620 * d.side;
        ctx.beginPath();
        ctx.moveTo(-d.size / 2, len);
        ctx.lineTo(-d.size / 2, 0);
        ctx.lineTo(0, d.side * -54);
        ctx.lineTo(d.size / 2, 0);
        ctx.lineTo(d.size / 2, len);
        ctx.closePath();
        ctx.fillStyle = rgba(palette.wall);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = rgba(palette.wall2, 0.9);
        ctx.stroke();
        ctx.strokeStyle = rgba(palette.wall2, 0.42);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const y0 = d.side * (20 + i * d.size), y1 = y0 + d.side * d.size;
          ctx.moveTo(-d.size / 2, y0);
          ctx.lineTo(d.size / 2, y1);
          ctx.moveTo(d.size / 2, y0);
          ctx.lineTo(-d.size / 2, y1);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Обводит часть пути между a и b (номер ползунка + доля). */
  function trace(a, b) {
    ctx.beginPath();
    const first = at(a);
    ctx.moveTo(first.x, first.y);
    const end = Math.min(b, map.segs.length);
    for (let i = Math.floor(a); i < end; i++) {
      const pts = map.segs[i];
      for (let j = 0; j < pts.length; j++) {
        const k = j / (pts.length - 1);
        if (i + k > a && i + k < b) ctx.lineTo(pts[j][0], pts[j][1]);
      }
    }
    const last = at(b);
    ctx.lineTo(last.x, last.y);
  }

  function visibleRange(right) {
    let i = Math.floor(s);
    const n = map.segs.length;
    while (i < n && map.segs[i][0][0] < right) i++;
    return Math.min(n, i);
  }

  /** Ползунки впереди: тёмная трубка, у текущего внутри заполнение цветом его стрелки. */
  function drawRoad(right) {
    const n = map.segs.length;
    const cur = Math.floor(s);
    const last = visibleRange(right);
    const width = opts.fast ? 13 : 30;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "rgba(255,255,255,.34)";
    ctx.lineWidth = width + 8;
    trace(s, last);
    ctx.stroke();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = width + 2;
    trace(s, last);
    ctx.stroke();

    for (let i = cur; i < last && i < n; i++) {
      const hidden = opts.blind && i > cur;
      ctx.globalAlpha = i === cur ? 0.62 : 0.3;
      ctx.strokeStyle = hidden ? "#8c88b4" : COLORS[opts.level[i].arrow];
      ctx.lineWidth = width - 6;
      trace(Math.max(s, i + 0.03), i + 0.97);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** След за персонажем: толстая белая лента с каймой цвета скина ползунков. */
  function drawTrail() {
    const tail = Math.max(0, s - (opts.fast ? 12 : 4));
    const n = map.segs.length;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = opts.fast ? 22 : 30;
    for (let i = Math.floor(tail); i <= Math.min(Math.floor(s), n); i++) {
      ctx.strokeStyle = opts.trailOf(Math.min(i, n - 1));
      trace(Math.max(tail, i), Math.min(s, i + 1));
      ctx.stroke();
    }
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = opts.fast ? 13 : 20;
    trace(tail, s);
    ctx.stroke();
  }

  function drawKey(i, current, progress, wrong) {
    const pts = map.segs[i], p = pts[pts.length - 1];
    const arrow = opts.level[i].arrow;
    const color = COLORS[arrow]; // цвет стрелки зависит только от направления
    const hidden = opts.blind && !current;
    const r = (opts.fast ? 25 : 33) * (current ? 1.26 + beat * 0.12 : 1);

    ctx.save();
    ctx.translate(p[0], p[1]);

    if (current) {
      // кольцо сходится к стрелке — куда смотреть прямо сейчас
      const pulse = (time * 1.6) % 1;
      ctx.strokeStyle = rgba(palette.glow, (1 - pulse) * 0.9);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * (2.3 - pulse * 1.1), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = hidden ? "#3a3560" : "#0e0a26";
    ctx.strokeStyle = hidden ? "#8c88b4" : color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = wrong && current ? "#ff3b5c" : "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
    ctx.stroke();

    if (current && !opts.fast) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(0, 0, r + 11, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }
    if (current && opts.mirror) {
      // в «Зеркале» пунктир напоминает: жать надо наоборот
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 7]);
      ctx.lineDashOffset = -time * 28;
      ctx.beginPath();
      ctx.arc(0, 0, r + 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (hidden) {
      ctx.fillStyle = "#fff";
      ctx.font = `900 ${r}px Unbounded, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", 0, 2);
    } else {
      const k = (r * 1.5) / 24;
      ctx.rotate(ROT[arrow]);
      ctx.scale(k, k);
      ctx.translate(-12, -12);
      ctx.fillStyle = color;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.4;
      ctx.lineJoin = "round";
      ctx.stroke(ARROW);
      ctx.fill(ARROW);
    }
    ctx.restore();
  }

  /** Портал между секциями и финишный — овалы с полупрозрачным сиянием. */
  function drawPortal(x, y, color, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.5);
    g.addColorStop(0, rgba(color, 0.55));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-size * 1.5, -size * 1.5, size * 3, size * 3);
    for (const [k, w, a] of [[1, 9, 0.9], [1.14, 3, 0.45]]) {
      ctx.strokeStyle = rgba(color, a);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.32 * k, size * k * (1 + beat * 0.06), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPortals(left, right) {
    for (let i = 1; i < map.sections.length; i++) {
      const sec = map.sections[i];
      if (sec.x < left - 200 || sec.x > right + 200) continue;
      const p = map.segs[sec.from][0];
      drawPortal(p[0], p[1], paletteOf(sec).glow, 104);
    }
    if (map.endX < right + 300) drawPortal(map.endX, map.endY, [255, 255, 255], 190);
  }

  function drawHero(c, id, x, y, angle, size) {
    const hero = HEROES[id] || HEROES.circle;
    c.save();
    c.translate(x, y);
    c.rotate(hero.nose ? angle : time * 5);
    c.scale(size, size);
    c.lineJoin = "round";
    c.strokeStyle = "#fff";
    c.lineWidth = 8;
    c.stroke(hero.path);
    c.strokeStyle = OUTLINE;
    c.lineWidth = 4;
    c.stroke(hero.path);
    c.fillStyle = hero.color;
    c.fill(hero.path, "evenodd");
    c.restore();
  }

  const paletteOf = (sec) => (sec.scene ? scenes.palettes[sec.scene] : THEMES[sec.theme]);

  function sectionAt(pos) {
    const i = Math.min(Math.floor(pos), map.segs.length - 1);
    return map.sections.find((c) => i < c.to) || map.sections[map.sections.length - 1];
  }

  function drawParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = Math.min(1, p.life / p.max * 1.6);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  /** На дропе мимо летят полосы света. */
  function drawStreaks(w, h) {
    if (reduce || heat < 0.05) return;
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba(palette.glow, 0.4 * heat);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const y = ((i * 397) % 100) / 100 * h;
      const speed = 900 + (i * 131) % 700;
      const len = (70 + (i * 53) % 150) * scale;
      const x = w - ((time * speed * scale + i * 211) % (w + len * 2)) + len;
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + len * 0.06);
    }
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  function drawVignette(w, h) {
    const band = h * 0.2;
    let g = ctx.createLinearGradient(0, 0, 0, band);
    g.addColorStop(0, "rgba(0,0,12,.6)");
    g.addColorStop(1, "rgba(0,0,12,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, band);
    g = ctx.createLinearGradient(0, h - band, 0, h);
    g.addColorStop(0, "rgba(0,0,12,0)");
    g.addColorStop(1, "rgba(0,0,12,.7)");
    ctx.fillStyle = g;
    ctx.fillRect(0, h - band, w, band);
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    if (w !== cssW || h !== cssH || canvas.width !== Math.round(w * dpr)) {
      cssW = w;
      cssH = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    scale = h / VIEW_H;
    viewW = w / scale;
    return true;
  }

  /** Перенос мира на экран: персонаж слева, камера мягко идёт за стенами коридора. */
  function applyCamera() {
    const sx = reduce ? 0 : (Math.random() - 0.5) * shake * 18;
    const sy = reduce ? 0 : (Math.random() - 0.5) * shake * 18;
    const zoom = reduce ? 1 : 1 + beat * 0.022;
    ctx.translate(cssW * PLAYER_AT + sx, cssH / 2 + sy);
    ctx.rotate(reduce ? 0 : tilt);
    ctx.scale(scale * zoom, scale * zoom);
    ctx.translate(-camX, -camY);
  }

  // ---------- Что вызывает app.js ----------

  /** @param o { seed, level, fast, blind, mirror, hero — скин персонажа, trailOf(i) — кайма следа } */
  function start(o) {
    opts = o;
    map = build(o.level, o.fast, o.seed);
    s = 0;
    parts = [];
    section = 0;
    palette = from = paletteOf(map.sections[0]);
    fade = 1;
    flash = shake = beat = heat = tilt = 0;
    lastPart = null;
    lastNow = performance.now();
    camX = 0;
    camY = wallAt(map.walls, 0, map.walls.mid);
  }

  /** Ошибка игрока: тряска и красная вспышка. */
  function hit() {
    shake = 1;
    const p = at(s);
    pixels(p.x, p.y, 16, "#ff3b5c");
  }

  /** Экранные координаты стрелки ползунка i — для искр на общем слое эффектов. */
  function point(i) {
    if (!map || !resize()) return [0, 0];
    const pts = map.segs[Math.min(i, map.segs.length - 1)], p = pts[pts.length - 1];
    const r = canvas.getBoundingClientRect();
    return [r.left + cssW * PLAYER_AT + (p[0] - camX) * scale, r.top + cssH / 2 + (p[1] - camY) * scale];
  }

  /** Ползунок заполнен: разлёт пикселей в мире. */
  function filled(i) {
    const pts = map.segs[Math.min(i, map.segs.length - 1)], p = pts[pts.length - 1];
    pixels(p[0], p[1], opts.fast ? 10 : 22, COLORS[opts.level[i].arrow]);
  }

  /** Превью скина персонажа на экране скинов. */
  function paintHero(target, id) {
    const c = target.getContext("2d");
    c.clearRect(0, 0, target.width, target.height);
    drawHero(c, id, target.width / 2, target.height / 2, 0, target.width / 84);
  }

  /**
   * Кадр. o: { pos — номер ползунка + доля, wrong, holding,
   * energy — сила удара в музыке 0..1, part — часть трека ("drop", "build" ...) или null }.
   */
  function frame(now, o) {
    if (!map || !resize()) return;
    const dt = Math.min((now - lastNow) / 1000, 0.05);
    lastNow = now;
    time += dt;

    const n = map.segs.length;
    const target = Math.min(o.pos, n + 1);
    s += (target - s) * (1 - Math.exp(-dt * (opts.fast ? 24 : 34)));
    if (Math.abs(target - s) < 0.001) s = target;

    // музыка качает сцену; на дропе — вспышка и полосы света
    beat = Math.max(o.energy, beat * Math.exp(-dt * 7));
    const part = o.part;
    if (part !== lastPart) {
      if (part && part.startsWith("drop")) { flash = 1; shake = Math.max(shake, 0.5); }
      lastPart = part;
    }
    const hot = part && part.startsWith("drop") ? 1 : part === "build" || part === "intro" ? 0.35 : 0;
    heat += (hot - heat) * (1 - Math.exp(-dt * 4));
    flash *= Math.exp(-dt * 5);
    shake *= Math.exp(-dt * 7);

    // новая секция: смена палитры
    const secIdx = map.sections.indexOf(sectionAt(s));
    if (secIdx !== section) {
      // особый стиль включается сразу: резкую смену картинки прячет более яркая вспышка
      const changed = map.sections[secIdx].scene !== map.sections[section].scene;
      section = secIdx;
      from = palette;
      fade = changed ? 1 : 0;
      flash = Math.max(flash, changed ? 1 : 0.25);
      const p = at(s);
      pixels(p.x, p.y, 26, rgba(paletteOf(map.sections[secIdx]).glow));
    }
    fade = Math.min(1, fade + dt * 2.4);
    const to = paletteOf(map.sections[section]);
    if (fade < 1) {
      palette = {};
      for (const key of Object.keys(to)) palette[key] = mixRgb(from[key], to[key], fade);
    } else {
      palette = to;
    }

    const me = at(s);
    const sec = map.sections[section];
    camX = me.x;
    const camTarget = s >= n ? map.endY : wallAt(map.walls, me.x, map.walls.mid);
    camY += (camTarget - camY) * (1 - Math.exp(-dt * 3));
    const tiltTo = sec.kind === "wave" ? -0.035 : sec.kind === "ship" ? 0.03 : 0;
    tilt += (tiltTo - tilt) * (1 - Math.exp(-dt * 1.6));

    const cur = Math.floor(s);
    const color = opts.trailOf(Math.min(cur, n - 1));
    if (!reduce && s < n && (o.holding || Math.random() < 0.3)) {
      pixel(me.x - 20, me.y + (Math.random() - 0.5) * 16, -80 - Math.random() * 120, (Math.random() - 0.5) * 70, 0.4 + Math.random() * 0.5, 4 + Math.random() * 7, Math.random() < 0.5 ? "#fff" : color);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scene = sec.scene;
    const view = { w: cssW, h: cssH, camX, camY, scale, time, beat, heat };
    if (scene) {
      scenes.back(scene, ctx, view);
    } else {
      drawSky(cssW, cssH);
      drawFar(cssW, cssH);
    }

    ctx.save();
    applyCamera();
    const left = camX - viewW * PLAYER_AT - 120;
    const right = camX + viewW * (1 - PLAYER_AT) + 120;
    if (scene) {
      scenes.world(scene, ctx, view, { left, right }, (x) => wallAt(map.walls, x, map.walls.mid));
    } else {
      drawWalls(left, right);
      drawDeco(left, right);
    }
    drawPortals(left, right);
    drawTrail();
    if (s < n) {
      drawRoad(right);
      const last = visibleRange(right);
      for (let i = last - 1; i >= cur; i--) drawKey(i, i === cur, s - cur, o.wrong);
    }
    drawParts(dt);

    // у финишного портала персонаж уменьшается и исчезает
    const gone = clamp(n + 1 - s, 0, 1);
    if (gone > 0.02) {
      const jitter = o.wrong && !reduce ? (Math.random() - 0.5) * 7 : 0;
      drawHero(ctx, opts.hero, me.x + jitter, me.y + jitter, me.a, (o.holding ? 1.14 : 1) * gone);
    }
    ctx.restore();

    if (scene) scenes.front(scene, ctx, view);
    drawStreaks(cssW, cssH);
    drawVignette(cssW, cssH);
    if (!reduce && flash > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.6})`;
      ctx.fillRect(0, 0, cssW, cssH);
    }
    if (o.wrong) {
      ctx.fillStyle = "rgba(255,40,80,.16)";
      ctx.fillRect(0, 0, cssW, cssH);
    }
  }

  return { start, frame, hit, filled, point, paintHero };
})();
