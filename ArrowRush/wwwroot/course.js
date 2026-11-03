"use strict";

// Сцена матча в духе Geometry Dash: ползунки изогнуты вдоль траектории, по которой летит персонаж.
// Ползунок — участок пути, стрелка стоит в его конце: держишь стрелку — летишь к ней.
// Логику считает сервер, здесь только картинка. Траектория строится из id матча,
// поэтому у всех игроков она одинаковая. На ней свой персонаж и напарник в «2 на 2»: прогресс соперников — на панели снизу.
// Стиль уровня выбирается случайно при старте и не меняется до конца матча: одна из палитр
// космоса со стенами или особая сцена (scenes.js). Он тоже зависит от id матча — у всех одинаковый.
// Участки пути идут секциями с разной формой пути; между ними — портал.
// Персонаж при этом не меняется, а цвет стрелки зависит только от её направления.
const course = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const COLORS = [0, 1, 2, 3].map((i) => css.getPropertyValue("--a" + i).trim());
  const OUTLINE = css.getPropertyValue("--outline").trim() || "#1d1340";

  // мир: единицы, высота экрана всегда VIEW_H, x растёт по ходу полёта
  const VIEW_H = 720;
  const MIN_VIEW_W = 760;    // столько единиц по ширине видно даже на телефоне
  const PLAYER_AT = 0.3;     // доля ширины экрана, где держится персонаж
  const HOLD_SPEED = 230;    // обычный темп: единиц в секунду заполнения
  const FAST_STEP = 130;     // быстрый темп: длина одного ползунка
  const Y_LIMIT = 190;       // насколько путь уходит от середины
  const GAP = 215;           // от пути до стен коридора
  const CELL = 40;           // шаг стен коридора
  const TO_PORTAL = 340;     // от последнего ползунка до финишного портала
  const POP_SECONDS = 0.35;  // как долго лопается заполненная ячейка
  const UFO_SPEED = 355;     // участок с НЛО: единиц в секунду
  const UFO_DROP = 120;      // насколько персонаж на НЛО ниже пути
  const UFO_UNDER = 60;      // центр НЛО ниже персонажа: тот стоит на куполе
  const UFO_ARRIVE = 0.75;   // сцена прилёта: столько НЛО летит к персонажу
  const OBSTACLE_LOW = 90;   // насколько ячейка-препятствие опускается с пути, прямо на уровень персонажа
  const OBSTACLE_R = 36;
  const JUMP_HEIGHT = 260;   // высота прыжка с НЛО: выше препятствия он в той же доле прыжка, что на сервере (SwamClearFrom)

  // ивенты: подпись особой ячейки, цвет и палитра, в которую уходит космос (овердрайв)
  const EVENTS = {
    over: { label: "ОВЕРДРАЙВ", color: "#ff8a2b", rgb: [255, 120, 40] },
    storm: { label: "ШТОРМ", color: "#c9b8ff", rgb: [170, 150, 255] },
    flip: { label: "ПЕРЕВОРОТ", color: "#5dffb0", rgb: [80, 255, 170] },
    rast: { label: "РАСТ", color: "#ff3b5c", rgb: [255, 50, 80] },
    rainbow: { label: "РАДУГА", color: "#ffd84d", rgb: [255, 216, 77] },
    cloud: { label: "КЛОВД", color: "#9fe8ff", rgb: [150, 230, 255] },
  };
  const CLOUD_PALETTE = { sky: [30, 70, 140], sky2: [90, 170, 230], neb: [190, 240, 255], neb2: [120, 180, 255], wall: [40, 70, 130], wall2: [190, 235, 255], glow: [235, 250, 255] };
  const CLOUD_LANE = 112;    // «Кловд»: насколько потолок и пол от пути
  const CLOUD_SPEED = 355;   // единиц в секунду: столько стрелка пролетает к гусенице
  const PUFF_STEP = 62;      // шаг облачков вдоль потолка и пола
  const RAINBOW = ["#ff3b5c", "#ff8a2b", "#ffd84d", "#5dffb0", "#39d8ff", "#5f6dff", "#c06bff"];
  const EYES = 4;            // сколько крылатых глаз летит над радугой
  const WALL_STEP = 60;      // длина ячейки со стеной: персонаж упирается в неё почти сразу
  const WALL_HEIGHT = 84;    // каменный столб выше и ниже пути на столько
  const WALL_WIDTH = 19;     // половина толщины столба
  const CHARGE = 0.24;       // сколько глаз целится, прежде чем выстрелить в ячейку
  const OVER_PALETTE = { sky: [120, 24, 40], sky2: [200, 70, 20], neb: [255, 170, 40], neb2: [255, 60, 60], wall: [90, 20, 30], wall2: [255, 150, 50], glow: [255, 220, 150] };
  const STORM_SIGHT = 2;     // шторм: сколько ячеек видно без молнии, считая текущую
  const RAST_STEP = 120;     // «Раст»: расстояние между ячейками
  const RAST_SHIFT = 0.3;    // «Раст»: на сколько сдвигается персонаж вправо, чтобы дыре было откуда догонять
  const BEAT_GAP = 0.36;     // вспышки в такт не чаще раза в столько секунд: частое мигание опасно для зрения

  const KINDS = ["wave", "ship", "ball", "dash"];
  const THEME_IDS = ["violet", "ocean", "neon", "night"]; // как THEMES; лобби выбирает дизайн по этим именам

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
  let opts = null;      // { level, fast, sight, mirror, hero, trailOf }
  let s = 0;            // где персонаж на экране: номер ползунка + доля
  let lastNow = 0, time = 0;
  let camX = 0, camY = 0, tilt = 0;
  let section = 0;
  let palette = THEMES[0];
  let flash = 0, shake = 0, beat = 0, heat = 0, lastPart = null;
  let parts = [];       // пиксели
  let pops = [];        // заполненные ячейки лопаются: { x, y, r, color, k }
  let reached = 0;      // номер ползунка, на котором сейчас игрок
  let mateShown = new Map(); // где напарники на экране: slot → номер ползунка + доля
  let fly = null;       // идёт сцена прилёта НЛО: { start, from — номер свама, struck, landed }
  let inAir = false, landed = 0, recoil = 0; // прыжок с НЛО: приземление и толчок от него, затухают
  let rings = [];       // ударные волны в мире: { x, y, size, color, k }
  let ghosts = [];      // овердрайв: где персонаж был в прошлых кадрах
  let bolts = [];       // шторм: молнии на экране: { pts, life }
  let zones = { over: 0, storm: 0, flip: 0, rast: 0, rainbow: 0, cloud: 0 }; // насколько идёт каждый ивент, 0..1, меняется плавно
  let puff = null;      // «Кловд» начался: { start, from — номер его ячейки }
  let crawlY = 1;      // где гусеница между линиями: -1 — потолок, 1 — пол
  let lastLane = 1;     // на какой линии он был в прошлом кадре
  let zaps = [];        // вспышки прыжка гусеницы: { x, y0, y1, life }
  let morphed = 0;      // превращение в гусеницу: вспышка затухает
  let rain = null;      // «Радуга» началась: { start, from — номер её ячейки, fired — какие стены уже подстрелили }
  let lasers = [];      // лазеры: { eye, x, y — точка мира, delay — сколько ещё целится, life, color, hit }
  let shotAt = [];      // когда стрелял каждый глаз: от выстрела его отбрасывает
  let chunks = [];      // обломки стен: { x, y, vx, vy, a, spin, size, life, color }
  let wallShapes = new Map(); // контуры стен: у каждой свой
  let roll = 0;         // поворот камеры от удара, затухает
  let flashRgb = [255, 255, 255]; // цвет вспышки
  let holeShown = 1;    // «Раст»: где чёрная дыра, 1 — у правого края, 0 — догнала
  let eaten = 0;        // дыра поглощает персонажа, 0..1
  let beatAt = 0;       // когда была последняя вспышка в такт
  let zoneNow = null;   // какой ивент на текущей ячейке
  let strike = 0, strikeAt = 0; // шторм: яркость молнии и когда ударит следующая
  let punch = 0;        // толчок камеры, затухает
  let danger = 0;       // финал уровня: красные края экрана, 0..1

  /** Повторяемый генератор случайных чисел: один и тот же матч — одна и та же траектория. */
  function rng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Ячейка дальше, чем видно в этом режиме или в темноте шторма: её показывает только молния. */
  const hiddenCell = (i) => (opts.sight > 0 && i - Math.floor(s) >= opts.sight)
    || (zoneNow === "storm" && strike < 0.25 && i - Math.floor(s) >= STORM_SIGHT);

  /** Доля ширины экрана, где сейчас персонаж. */
  const heroAt = () => PLAYER_AT + zones.rast * RAST_SHIFT;

  /** Переворот: мир отражается по вертикали, на середине сжимаясь в линию. */
  const flipY = () => {
    const k = reduce ? 1 : Math.cos(Math.PI * zones.flip);
    return Math.abs(k) < 0.02 ? 0.02 : k;
  };

  /** Какую стрелку показать: ячейки за чартом и свамом выглядят обычными, пока он не пройден. */
  function arrowOf(i) {
    const cell = opts.level[i];
    return cell.was !== null && (cell.ufo || reached <= cell.chartAt) ? cell.was : cell.arrow;
  }

  /** Ячейка участка с НЛО. */
  const ufoCell = (i) => !!opts.level[i]?.ufo;

  /** Она уже стала препятствием: свам перед ней пройден. */
  const ufoShown = (i) => ufoCell(i) && reached > opts.level[i].chartAt;

  /** Ячейка «Кловда», который уже начался: вместо неё летит стрелка. */
  const cloudShown = (i) => opts.level[i]?.zone === "cloud" && reached > opts.level[i].chartAt;

  /** На этом участке нет дороги. */
  const noRoad = (i) => ufoShown(i) || cloudShown(i);

  /** Стена уже есть на уровне, 0..1: она вырастает там, куда прилетел лазер. Игрок у стены видит её сразу. */
  function wallK(i) {
    const cell = opts.level[i];
    if (!cell?.wall || reached <= cell.chartAt) return 0;
    if (reached >= i || !rain || cell.chartAt !== rain.from) return 1;
    return clamp((time - wallTime(i)) / 0.2, 0, 1);
  }

  /** Когда лазер прилетает в стену i: стены появляются по очереди. */
  const wallTime = (i) => rain.start + 0.7 + (i - rain.from - 2) * 0.24;

  /** Удар по камере: она поворачивается на угол в случайную сторону и пружинит обратно. */
  function kick(angle) {
    if (!reduce) roll += angle * (Math.random() < 0.5 ? -1 : 1);
  }

  /** Вспышка заданного цвета. */
  function flashOf(k, rgb) {
    if (k < flash) return;
    flash = k;
    flashRgb = rgb;
  }

  /** Насколько ячейка превратилась в препятствие, 0..1: в сцене прилёта они меняются одна за другой. */
  function morph(i) {
    if (!ufoShown(i)) return 0;
    if (!fly || opts.level[i].chartAt !== fly.from) return 1;
    return clamp((time - fly.start - 0.3 - (i - fly.from - 1) * 0.11) / 0.4, 0, 1);
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

  /** Номер стиля: выбранный в лобби или тот, что выпал. */
  function styleOf(theme, rolled) {
    const named = [...THEME_IDS, ...scenes.names].indexOf(theme);
    return named >= 0 ? named : rolled;
  }

  function build(level, fast, seed, theme) {
    const rand = rng(seed);
    const segs = [], sections = [];
    const st = { up: rand() < 0.5 ? -1 : 1 };
    let x = 0, y = 0, kind = -1;
    // стиль один на весь уровень: номер меньше числа палитр — космос, иначе особая сцена
    const style = styleOf(theme, Math.floor(rand() * (THEMES.length + scenes.names.length)));
    const scene = style < THEMES.length ? null : scenes.names[style - THEMES.length];
    const colors = scene ? scenes.palettes[scene] : THEMES[style];

    for (let i = 0; i < level.length;) {
      const straightKind = (c) => (c.ufo ? "ufo" : c.zone === "rast" || c.zone === "cloud" ? c.zone : null);
      const straight = straightKind(level[i]);
      if (straight) {
        // НЛО, «Раст» и «Кловд»: ячейки стоят по прямой, иначе не рассчитать прыжок и полёт стрелок
        const from = i, sx = x;
        for (; i < level.length && straightKind(level[i]) === straight; i++) {
          const step = straight === "ufo" ? level[i].fill * UFO_SPEED : straight === "cloud" ? level[i].fill * CLOUD_SPEED : RAST_STEP;
          segs.push([[x, y], [x + step, y]]);
          x += step;
        }
        sections.push({ from, to: i, kind: straight, x: sx });
        continue;
      }
      const prev = kind;
      do kind = Math.floor(rand() * KINDS.length); while (kind === prev);
      let end = Math.min(level.length, i + (fast ? 6 + Math.floor(rand() * 7) : 2 + Math.floor(rand() * 2)));
      for (let k = i; k < end; k++) if (straightKind(level[k])) end = k;
      sections.push({ from: i, to: end, kind: KINDS[kind], x });
      for (; i < end; i++) {
        const len = level[i].wall ? WALL_STEP : fast ? FAST_STEP : level[i].fill * HOLD_SPEED;
        const pts = shape(KINDS[kind], x, y, len, rand, st);
        segs.push(pts);
        [x, y] = pts[pts.length - 1];
      }
    }

    const endX = x + TO_PORTAL, endY = y;
    const walls = buildWalls(segs, endX, endY, rand);
    return { segs, sections, scene, colors, endX, endY, walls, deco: buildDeco(walls, endX, rand) };
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
    crown: { path: new Path2D("M-28 20 L-32 -18 L-14 -2 L0 -26 L14 -2 L32 -18 L28 20 Z"), color: "#ffd84d" },
    gem: { path: new Path2D("M-16 -24 H16 L31 -6 L0 28 L-31 -6 Z"), color: "#39d8ff" },
    heart: { path: new Path2D("M0 27 C-36 3 -31 -25 -12 -25 C-4 -25 0 -17 0 -14 C0 -17 4 -25 12 -25 C31 -25 36 3 0 27 Z"), color: "#ff3b6e" },
    bolt: { path: new Path2D("M9 -33 L-21 6 L-3 6 L-9 33 L21 -8 L3 -8 Z"), color: "#ffe14d" },
    gear: { path: starPath(10, 31, 22), color: "#9fb4d8" },
    moon: { path: new Path2D("M12 -30 A30 30 0 1 0 12 30 A23 23 0 1 1 12 -30 Z"), color: "#fff1b8" },
  };

  // скины НЛО: формы и цвета; какой надет, передаёт opts.ufo
  const UFOS = {
    classic: {
      hull: new Path2D("M-112 8 C-74 -20 74 -20 112 8 C80 30 -80 30 -112 8 Z"),
      rim: new Path2D("M-112 8 C-74 -16 74 -16 112 8"),
      dome: new Path2D("M-44 -8 C-42 -52 42 -52 44 -8 Z"),
      metal: ["#4b525e", "#1d2028"], // сверху и снизу
      edge: "#39b8c4",
      glow: [70, 235, 255],
      ring: [24, 96, 110],   // тёмное кольцо на брюхе
    },
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

  /** Части пути между a и b без участков с НЛО: там нет дороги, только препятствия. */
  function roadRuns(a, b) {
    const runs = [];
    let from = a;
    for (let i = Math.floor(a); i < b; i++) {
      if (!noRoad(i)) continue;
      if (i > from) runs.push([from, i]);
      from = i + 1;
    }
    if (b > from) runs.push([from, b]);
    return runs;
  }

  /** Насколько персонаж сейчас ниже пути: падает на НЛО в начале участка, взлетает с него после конца. */
  function dropAt(pos) {
    const i = Math.floor(pos);
    if (ufoCell(i)) return ufoCell(i - 1) ? UFO_DROP : UFO_DROP * Math.sin(Math.min(1, (pos - i) / 0.4) * Math.PI / 2);
    return ufoCell(i - 1) ? UFO_DROP * (1 - Math.min(1, (pos - i) / 0.5)) : 0;
  }

  /** Высота прыжка; air — сколько секунд он длится, меньше нуля — на земле. */
  function jumpLift(air) {
    if (!(air >= 0)) return 0;
    const k = Math.min(1, air / opts.jump);
    return JUMP_HEIGHT * 4 * k * (1 - k);
  }

  function visibleRange(right) {
    let i = Math.floor(s);
    const n = map.segs.length;
    while (i < n && map.segs[i][0][0] < right) i++;
    return Math.min(n, i);
  }

  /** Дорога впереди: тёмная трубка, внутри цвет стрелки каждой ячейки; пунктир задаёт скин. */
  function drawRoad(right) {
    const n = map.segs.length;
    const cur = Math.floor(s);
    const last = visibleRange(right);
    const width = opts.fast ? 13 : 30;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const [color, w] of [["rgba(255,255,255,.34)", width + 8], [OUTLINE, width + 2]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      for (const [a, b] of roadRuns(s, last)) {
        trace(a, b);
        ctx.stroke();
      }
    }

    ctx.setLineDash(cells.dash(opts.cell));
    for (let i = cur; i < last && i < n; i++) {
      if (noRoad(i)) continue;
      const hidden = hiddenCell(i);
      ctx.globalAlpha = i === cur ? 0.62 : 0.3;
      ctx.strokeStyle = hidden ? "#8c88b4" : COLORS[arrowOf(i)];
      ctx.lineWidth = width - 6;
      trace(Math.max(s, i + 0.03), i + 0.97);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** След за персонажем: толстая белая лента с каймой цвета скина ячеек. */
  function drawTrail() {
    const tail = Math.max(0, s - (opts.fast ? 12 : 4));
    const n = map.segs.length;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = opts.fast ? 22 : 30;
    for (let i = Math.floor(tail); i <= Math.min(Math.floor(s), n); i++) {
      if (noRoad(i)) continue;
      ctx.strokeStyle = opts.trailOf(Math.min(i, n - 1));
      trace(Math.max(tail, i), Math.min(s, i + 1));
      ctx.stroke();
    }
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = opts.fast ? 13 : 20;
    for (const [a, b] of roadRuns(tail, s)) {
      trace(a, b);
      ctx.stroke();
    }
  }

  /** Подпись особой ячейки, видна издалека, в том числе во «Вслепую»: цветное кольцо и слово под ним. */
  function drawBadge(r, text, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 0, r + 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "900 17px Unbounded, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    ctx.strokeStyle = OUTLINE;
    ctx.strokeText(text, 0, r + 36);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, r + 36);
  }

  /** Ячейка-препятствие: красная пила без стрелки висит на уровне персонажа, её надо перепрыгнуть. m — насколько она превратилась. */
  function drawObstacle(i, m) {
    const pts = map.segs[i], p = pts[pts.length - 1];
    const r = OBSTACLE_R * (0.6 + 0.4 * m);
    ctx.save();
    ctx.translate(p[0], p[1] + OBSTACLE_LOW * (1 - (1 - m) ** 3) + Math.sin(time * 3 + i) * 5 * m);
    ctx.globalAlpha = m;
    ctx.save();
    ctx.rotate(time * 4);
    ctx.scale(r * 1.34, r * 1.34);
    ctx.fillStyle = "#ff3b5c";
    ctx.fill(SAW);
    ctx.lineWidth = 3 / r;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke(SAW);
    ctx.restore();
    cells.draw(ctx, { skin: opts.cell, r: r * 0.72, color: "#ff3b5c", t: time, hidden: false, k: 0, wrong: false });
    ctx.lineCap = "round";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.3);
    ctx.lineTo(r * 0.3, r * 0.3);
    ctx.moveTo(r * 0.3, -r * 0.3);
    ctx.lineTo(-r * 0.3, r * 0.3);
    ctx.stroke();
    ctx.restore();
  }

  /** Сцена прилёта: в каждую ячейку бьёт луч с неба, в его вспышке она становится препятствием. */
  function drawStrikes() {
    if (!fly) return;
    ctx.globalCompositeOperation = "lighter";
    for (let i = fly.from + 1; ufoCell(i) && opts.level[i].chartAt === fly.from; i++) {
      const m = morph(i), pts = map.segs[i], p = pts[pts.length - 1];
      if (m <= 0 || m >= 1) continue;
      const a = Math.sin(m * Math.PI), w = 16 + 46 * a;
      const beam = ctx.createLinearGradient(0, camY - VIEW_H, 0, p[1] + OBSTACLE_LOW);
      beam.addColorStop(0, "rgba(70,235,255,0)");
      beam.addColorStop(1, `rgba(150,245,255,${a * 0.85})`);
      ctx.fillStyle = beam;
      ctx.fillRect(p[0] - w / 2, camY - VIEW_H, w, VIEW_H + p[1] + OBSTACLE_LOW - camY);
      ctx.strokeStyle = `rgba(190,250,255,${1 - m})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(p[0], p[1] + OBSTACLE_LOW * m, 30 + m * 110, 0, Math.PI * 2);
      ctx.stroke();
      if (m >= 0.5 && !fly.struck.has(i)) {
        fly.struck.add(i);
        shake = Math.max(shake, 0.35);
        pixels(p[0], p[1] + OBSTACLE_LOW * 0.5, 16, "#8ff4ff", 1.2);
        pixels(p[0], p[1] + OBSTACLE_LOW * 0.5, 8, "#ff3b5c", 1);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawKey(i, current, progress, wrong) {
    const pts = map.segs[i], p = pts[pts.length - 1];
    const arrow = arrowOf(i);
    const color = COLORS[arrow]; // цвет стрелки зависит только от направления
    const hidden = hiddenCell(i);
    const r = (opts.fast || opts.level[i].zone === "rast" ? 25 : 33) * (current ? 1.26 + beat * 0.12 : 1);

    ctx.save();
    // ячейки живые: мягко покачиваются, у каждой свой ритм
    ctx.translate(p[0], p[1] + (reduce ? 0 : Math.sin(time * 2.4 + i * 1.3) * 3));
    if (flipY() < 0) ctx.scale(1, -1); // в перевороте мир отражён, а стрелки и подписи остаются как есть

    if (current) {
      // кольцо сходится к стрелке — куда смотреть прямо сейчас
      const pulse = (time * 1.6) % 1;
      ctx.strokeStyle = rgba(palette.glow, (1 - pulse) * 0.9);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * (2.3 - pulse * 1.1), 0, Math.PI * 2);
      ctx.stroke();
    }

    cells.draw(ctx, {
      skin: opts.cell, r, color, t: time, hidden,
      k: current && !opts.fast ? progress : 0,
      wrong: wrong && current,
    });

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

    if (opts.level[i].chart) drawBadge(r, "ЧАРТ", "#ffc93c");
    if (opts.level[i].swam) drawBadge(r, "СВАМ", "#39e6ff");
    // «Радуга» приходит без предупреждения: её ячейка выглядит обычной
    const named = opts.level[i].event;
    if (named && named !== "rainbow") drawBadge(r, EVENTS[named].label, EVENTS[named].color);

    if (hidden) {
      ctx.fillStyle = "#fff";
      ctx.font = `900 ${r}px Unbounded, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", 0, 2);
    } else {
      cells.arrow(ctx, r, arrow, current);
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
      if (sec.kind === "ufo" || sec.kind === "rast" || sec.x < left - 200 || sec.x > right + 200) continue;
      const p = map.segs[sec.from][0];
      drawPortal(p[0], p[1], palette.glow, 104);
    }
    if (map.endX < right + 300) drawPortal(map.endX, map.endY, [255, 255, 255], 190);
  }

  /**
   * color — заменить цвет скина (напарник рисуется своим цветом).
   * pose — поза на НЛО: { spin — угол вместо обычного вращения, sx, sy — сжатие при прыжке и приземлении }.
   */
  function drawHero(c, id, x, y, angle, size, color, pose) {
    const hero = HEROES[id] || HEROES.circle;
    c.save();
    c.translate(x, y);
    c.rotate(pose ? pose.spin : hero.nose ? angle : time * 5);
    c.scale(size * (pose ? pose.sx : 1), size * (pose ? pose.sy : 1));
    c.lineJoin = "round";
    c.strokeStyle = "#fff";
    c.lineWidth = 8;
    c.stroke(hero.path);
    c.strokeStyle = OUTLINE;
    c.lineWidth = 4;
    c.stroke(hero.path);
    c.fillStyle = color || hero.color;
    c.fill(hero.path, "evenodd");
    c.restore();
  }

  /** Огни бегут по кругу: сзади они за корпусом, спереди видны. */
  function drawUfoLights(n, rx, ry, cy, w, h, speed) {
    for (let i = 0; i < n; i++) {
      const a = time * speed + (i / n) * Math.PI * 2;
      const front = Math.sin(a);
      if (front < 0.05) continue;
      ctx.globalAlpha = 0.45 + 0.55 * front;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * rx, cy + front * ry, w * (0.45 + 0.55 * front), h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** НЛО: тёмный металл, бирюзовая кромка, белые огни и сияющее брюхо. Огни крутятся, брюхо пульсирует. */
  function drawUfo(id, x, y, k, lean = 0) {
    const ufo = UFOS[id] || UFOS.classic;
    const pulse = 0.75 + 0.25 * Math.sin(time * 9);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean - 0.07);
    ctx.scale(k, k);
    ctx.lineJoin = "round";

    // сияние и луч снизу
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(0, 34, 0, 0, 34, 120);
    halo.addColorStop(0, rgba(ufo.glow, 0.75 * pulse));
    halo.addColorStop(1, rgba(ufo.glow, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(-120, -86, 240, 240);
    const ray = ctx.createLinearGradient(0, 30, 0, 150);
    ray.addColorStop(0, rgba(ufo.glow, 0.32 * pulse));
    ray.addColorStop(1, rgba(ufo.glow, 0));
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(-34, 28);
    ctx.lineTo(34, 28);
    ctx.lineTo(70, 150);
    ctx.lineTo(-70, 150);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    // брюхо: кольца света
    ctx.fillStyle = ufo.metal[1];
    ctx.beginPath();
    ctx.ellipse(0, 25, 58, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const [rx, ry, color] of [[44, 12, rgba(ufo.glow, 0.9)], [29, 7.5, rgba(ufo.ring)], [19, 4.5, "#e8fdff"]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 28, rx * (0.92 + 0.08 * pulse), ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const metal = ctx.createLinearGradient(0, -50, 0, 30);
    metal.addColorStop(0, ufo.metal[0]);
    metal.addColorStop(1, ufo.metal[1]);

    // купол с поясом огней
    ctx.fillStyle = metal;
    ctx.fill(ufo.dome);
    ctx.strokeStyle = "rgba(255,255,255,.28)";
    ctx.lineWidth = 2;
    ctx.stroke(ufo.dome);
    ctx.fillStyle = "#fff";
    drawUfoLights(9, 37, 3, -19, 3.4, 2.6, 2.2);

    // корпус, кромка и большие огни
    ctx.fillStyle = metal;
    ctx.fill(ufo.hull);
    ctx.strokeStyle = "rgba(255,255,255,.3)";
    ctx.lineWidth = 2;
    ctx.stroke(ufo.hull);
    ctx.strokeStyle = ufo.edge;
    ctx.lineWidth = 4;
    ctx.stroke(ufo.rim);
    ctx.fillStyle = "#fff";
    drawUfoLights(12, 90, 8, 6, 10, 3.2, 1.5);
    ctx.restore();
  }

  /** Напарник летит по той же траектории со своим прогрессом; ушёл за край экрана — метка у края. */
  function drawMates(mates, dt) {
    const n = map.segs.length;
    const edgeL = camX - viewW * heroAt() + 76, edgeR = camX + viewW * (1 - heroAt()) - 76;
    const stacked = { left: 0, right: 0 }; // метки у края идут столбиком, чтобы не накладывались
    ctx.font = "800 15px Nunito, sans-serif";
    ctx.textAlign = "center";
    for (const m of mates) {
      const was = mateShown.has(m.slot) ? mateShown.get(m.slot) : m.pos;
      const pos = clamp(was + (m.pos - was) * (1 - Math.exp(-dt * (opts.fast ? 24 : 34))), 0, n + 1);
      mateShown.set(m.slot, pos);
      const p = at(pos);
      const drop = dropAt(pos);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = m.color;
      ctx.lineWidth = opts.fast ? 6 : 8;
      for (const [a, b] of roadRuns(Math.max(0, pos - (opts.fast ? 8 : 3)), pos)) {
        trace(a, b);
        ctx.stroke();
      }

      if (drop > 1) drawUfo(opts.ufo, p.x, p.y + UFO_DROP + UFO_UNDER, 0.6 * drop / UFO_DROP);
      p.y += drop - jumpLift(m.air);

      const x = clamp(p.x, edgeL, edgeR);
      const inside = x === p.x;
      const y = inside ? p.y : camY - 170 + stacked[p.x < x ? "left" : "right"]++ * 76;
      drawHero(ctx, "circle", x, y, p.a, inside ? 0.8 : 0.6, m.color);
      if (!inside) {
        // треугольник показывает, в какую сторону ушёл напарник
        const dir = p.x < x ? -1 : 1;
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.moveTo(x + dir * 40, y);
        ctx.lineTo(x + dir * 24, y - 11);
        ctx.lineTo(x + dir * 24, y + 11);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(x, y - 34);
      if (flipY() < 0) ctx.scale(1, -1);
      ctx.lineWidth = 4;
      ctx.strokeStyle = OUTLINE;
      ctx.strokeText(m.name, 0, 0);
      ctx.fillStyle = "#fff";
      ctx.fillText(m.name, 0, 0);
      ctx.restore();
    }
  }

  /** Ударная волна в мире. */
  function ring(x, y, size, color) {
    if (reduce) return;
    if (rings.length > 24) rings.shift();
    rings.push({ x, y, size, color, k: 0 });
  }

  function drawRings(dt) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.k += dt / 0.5;
      if (r.k >= 1) { rings.splice(i, 1); continue; }
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = (1 - r.k) ** 2;
      ctx.lineWidth = 14 * (1 - r.k) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.size * (1 - (1 - r.k) ** 3), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /** Овердрайв: за персонажем тянутся его тени. */
  function drawGhosts(me) {
    ghosts.push({ x: me.x, y: me.y });
    if (ghosts.length > 12) ghosts.shift();
    const k = Math.max(zones.over, zones.cloud);
    if (k < 0.1 || reduce) return;
    for (let i = 0; i + 2 < ghosts.length; i += 2) {
      ctx.globalAlpha = (i / ghosts.length) * 0.4 * k;
      if (cloudShown(Math.floor(s))) drawCaterpillar(ghosts[i].x, ghosts[i].y, ghosts[i].y < me.y - 1 || crawlY < 0 ? -1 : 1, 1);
      else drawHero(ctx, opts.hero, ghosts[i].x, ghosts[i].y, me.a, 1, zones.cloud > zones.over ? "#8fe6ff" : "#ffb060");
    }
    ctx.globalAlpha = 1;
  }

  /** Края экрана светятся цветом того, что сейчас идёт. */
  function drawEdges(w, h, rgb, a) {
    if (a < 0.01) return;
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, w * 0.68);
    g.addColorStop(0, rgba(rgb, 0));
    g.addColorStop(1, rgba(rgb, a));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /** Цвета гусеницы: светлое тело, тёмные пятна с жёлтыми точками, коричневый контур. */
  const CAT = { body: "#8dc63f", light: "#c6e675", patch: "#2f5f1f", spot: "#f6e840", line: "#5b3012", leg: "#a6d65a" };

  /**
   * Гусеница: по сегментам от хвоста к голове бежит волна, ножки переступают, голова кивает, усики качаются.
   * Ножки стоят на y = 24. side: 1 — на полу, -1 — на потолке.
   */
  function drawCaterpillar(x, y, side, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, size * side);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // сегмент приподнимается и подтягивается вперёд, когда до него доходит волна
    const segs = [];
    for (let i = 0; i < 7; i++) {
      const r = 8.5 + i * 0.9, wave = Math.sin(time * 12 - i * 0.95), lift = Math.max(0, wave) * 6;
      segs.push({ x: -44 + i * 10.5 + wave * 1.4, y: 17 - r - lift, r, lift, wave });
    }
    const nod = Math.sin(time * 12 - 7 * 0.95);
    const head = { x: 32 + nod * 1.4, y: 6 - Math.max(0, nod) * 3, r: 13 };
    const stroke = (width, color) => {
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    // ножки-присоски: поднятый сегмент отрывает свою от земли
    for (const s of segs) {
      ctx.beginPath();
      ctx.moveTo(s.x - 1, s.y + s.r * 0.7);
      ctx.lineTo(s.x + s.wave * 3, 24 - s.lift * 0.6);
      stroke(9, "#fff");
      stroke(6.5, CAT.line);
      stroke(3.5, CAT.leg);
    }

    // белая обводка всего тела, чтобы гусеница читалась на тёмном фоне
    ctx.beginPath();
    for (const s of segs) {
      ctx.moveTo(s.x + s.r * 0.82 + 3, s.y);
      ctx.ellipse(s.x, s.y, s.r * 0.82 + 3, s.r + 3, 0, 0, Math.PI * 2);
    }
    ctx.moveTo(head.x + head.r + 3, head.y);
    ctx.arc(head.x, head.y, head.r + 3, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();

    // сегменты от хвоста к голове: передний перекрывает задний
    for (const s of segs) {
      const r = s.r;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r * 0.82, r, 0, 0, Math.PI * 2);
      ctx.fillStyle = CAT.body;
      ctx.fill();
      stroke(2.5, CAT.line);
      ctx.fillStyle = CAT.patch;
      ctx.beginPath();
      ctx.ellipse(s.x - r * 0.05, s.y - r * 0.38, r * 0.5, r * 0.42, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x + r * 0.28, s.y + r * 0.38, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = CAT.spot;
      ctx.beginPath();
      ctx.ellipse(s.x + r * 0.05, s.y - r * 0.45, r * 0.17, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 0.62, Math.PI * 1.08, Math.PI * 1.42);
      stroke(2, CAT.light);
    }

    // усики-завитки
    for (let i = 0; i < 2; i++) {
      const sway = Math.sin(time * 7 + i * 1.3) * 2.5;
      const bx = head.x + 3 + i * 5, by = head.y - head.r + 2;
      const tx = bx + 7 + sway, ty = by - 10 + Math.abs(sway) * 0.4;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx - 2, ty, tx, ty);
      ctx.arc(tx, ty + 2.5, 2.5, -Math.PI / 2, Math.PI * 1.2);
      stroke(5, "#fff");
      stroke(2, CAT.line);
    }

    // голова смотрит вперёд, на летящие стрелки
    ctx.beginPath();
    ctx.arc(head.x, head.y, head.r, 0, Math.PI * 2);
    ctx.fillStyle = CAT.body;
    ctx.fill();
    stroke(2.5, CAT.line);
    ctx.fillStyle = CAT.patch;
    ctx.beginPath();
    ctx.ellipse(head.x - 4, head.y - 5, 7.5, 5, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CAT.spot;
    ctx.beginPath();
    ctx.ellipse(head.x - 4, head.y - 6, 2.8, 1.9, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // глаза моргают раз в три секунды
    const blink = time % 3.2 < 0.12 ? 0.15 : 1;
    for (const [ex, ey] of [[head.x + 5, head.y + 3], [head.x + 10, head.y + 1]]) {
      ctx.fillStyle = CAT.line;
      ctx.beginPath();
      ctx.ellipse(ex, ey, 1.9, 2.5 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
      if (blink === 1) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ex + 0.6, ey - 0.9, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.beginPath();
    ctx.arc(head.x + 8, head.y + 5.5, 3.4, 0.35, Math.PI - 0.5);
    stroke(1.6, CAT.line);
    ctx.restore();
  }

  /** Потолок и пол из облаков: кучерявые полосы вдоль пути, мягко дышат. */
  function drawClouds(left, right, pathY) {
    if (zones.cloud < 0.02) return;
    const from = Math.floor(left / PUFF_STEP), to = Math.ceil(right / PUFF_STEP);
    ctx.save();
    ctx.globalAlpha = zones.cloud;
    for (const [side, color, grow] of [[-1, "#d9f3ff", 1.15], [1, "#d9f3ff", 1.15], [-1, "#fff", 0.9], [1, "#fff", 0.9]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let k = from; k <= to; k++) {
        const r = (24 + ((k * 37 + 41) % 17)) * grow * (1 + Math.sin(time * 2 + k) * 0.06);
        const x = k * PUFF_STEP, y = pathY + side * (CLOUD_LANE + 28 + r * 0.45);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  /** Стрелка «Кловда» влетает справа по своей линии, за ней огненный хвост. */
  function drawDart(i, pathY) {
    const cell = opts.level[i], pts = map.segs[i], p = pts[pts.length - 1];
    const k = puff && cell.chartAt === puff.from ? clamp((time - puff.start - 0.35 - (i - puff.from) * 0.06) / 0.25, 0, 1) : 1;
    if (k <= 0) return;
    const y = pathY + (cell.lane === 0 ? -1 : 1) * CLOUD_LANE, wob = reduce ? 0 : Math.sin(time * 18 + i) * 2.5;

    ctx.save();
    ctx.translate(p[0], y + wob);
    ctx.globalAlpha = k;
    ctx.globalCompositeOperation = "lighter";
    const tail = ctx.createLinearGradient(0, 0, 190, 0);
    tail.addColorStop(0, "rgba(255,140,50,.85)");
    tail.addColorStop(1, "rgba(255,50,80,0)");
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(12, -13);
    ctx.lineTo(190, 0);
    ctx.lineTo(12, 13);
    ctx.fill();
    const glow = ctx.createRadialGradient(0, 0, 3, 0, 0, 48);
    glow.addColorStop(0, `rgba(255,70,90,${0.55 + beat * 0.4})`);
    glow.addColorStop(1, "rgba(255,70,90,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-48, -48, 96, 96);
    ctx.globalCompositeOperation = "source-over";

    // наконечник смотрит влево, на гусеницу
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-32, 0);
    ctx.lineTo(-2, -21);
    ctx.lineTo(-4, -9);
    ctx.lineTo(30, -9);
    ctx.lineTo(30, 9);
    ctx.lineTo(-4, 9);
    ctx.lineTo(-2, 21);
    ctx.closePath();
    ctx.fillStyle = "#ff3b5c";
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = OUTLINE; // тёмная обводка: на светлых облаках белая теряется
    ctx.stroke();
    ctx.restore();
  }

  /** Гусеница перескочила: столб света между линиями и след. */
  function drawZaps(dt) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = zaps.length - 1; i >= 0; i--) {
      const z = zaps[i];
      z.life -= dt / 0.22;
      if (z.life <= 0) { zaps.splice(i, 1); continue; }
      const w = 26 * z.life;
      const g = ctx.createLinearGradient(z.x - w, 0, z.x + w, 0);
      g.addColorStop(0, "rgba(120,235,255,0)");
      g.addColorStop(0.5, `rgba(235,252,255,${z.life})`);
      g.addColorStop(1, "rgba(120,235,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(z.x - w, Math.min(z.y0, z.y1), w * 2, Math.abs(z.y1 - z.y0));
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /** Экранные координаты точки мира. */
  const toScreen = (x, y) => ({ x: cssW * heroAt() + (x - camX) * scale, y: cssH / 2 + (y - camY) * scale * flipY() });

  /** Высота радуги на экране: тонкая дуга под панелью, в начале ивента она съезжает сверху. */
  function rainbowY(x, w, h) {
    const k = (x - w / 2) / (w / 2);
    return h * 0.25 - (1 - k * k) * h * 0.06 - (1 - zones.rainbow) * h * 0.5;
  }

  /** Где глаз n: летит над радугой, покачиваясь; после выстрела его отбрасывает назад. */
  function eyeAt(n, w, h) {
    const x = (((n / EYES + time * 0.035) % 1) * 1.06 - 0.03) * w;
    const kick = Math.max(0, 1 - (time - (shotAt[n] ?? -9)) / 0.25);
    return { x, y: rainbowY(x, w, h) - (24 + kick * 12) * scale + Math.sin(time * 2.6 + n * 2) * 7 * scale };
  }

  /** Луч в точку мира от случайного глаза: delay секунд он целится тонкой линией, потом hit() — попадание. */
  function fire(x, y, delay = 0, hit = null) {
    const eye = Math.floor(Math.random() * EYES);
    if (delay === 0) shotAt[eye] = time;
    lasers.push({ eye, x, y, delay, hit, life: 1, color: RAINBOW[Math.floor(Math.random() * RAINBOW.length)] });
  }

  /** Крыло глаза: перья расходятся от плеча. */
  function drawWing(u, flap) {
    ctx.save();
    ctx.rotate(-0.35 + flap * 0.6);
    ctx.fillStyle = "#f4eefe";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(u * 0.9, -u * 1.15, u * 2.2, -u * 0.8);
    ctx.lineTo(u * 1.75, -u * 0.42);
    ctx.lineTo(u * 1.85, -u * 0.12);
    ctx.lineTo(u * 1.35, -u * 0.1);
    ctx.lineTo(u * 1.3, u * 0.2);
    ctx.quadraticCurveTo(u * 0.6, u * 0.2, 0, u * 0.25);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Крылатый глаз: смотрит на персонажа, моргает, перед выстрелом наливается красным. */
  function drawEye(n, w, h, hx, hy) {
    const e = eyeAt(n, w, h), u = 9 * scale + 4;
    const aim = Math.atan2(hy - e.y, hx - e.x);
    const flap = Math.sin(time * 15 + n * 1.7);
    const charging = lasers.some((l) => l.eye === n && l.delay > 0);
    const blink = charging ? 0 : Math.max(0, Math.sin(time * 0.9 + n * 1.9)) ** 40;

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(Math.sin(time * 1.7 + n) * 0.12);
    if (charging) {
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(0, 0, u * 0.5, 0, 0, u * 3);
      g.addColorStop(0, "rgba(255,50,80,.8)");
      g.addColorStop(1, "rgba(255,50,80,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-u * 3, -u * 3, u * 6, u * 6);
      ctx.globalCompositeOperation = "source-over";
    }
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * u * 0.8, -u * 0.1);
      ctx.scale(side, 1);
      drawWing(u, flap);
      ctx.restore();
    }

    const white = ctx.createRadialGradient(-u * 0.3, -u * 0.35, u * 0.1, 0, 0, u);
    white.addColorStop(0, "#fff");
    white.addColorStop(1, "#d8c9cf");
    ctx.fillStyle = white;
    ctx.beginPath();
    ctx.arc(0, 0, u, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    ctx.save();
    ctx.clip();
    // прожилки
    ctx.strokeStyle = "rgba(210,40,60,.55)";
    ctx.lineWidth = 0.9;
    for (let v = 0; v < 6; v++) {
      const a = v * 1.05 + n;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * u, Math.sin(a) * u);
      ctx.quadraticCurveTo(Math.cos(a + 0.4) * u * 0.8, Math.sin(a + 0.4) * u * 0.8, Math.cos(a) * u * 0.55, Math.sin(a) * u * 0.55);
      ctx.stroke();
    }
    const ix = Math.cos(aim) * u * 0.42, iy = Math.sin(aim) * u * 0.42;
    ctx.fillStyle = charging ? "#ff2448" : RAINBOW[(n * 2 + 4) % RAINBOW.length];
    ctx.beginPath();
    ctx.arc(ix, iy, u * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0a0614";
    ctx.beginPath();
    ctx.arc(ix, iy, u * (charging ? 0.16 : 0.27), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ix - u * 0.14, iy - u * 0.16, u * 0.1, 0, Math.PI * 2);
    ctx.fill();
    // веки смыкаются при моргании
    if (blink > 0.02) {
      ctx.fillStyle = "#c9a2b4";
      ctx.fillRect(-u, -u, u * 2, u * blink);
      ctx.fillRect(-u, u - u * blink, u * 2, u * blink);
    }
    ctx.restore();
    ctx.restore();
  }

  /** «Радуга»: тонкая переливающаяся дуга и крылатые глаза над ней, все следят за персонажем. */
  function drawRainbow(w, h, hx, hy) {
    if (zones.rainbow < 0.02) return;
    const band = 2.6 * scale + 1;
    ctx.lineCap = "round";
    RAINBOW.forEach((color, i) => {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.72 + Math.sin(time * 3 + i * 0.8) * 0.2;
      ctx.lineWidth = band + 0.6;
      ctx.beginPath();
      for (let x = -20; x <= w + 20; x += 24) ctx.lineTo(x, rainbowY(x, w, h) + i * band);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // блики бегут вдоль дуги
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 5; i++) {
      const x = ((time * 0.17 + i * 0.21) % 1) * w;
      ctx.beginPath();
      ctx.arc(x, rainbowY(x, w, h) + band * 3, 1.6 + Math.sin(time * 9 + i) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    for (let n = 0; n < EYES; n++) drawEye(n, w, h, hx, hy);
  }

  /** Лучи: сначала дрожащая линия прицела, потом рваный луч со вспышкой в точке попадания. */
  function drawLasers(dt) {
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";
    for (let i = lasers.length - 1; i >= 0; i--) {
      const l = lasers[i];
      const from = eyeAt(l.eye, cssW, cssH), to = toScreen(l.x, l.y);
      if (l.delay > 0) {
        l.delay -= dt;
        ctx.strokeStyle = `rgba(255,70,100,${0.35 + Math.random() * 0.5})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (l.delay <= 0) {
          shotAt[l.eye] = time;
          if (l.hit) l.hit();
        }
        continue;
      }
      l.life -= dt / 0.2;
      if (l.life <= 0) { lasers.splice(i, 1); continue; }
      const dx = to.x - from.x, dy = to.y - from.y;
      for (const [width, color] of [[7, l.color], [2, "#fff"]]) {
        ctx.globalAlpha = l.life;
        ctx.strokeStyle = color;
        ctx.lineWidth = width * (0.6 + l.life * 0.4);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        for (let k = 1; k < 6; k++) {
          const off = (Math.random() - 0.5) * 7 * l.life;
          ctx.lineTo(from.x + dx * k / 6 - dy / (Math.hypot(dx, dy) || 1) * off, from.y + dy * k / 6 + dx / (Math.hypot(dx, dy) || 1) * off);
        }
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
      const r = 34 * scale * (1.4 - l.life);
      const glow = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      glow.addColorStop(0, `rgba(255,240,220,${l.life})`);
      glow.addColorStop(1, "rgba(255,80,60,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.fillRect(to.x - r, to.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /** Контур стены: неровный каменный столб, свой у каждой. */
  function wallShape(i) {
    if (wallShapes.has(i)) return wallShapes.get(i);
    const rand = rng(i * 7919 + 13), left = [], right = [], rows = 6;
    for (let r = 0; r <= rows; r++) {
      const y = -WALL_HEIGHT + (r / rows) * WALL_HEIGHT * 2;
      const taper = r === 0 ? 0.55 : 1;
      left.push([-WALL_WIDTH * taper * (0.8 + rand() * 0.45), y]);
      right.push([WALL_WIDTH * taper * (0.8 + rand() * 0.45), y]);
    }
    const cracks = [];
    for (let c = 0; c < 7; c++) {
      const y = (rand() - 0.5) * WALL_HEIGHT * 1.5, dir = rand() < 0.5 ? -1 : 1;
      cracks.push([[0, y], [dir * WALL_WIDTH * 0.45, y + (rand() - 0.5) * 22], [dir * WALL_WIDTH, y + (rand() - 0.5) * 40]]);
    }
    const shape = { left, right, cracks };
    wallShapes.set(i, shape);
    return shape;
  }

  /** Каменная стена: вырывается из пути с перехлёстом, k — насколько выросла; от ударов в ней раскаляются трещины. */
  function drawWall(i, k, crack) {
    const pts = map.segs[i], p = pts[pts.length - 1], { left, right, cracks } = wallShape(i);
    const c = k - 1, rise = k >= 1 ? 1 : 1 + 2.7 * c * c * c + 1.7 * c * c;
    const quake = reduce ? 0 : crack * 3.5;
    ctx.save();
    ctx.translate(p[0] + (Math.random() - 0.5) * quake, p[1] + WALL_HEIGHT + (Math.random() - 0.5) * quake);
    ctx.scale(1, rise);
    ctx.translate(0, -WALL_HEIGHT);

    const outline = () => {
      ctx.beginPath();
      left.forEach(([x, y]) => ctx.lineTo(x, y));
      [...right].reverse().forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.closePath();
    };
    const stone = ctx.createLinearGradient(-WALL_WIDTH, 0, WALL_WIDTH, 0);
    stone.addColorStop(0, "#8f8a9c");
    stone.addColorStop(0.5, "#5f5a6d");
    stone.addColorStop(1, "#2f2b3a");
    outline();
    ctx.fillStyle = stone;
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#141020";
    ctx.stroke();

    // грани камня
    ctx.save();
    outline();
    ctx.clip();
    ctx.strokeStyle = "rgba(0,0,0,.28)";
    ctx.lineWidth = 2;
    for (let r = 1; r < left.length - 1; r++) {
      ctx.beginPath();
      ctx.moveTo(left[r][0], left[r][1]);
      ctx.lineTo(right[r][0] * 0.3, left[r][1] + 9);
      ctx.lineTo(right[r][0], right[r][1]);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,.3)";
    ctx.beginPath();
    left.forEach(([x, y]) => ctx.lineTo(x + 3, y));
    ctx.stroke();

    // трещины идут вслед за ударами и светятся изнутри
    const open = Math.ceil(crack * cracks.length);
    for (let n = 0; n < open; n++) {
      ctx.lineCap = "round";
      ctx.strokeStyle = "#120a12";
      ctx.lineWidth = 4;
      ctx.beginPath();
      cracks[n].forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.stroke();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(255,${120 + (crack * 100 | 0)},40,${0.55 + Math.sin(time * 14 + n) * 0.3})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();

    if (crack > 0.3) {
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 70);
      glow.addColorStop(0, `rgba(255,150,50,${crack * 0.55})`);
      glow.addColorStop(1, "rgba(255,90,30,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(-70, -70, 140, 140);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
  }

  /** Стена разлетается: обломки с вращением падают вниз, дым и искры. */
  function shatter(x, y) {
    flashOf(0.32, [255, 150, 60]);
    shake = Math.max(shake, 0.7);
    punch = Math.max(punch, 0.6);
    kick(0.07);
    ring(x, y, 170, "#ffb060");
    pixels(x, y, 26, "#ffb060", 1.4);
    if (reduce) return;
    for (let n = 0; n < 16; n++) {
      chunks.push({
        x: x + (Math.random() - 0.5) * WALL_WIDTH * 2,
        y: y + (Math.random() - 0.5) * WALL_HEIGHT * 2,
        vx: 80 + Math.random() * 420,
        vy: -280 + Math.random() * 300,
        a: Math.random() * 6,
        spin: (Math.random() - 0.5) * 16,
        size: 4 + Math.random() * 10,
        life: 0.8 + Math.random() * 0.6,
        color: ["#8f8a9c", "#5f5a6d", "#2f2b3a"][n % 3],
      });
    }
  }

  function drawChunks(dt) {
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i];
      c.life -= dt;
      if (c.life <= 0) { chunks.splice(i, 1); continue; }
      c.vy += 1100 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.a += c.spin * dt;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.a);
      ctx.globalAlpha = Math.min(1, c.life * 2);
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.moveTo(-c.size, -c.size * 0.5);
      ctx.lineTo(c.size * 0.6, -c.size);
      ctx.lineTo(c.size, c.size * 0.4);
      ctx.lineTo(-c.size * 0.3, c.size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** Жизни у стены: маленькие сердечки над персонажем. Потерянная гаснет. */
  function drawHearts(x, y, hp) {
    ctx.font = "900 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    for (let i = 0; i < 10; i++) {
      const hx = x + (i - 4.5) * 12;
      ctx.strokeText("♥", hx, y);
      ctx.fillStyle = i < hp ? "#ff3b5c" : "#5a5570";
      ctx.fillText("♥", hx, y);
    }
    ctx.textBaseline = "alphabetic";
  }

  /** Где чёрная дыра на экране: k — насколько она далеко: 1 — старт у левого края, больше — отогнана за него; пока ивент начинается, она выезжает слева. */
  function holePoint(k, pathY) {
    return {
      x: cssW * heroAt() - 70 * scale - k * cssW * 0.58 - (1 - zones.rast) * cssW * 0.6,
      y: cssH / 2 + (pathY - camY) * scale,
      r: cssH * (0.24 + Math.max(0, 1 - k) * 0.12),
    };
  }

  /** «Раст»: чёрная дыра с крутящимся диском; чем ближе, тем сильнее тянет частицы. */
  function drawHole(pathY) {
    if (zones.rast < 0.02) return;
    const { x, y, r } = holePoint(holeShown, pathY);
    ctx.save();
    ctx.translate(x, y);

    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2.6);
    halo.addColorStop(0, `rgba(255,70,100,${0.55 + beat * 0.3})`);
    halo.addColorStop(0.5, "rgba(120,50,255,.28)");
    halo.addColorStop(1, "rgba(120,50,255,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(-r * 2.6, -r * 2.6, r * 5.2, r * 5.2);

    // рукава диска закручиваются внутрь
    ctx.lineCap = "round";
    for (let arm = 0; arm < 6; arm++) {
      const off = (arm / 6) * Math.PI * 2 + time * 2.4;
      ctx.strokeStyle = arm % 2 ? "rgba(255,170,90,.75)" : "rgba(190,120,255,.7)";
      ctx.lineWidth = 7 * scale + 2;
      ctx.beginPath();
      for (let k = 0; k <= 1; k += 0.03) {
        const a = off + k * 3.4, d = r * (1.75 - k * 0.8);
        ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d * 0.62);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    const core = ctx.createRadialGradient(0, 0, r * 0.7, 0, 0, r);
    core.addColorStop(0, "#000");
    core.addColorStop(0.9, "#000");
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffd9c2";
    ctx.lineWidth = 3 + beat * 4;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.93, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Новая молния: ломаная сверху вниз. */
  function addBolt(w, h) {
    const pts = [];
    let x = w * (0.35 + Math.random() * 0.6);
    for (let y = 0; y < h * 0.8; y += h * 0.06) {
      pts.push([x, y]);
      x += (Math.random() - 0.5) * h * 0.12;
    }
    bolts.push({ pts, life: 1 });
  }

  /** Шторм: темно везде, кроме света вокруг персонажа; молния на миг показывает весь уровень. */
  function drawStorm(dt, w, h, hx, hy) {
    const dark = 0.82 * zones.storm * (1 - Math.min(1, strike * 1.3));
    if (dark > 0.01) {
      const g = ctx.createRadialGradient(hx, hy, 90 * scale, hx, hy, 470 * scale);
      g.addColorStop(0, "rgba(5,6,24,0)");
      g.addColorStop(1, `rgba(5,6,24,${dark})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.life -= dt / 0.28;
      if (b.life <= 0) { bolts.splice(i, 1); continue; }
      for (const [width, a] of [[16, 0.25], [4, 1]]) {
        ctx.strokeStyle = `rgba(215,205,255,${a * b.life})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        b.pts.forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

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

  function drawPops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      p.k += dt / POP_SECONDS;
      if (p.k >= 1) { pops.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(p.x, p.y);
      cells.pop(ctx, opts.cell, p.k, p.r, p.color, time);
      ctx.restore();
    }
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
    // на узком экране мельче, иначе впереди видно только одну стрелку
    scale = Math.min(h / VIEW_H, w / MIN_VIEW_W);
    viewW = w / scale;
    return true;
  }

  /** Перенос мира на экран: персонаж слева, камера мягко идёт за стенами коридора. */
  function applyCamera() {
    const sx = reduce ? 0 : (Math.random() - 0.5) * shake * 18;
    const sy = reduce ? 0 : (Math.random() - 0.5) * shake * 18;
    const zoom = reduce ? 1 : 1 + beat * 0.022 + punch * 0.09 - zones.over * 0.07 + danger * 0.03 + Math.sin(time * 1.1) * 0.006;
    // камера дышит: медленно покачивается и пружинит от ударов
    const sway = Math.sin(time * 0.6) * 0.012 + Math.sin(time * 0.23) * 0.008;
    ctx.translate(cssW * heroAt() + sx, cssH / 2 + sy);
    ctx.rotate(reduce ? 0 : tilt + roll + sway);
    ctx.scale(scale * zoom, scale * zoom * flipY());
    ctx.translate(-camX, -camY);
  }

  // ---------- Что вызывает app.js ----------

  /** @param o { seed, level, fast, sight — сколько ячеек видно (0 — все), mirror, theme — дизайн из лобби, cell — скин ячеек, hero — скин персонажа, ufo — скин НЛО, jump — секунд в прыжке с НЛО, trailOf(i) — кайма следа } */
  function start(o) {
    opts = o;
    // ячейки за чартом запоминают, какой чарт их меняет
    let chartAt = -1;
    o.level.forEach((cell, i) => {
      if (cell.chart || cell.swam || cell.event) chartAt = i;
      cell.chartAt = chartAt;
    });
    reached = 0;
    map = build(o.level, o.fast, o.seed, o.theme);
    s = 0;
    parts = [];
    pops = [];
    mateShown = new Map();
    section = 0;
    palette = map.colors;
    flash = shake = beat = heat = tilt = 0;
    fly = null;
    inAir = false;
    landed = recoil = 0;
    rings = [];
    ghosts = [];
    bolts = [];
    zones = { over: 0, storm: 0, flip: 0, rast: 0, rainbow: 0, cloud: 0 };
    puff = null;
    crawlY = lastLane = 1;
    zaps = [];
    morphed = 0;
    rain = null;
    lasers = [];
    shotAt = [];
    chunks = [];
    wallShapes = new Map();
    roll = 0;
    flashRgb = [255, 255, 255];
    holeShown = 1;
    eaten = beatAt = 0;
    zoneNow = null;
    strike = strikeAt = punch = danger = 0;
    lastPart = null;
    lastNow = performance.now();
    camX = 0;
    camY = wallAt(map.walls, 0, map.walls.mid);
  }

  /** Сцена переходит к другому игроку: его персонаж, скин ячеек и место на уровне. */
  function follow({ hero, cell, trailOf, pos }) {
    Object.assign(opts, { hero, cell, trailOf });
    s = pos;
    pops = [];
    fly = null;
    rain = null;
    puff = null;
    eaten = 0;
    flash = Math.max(flash, 0.4);
  }

  /** Ошибка игрока: тряска и красная вспышка. */
  function hit() {
    shake = 1;
    punch = Math.max(punch, 0.5);
    kick(0.06);
    flashOf(0.3, [255, 40, 70]);
    const p = at(s);
    pixels(p.x, p.y, 16, "#ff3b5c");
    ring(p.x, p.y, 200, "#ff3b5c");
  }

  /** Дыра догнала игрока: он сжимается в точку. */
  function devour() {
    eaten = 0.001;
    flash = 1;
    shake = 1;
    const p = at(s);
    pixels(p.x, p.y, 40, "#ff3b5c", 1.6);
  }

  /** Свам i пройден: дорога разлетается, с неба прилетает НЛО и превращает ячейки в препятствия. */
  function swam(i) {
    flash = Math.max(flash, 0.7);
    shake = Math.max(shake, 0.8);
    if (reduce) return;
    fly = { start: time, from: i, struck: new Set(), landed: false };
    for (let k = i + 1; ufoCell(k) && opts.level[k].chartAt === i; k++) {
      const pts = map.segs[k], p = at(k + 0.5);
      pixels(p.x, p.y, 14, COLORS[opts.level[k].was], 1.3);
      pixels(pts[1][0], pts[1][1], 8, "#fff", 1);
    }
  }

  /** НЛО на своём месте под персонажем; в сцене прилёта оно влетает из верхнего угла, огромное, с хвостом света. */
  function drawRide(x, y, drop) {
    if (fly && time - fly.start > 2.2) fly = null;
    if (!fly || fly.landed) {
      if (drop > 1) drawUfo(opts.ufo, x, y + recoil * 20 + landed * 12 + Math.sin(time * 5) * 5, drop / UFO_DROP, recoil * 0.1 - landed * 0.06);
      return;
    }
    const k = clamp((time - fly.start) / UFO_ARRIVE, 0, 1), e = 1 - (1 - k) ** 3;
    const ux = x + (1 - e) * viewW * 0.85, uy = y - (1 - e) * 560;
    if (k < 1) {
      ctx.globalCompositeOperation = "lighter";
      const tail = ctx.createLinearGradient(ux, uy, ux + 620, uy - 410);
      tail.addColorStop(0, "rgba(120,240,255,.8)");
      tail.addColorStop(1, "rgba(120,240,255,0)");
      ctx.strokeStyle = tail;
      ctx.lineCap = "round";
      ctx.lineWidth = 60 * (1 - e) + 10;
      ctx.beginPath();
      ctx.moveTo(ux, uy);
      ctx.lineTo(ux + 620, uy - 410);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    } else if (!fly.landed) {
      fly.landed = true;
      flashOf(0.8, [150, 245, 255]);
      shake = 1;
      kick(0.1);
      pixels(x, y, 40, "#8ff4ff", 1.6);
      pixels(x, y, 20, "#fff", 1.2);
    }
    drawUfo(opts.ufo, ux, uy, 1 + (1 - e) * 2, (1 - e) * 0.55);
  }

  /** Экранные координаты стрелки ползунка i — для искр на общем слое эффектов. */
  function point(i) {
    if (!map || !resize()) return [0, 0];
    const pts = map.segs[Math.min(i, map.segs.length - 1)], p = pts[pts.length - 1];
    const r = canvas.getBoundingClientRect();
    return [r.left + cssW * heroAt() + (p[0] - camX) * scale, r.top + cssH / 2 + (p[1] - camY) * scale * flipY()];
  }

  /** Начался ивент на ячейке i: вспышка, толчок камеры, волна и пиксели его цвета. */
  function event(kind, i) {
    const pts = map.segs[i], p = pts[pts.length - 1], e = EVENTS[kind];
    flashOf(0.75, e.rgb);
    shake = Math.max(shake, 0.8);
    punch = 1;
    kick(0.11);
    ring(p[0], p[1], 520, e.color);
    ring(p[0], p[1], 280, "#fff");
    pixels(p[0], p[1], 44, e.color, 1.6);
    if (kind === "storm") strikeAt = time; // шторм начинается с молнии
    if (kind === "rainbow") rain = { start: time, from: i, fired: new Set() };
    if (kind === "cloud") {
      // клуб дыма, из которого выходит гусеница; прежняя дорога разлетается
      puff = { start: time, from: i };
      morphed = 1;
      crawlY = lastLane = 1;
      ring(p[0], p[1], 340, "#fff");
      pixels(p[0], p[1], 40, "#d9f3ff", 1.5);
      for (let k = i + 1; opts.level[k]?.zone === "cloud"; k++) {
        const c = at(k + 0.5);
        pixels(c.x, c.y, 10, COLORS[opts.level[k].was], 1.2);
      }
    }
  }

  /** Стрелка пролетела мимо гусеницы: свист и искры на её линии. */
  function dodged(i) {
    const pts = map.segs[i], p = pts[pts.length - 1];
    const y = p[1] + (opts.level[i].lane === 0 ? -1 : 1) * CLOUD_LANE;
    ring(p[0], y, 110, "#ffb060");
    pixels(p[0], y, 14, "#ffb060", 1.1);
    shake = Math.max(shake, 0.28);
    punch = Math.max(punch, 0.28);
    flashOf(0.1, [255, 190, 110]);
    kick(0.022);
  }

  /** Лазер попал в игрока у стены. */
  function laser() {
    const p = at(s);
    fire(p.x, p.y);
    shake = Math.max(shake, 0.6);
    punch = Math.max(punch, 0.35);
    kick(0.05);
    flashOf(0.24, [255, 40, 70]);
    pixels(p.x, p.y, 14, "#ff3b5c");
    ring(p.x, p.y, 90, "#ff3b5c");
  }

  /** Удар по стене: летят каменные брызги и искры. */
  function brick() {
    const p = at(s);
    shake = Math.max(shake, 0.3);
    punch = Math.max(punch, 0.2);
    kick(0.018);
    flashOf(0.1, [255, 170, 80]);
    pixels(p.x + 30, p.y, 9, "#d8c9b0", 0.8);
    pixels(p.x + 30, p.y, 5, "#ffb060", 1);
  }

  /** Отметка на пути: волна от персонажа. */
  function pulse(color) {
    const me = at(s);
    flash = Math.max(flash, 0.3);
    punch = Math.max(punch, 0.6);
    ring(me.x, me.y, 420, color);
    pixels(me.x, me.y, 24, color, 1.3);
  }

  /** Чарт пройден: следующие ячейки стали одинаковыми — вспышка и пиксели на каждой из них. */
  function chart(i) {
    flash = Math.max(flash, 0.35);
    shake = Math.max(shake, 0.4);
    const color = COLORS[opts.level[i + 1].arrow];
    for (let k = i + 1; k < opts.level.length && opts.level[k].was !== null && opts.level[k].chartAt === i; k++) {
      const p = map.segs[k][map.segs[k].length - 1];
      pixels(p[0], p[1], 8, color);
    }
  }

  /** Ячейка заполнена: она лопается в стиле скина, разлетаются пиксели. */
  function filled(i) {
    if (ufoCell(i)) return; // препятствие перепрыгнули, а не заполнили: оно остаётся позади
    if (opts.level[i].zone === "cloud") {
      dodged(i);
      return;
    }
    const pts = map.segs[Math.min(i, map.segs.length - 1)], p = pts[pts.length - 1];
    if (opts.level[i].wall) {
      shatter(p[0], p[1]);
      return;
    }
    kick(opts.fast ? 0.006 : 0.014);
    const color = COLORS[opts.level[i].arrow];
    pixels(p[0], p[1], opts.fast ? 10 : 22, color);
    ring(p[0], p[1], opts.fast ? 70 : 120, color);
    punch = Math.max(punch, opts.fast ? 0.12 : 0.25);
    shake = Math.max(shake, opts.fast ? 0.1 : 0.22);
    flash = Math.max(flash, opts.fast ? 0.04 : 0.1);
    if (!reduce) pops.push({ x: p[0], y: p[1], r: opts.fast ? 31 : 41, color, k: 0 });
  }

  /** Превью скина персонажа на экране скинов. */
  function paintHero(target, id) {
    const c = target.getContext("2d");
    c.clearRect(0, 0, target.width, target.height);
    drawHero(c, id, target.width / 2, target.height / 2, 0, target.width / 84);
  }

  /**
   * Кадр. o: { pos — номер ползунка + доля, wrong, holding, air — сколько секунд длится прыжок с НЛО, lane — линия гусеницы в «Кловде», hole — дыра «Раста»: 0 — у игрока, 1 — у левого края, больше — за ним, hp — жизни у стены «Радуги» или null, mates: [{ slot, pos, air, name, color }],
   * energy — сила удара в музыке 0..1, part — часть трека ("drop", "build" ...) или null, final — близко к финишу }.
   */
  function frame(now, o) {
    if (!map || !resize()) return;
    const dt = Math.min((now - lastNow) / 1000, 0.05);
    lastNow = now;
    time += dt;

    const n = map.segs.length;
    const target = Math.min(o.pos, n + 1);
    reached = Math.floor(target);
    s += (target - s) * (1 - Math.exp(-dt * (opts.fast ? 24 : 34)));
    if (Math.abs(target - s) < 0.001) s = target;

    // музыка качает сцену; на дропе — вспышка и полосы света
    beat = Math.max(o.energy, beat * Math.exp(-dt * 7));
    const part = o.part;
    // сильный удар на дропе: мир вздрагивает и вспыхивает
    if (o.energy > 0.55 && heat > 0.5 && time - beatAt >= BEAT_GAP) {
      beatAt = time;
      flashOf(0.2, palette.glow);
      shake = Math.max(shake, 0.32);
      punch = Math.max(punch, 0.3);
      kick(0.012);
    }
    if (part !== lastPart) {
      if (part && part.startsWith("drop")) {
        flashOf(1, palette.glow);
        shake = Math.max(shake, 0.5);
        punch = 1;
        kick(0.05);
        const p = at(s);
        ring(p.x, p.y, 640, rgba(palette.glow));
      }
      lastPart = part;
    }
    const hot = part && part.startsWith("drop") ? 1 : part === "build" || part === "intro" ? 0.35 : 0;
    heat += (Math.max(hot, zones.over) - heat) * (1 - Math.exp(-dt * 4));
    flash *= Math.exp(-dt * 5);
    shake *= Math.exp(-dt * 7);
    punch *= Math.exp(-dt * 8);
    roll *= Math.exp(-dt * 6);
    danger += ((o.final ? 1 : 0) - danger) * (1 - Math.exp(-dt * 2));

    // ивент текущей ячейки: включается и гаснет плавно, космос уходит в его цвета
    zoneNow = s < n ? opts.level[Math.floor(s)].zone : null;
    for (const k of Object.keys(zones)) zones[k] += ((zoneNow === k ? 1 : 0) - zones[k]) * (1 - Math.exp(-dt * 3.5));
    const tinted = zones.cloud > zones.over ? [CLOUD_PALETTE, zones.cloud] : [OVER_PALETTE, zones.over];
    if (tinted[1] > 0.01) {
      palette = {};
      for (const key of Object.keys(OVER_PALETTE)) palette[key] = mixRgb(map.colors[key], tinted[0][key], tinted[1]);
    } else {
      palette = map.colors;
    }
    morphed *= Math.exp(-dt * 4);

    // «Радуга»: лазеры летят в ячейки, там вырастают стены
    if (rain) {
      for (let i = rain.from + 2; opts.level[i]?.wall && opts.level[i].chartAt === rain.from; i += 2) {
        if (rain.fired.has(i) || time < wallTime(i) - CHARGE) continue;
        rain.fired.add(i);
        if (reached >= i) continue;
        const pts = map.segs[i], p = pts[pts.length - 1];
        fire(p[0], p[1], CHARGE, () => {
          // из точки попадания вырывается камень
          shake = Math.max(shake, 0.55);
          punch = Math.max(punch, 0.4);
          kick(0.04);
          flashOf(0.22, [255, 200, 120]);
          pixels(p[0], p[1], 20, "#d8c9b0", 1.2);
          pixels(p[0], p[1] + WALL_HEIGHT, 14, "#8f8a9c", 0.8);
          ring(p[0], p[1], 120, "#ffd84d");
          if (opts.laser) opts.laser();
        });
      }
    }

    // «Раст»: чем ближе дыра, тем сильнее трясёт; она затягивает частицы
    holeShown += ((o.hole ?? 1) - holeShown) * (1 - Math.exp(-dt * 14));
    const close = zoneNow === "rast" ? Math.max(0, 1 - holeShown) : 0;
    shake = Math.max(shake, close * close * 0.9);
    if (eaten > 0) eaten = Math.min(1, eaten + dt / 0.7);

    strike *= Math.exp(-dt * 7);
    if (zoneNow === "storm" && time >= strikeAt) {
      strikeAt = time + 0.9 + Math.random() * 1.1;
      strike = 1;
      shake = Math.max(shake, 0.35);
      kick(0.03);
      if (!reduce) addBolt(cssW, cssH);
      if (opts.thunder) opts.thunder();
    }

    // новая секция: меняется только форма пути, стиль уровня остаётся
    const secIdx = map.sections.indexOf(sectionAt(s));
    if (secIdx !== section) {
      section = secIdx;
      flashOf(0.3, palette.glow);
      punch = Math.max(punch, 0.5);
      kick(0.035);
      const p = at(s);
      pixels(p.x, p.y, 26, rgba(palette.glow));
      ring(p.x, p.y, 300, rgba(palette.glow));
    }

    const me = at(s);
    // камера смотрит на путь: НЛО и прыжки её не качают
    const pathY = me.y, drop = dropAt(s);
    me.y += drop - jumpLift(o.air);

    // гусеница мгновенно перескакивает между потолком и полом; в прыжке — столб света, тряска и поворот камеры
    const crawling = cloudShown(Math.floor(s));
    if (crawling) {
      const lane = o.lane ?? 1;
      if (lane !== lastLane) {
        lastLane = lane;
        zaps.push({ x: me.x, y0: pathY - CLOUD_LANE, y1: pathY + CLOUD_LANE, life: 1 });
        const landY = pathY + (lane === 0 ? -1 : 1) * CLOUD_LANE;
        pixels(me.x, landY, 16, "#9fe8ff", 1.1);
        ring(me.x, landY, 100, "#9fe8ff");
        shake = Math.max(shake, 0.4);
        punch = Math.max(punch, 0.3);
        flashOf(0.16, [150, 230, 255]);
        kick(0.035);
      }
      const want = lane === 0 ? -1 : 1;
      crawlY += (want - crawlY) * (1 - Math.exp(-dt * 60));
      me.y = pathY + crawlY * CLOUD_LANE;
    }

    // толчок при прыжке и удар при приземлении качают и персонажа, и НЛО
    const air = o.air >= 0;
    if (air && !inAir) {
      recoil = 1;
      kick(0.02);
      pixels(me.x, pathY + drop, 12, "#8ff4ff", 0.7);
    } else if (!air && inAir && drop > 1) {
      landed = 1;
      kick(0.025);
      shake = Math.max(shake, 0.3);
      pixels(me.x, pathY + drop + 26, 14, "#fff", 0.7);
    }
    inAir = air;
    recoil *= Math.exp(-dt * 8);
    landed *= Math.exp(-dt * 10);

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
    // гусеница сыплет искрами с ножек
    if (!reduce && crawling) {
      pixel(me.x - 24, me.y + crawlY * 22, -220 - Math.random() * 160, -crawlY * Math.random() * 90, 0.35, 3 + Math.random() * 5, Math.random() < 0.5 ? "#fff" : "#9fe8ff");
    }
    // в воздухе плавает пыль, мир не стоит на месте
    if (!reduce && Math.random() < 0.5) {
      const dx = (Math.random() - 0.3) * viewW, dy = (Math.random() - 0.5) * VIEW_H;
      pixel(me.x + dx, camY + dy, -30 - Math.random() * 60, -14 + Math.random() * 28, 1.4 + Math.random() * 1.4, 1.5 + Math.random() * 3, "rgba(255,255,255,.55)");
    }
    // след двигателя НЛО
    if (!reduce && drop > 1 && (!fly || fly.landed)) {
      pixel(me.x - 40 - Math.random() * 40, pathY + drop + UFO_UNDER + 30, -160 - Math.random() * 120, 30 + Math.random() * 90, 0.3 + Math.random() * 0.4, 4 + Math.random() * 6, "#8ff4ff");
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scene = map.scene;
    const view = { w: cssW, h: cssH, camX, camY, scale: cssH / VIEW_H, time, beat, heat };
    if (scene) {
      scenes.back(scene, ctx, view);
    } else {
      drawSky(cssW, cssH);
      drawFar(cssW, cssH);
    }

    ctx.save();
    applyCamera();
    const left = camX - viewW * heroAt() - 120;
    const right = camX + viewW * (1 - heroAt()) + 120;
    if (!scene) {
      drawWalls(left, right);
      drawDeco(left, right);
    }
    drawPortals(left, right);
    if (zones.rast > 0.01) {
      // весь мир исчезает: остаются чернота, дорога и персонаж
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, zones.rast * 1.15)})`;
      ctx.fillRect(0, 0, cssW, cssH);
      drawHole(pathY); // ячейки рисуются поверх дыры: стрелки видны, даже когда она вплотную
      ctx.restore();
    }
    drawClouds(left, right, pathY);
    drawZaps(dt);
    drawTrail();
    if (s < n) {
      drawRoad(right);
      const last = visibleRange(right);
      // пройденные препятствия остаются позади, пока не уедут за экран
      for (let i = last - 1; i >= Math.max(0, cur - 3); i--) {
        if (cloudShown(i)) {
          drawDart(i, pathY);
          continue;
        }
        const wall = i >= cur ? wallK(i) : 0;
        if (wall > 0) {
          drawWall(i, wall, i === cur ? s - cur : 0);
          if (wall >= 1) continue;
        }
        const m = morph(i);
        if (m > 0) drawObstacle(i, m);
        if (i < cur || m >= 1) continue;
        ctx.globalAlpha = 1 - m;
        drawKey(i, i === cur && m === 0, s - cur, o.wrong);
        ctx.globalAlpha = 1;
      }
      drawStrikes();
    }
    drawRings(dt);
    drawPops(dt);
    drawMates(o.mates, dt);
    drawChunks(dt);
    drawParts(dt);
    drawRide(me.x, pathY + UFO_DROP + UFO_UNDER, drop);
    drawGhosts(me);
    if (zoneNow === "rast" && !reduce) {
      // частицы летят из пустоты в дыру
      const h = holePoint(holeShown, pathY);
      const hx = camX + (h.x - cssW * heroAt()) / scale;
      for (let i = 0; i < 3; i++) {
        const py = pathY + (Math.random() - 0.5) * 520;
        const px = hx + 140 + Math.random() * 500;
        pixel(px, py, (hx - px) * 2.2, (pathY - py) * 2.2, 0.45, 3 + Math.random() * 5, Math.random() < 0.5 ? "#ff8a6a" : "#b78cff");
      }
    }

    // у финишного портала персонаж уменьшается и исчезает
    const gone = clamp(n + 1 - s, 0, 1) * (1 - eaten);
    if (gone > 0.02) {
      const jitter = o.wrong && !reduce ? (Math.random() - 0.5) * 7 : 0;
      if (crawling) {
        // клуб дыма превращения
        if (morphed > 0.05) {
          ctx.fillStyle = rgba([235, 250, 255], morphed);
          ctx.beginPath();
          ctx.arc(me.x, me.y, 30 + (1 - morphed) * 70, 0, Math.PI * 2);
          ctx.fill();
        }
        drawCaterpillar(me.x, me.y + crawlY * 2, crawlY >= 0 ? 1 : -1, gone * (1 + beat * 0.1));
      }
      // на НЛО: покачивается стоя и крутит сальто в прыжке, сжимается при толчке и приземлении
      const squash = landed * 0.34 - recoil * 0.22;
      const pose = drop > 1 || air
        ? { spin: air ? Math.min(1, o.air / opts.jump) * Math.PI * 2 : Math.sin(time * 7) * 0.12, sx: 1 + squash, sy: 1 - squash }
        : undefined;
      if (!crawling) drawHero(ctx, opts.hero, me.x + jitter, me.y + jitter + (air ? 0 : Math.sin(time * 5) * 5 + landed * 12), me.a, (o.holding ? 1.14 : 1) * gone, undefined, pose);
    }
    ctx.restore();

    if (scene && zones.rast < 0.5) scenes.front(scene, ctx, view);
    const heroPos = toScreen(me.x, me.y);
    drawRainbow(cssW, cssH, heroPos.x, heroPos.y);
    drawLasers(dt);
    if (o.hp !== null && o.hp !== undefined) drawHearts(heroPos.x, heroPos.y - 44 * scale, o.hp);
    drawStorm(dt, cssW, cssH, cssW * heroAt(), cssH / 2 + (me.y - camY) * scale * flipY());
    drawStreaks(cssW, cssH);
    drawVignette(cssW, cssH);
    drawEdges(cssW, cssH, EVENTS.over.rgb, zones.over * (0.3 + beat * 0.3));
    drawEdges(cssW, cssH, EVENTS.flip.rgb, zones.flip * 0.28);
    drawEdges(cssW, cssH, EVENTS.cloud.rgb, zones.cloud * (0.22 + beat * 0.3));
    drawEdges(cssW, cssH, [255, 40, 70], Math.max(danger * (0.16 + beat * 0.34), close * 0.7));
    if (!reduce && flash > 0.02) {
      ctx.fillStyle = rgba(flashRgb, flash * 0.6);
      ctx.fillRect(0, 0, cssW, cssH);
    }
    if (o.wrong) {
      ctx.fillStyle = "rgba(255,40,80,.16)";
      ctx.fillRect(0, 0, cssW, cssH);
    }
  }

  return { start, follow, frame, hit, devour, laser, brick, filled, chart, swam, event, pulse, point, paintHero, eventInfo: EVENTS };
})();
