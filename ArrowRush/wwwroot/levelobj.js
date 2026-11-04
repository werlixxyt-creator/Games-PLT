"use strict";

// Объекты уровня из редактора: блоки, стекло, эффекты, декор и триггеры. Один код рисует их в редакторе (edview.js) и в матче (course.js).
// Объект привязан к ячейке: { k — вид, c — номер ячейки, x, y — сдвиг от её стрелки, s — размер, v — цвет, текст или сила, r — поворот 0/90/180/270 }.
// На игру блоки и декор не влияют. Триггер срабатывает, когда игрок проходит свою ячейку: цвет, зум и наклон
// держатся до следующего такого же триггера, вспышка и тряска — разовые. Список видов есть и на сервере (LevelGenerator.EditorObjects).
const levelobj = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const OUTLINE = "#1d1340";
  const TAU = Math.PI * 2;

  /** Цвета, из которых выбирает автор. */
  const COLORS = ["#ffffff", "#ff4f9a", "#ffb31f", "#7ee03a", "#22c7f0", "#8b5cff", "#ff3b5c", "#1d1340"];

  // Вкладки палитры с объектами, по порядку (вкладки ячеек добавляет levels.js)
  const CATS = [
    ["blocks", "Блоки", "b-gem"],
    ["shapes", "Формы", "step"],
    ["slopes", "Склоны", "ramp"],
    ["glass", "Стекло", "g-block"],
    ["fx", "Эффекты", "fx-boom"],
    ["deco", "Декор", "d-gear"],
    ["triggers", "Триггеры", "t-color"],
  ];

  // cat — вкладка редактора; color — цвет нового объекта; r — радиус для клика; v — значение нового объекта;
  // old — вид из прошлых версий: рисуется в старых уровнях, но в палитре его нет
  const B = (name, color = "#22c7f0") => ({ cat: "blocks", name, color, r: 34 });
  const KINDS = {
    block: B("Блок"),
    "b-gem": B("Пирамида", "#8b5cff"),
    "b-inset": B("Утопленный", "#22c7f0"),
    "b-grid": B("Сетка", "#7ee03a"),
    "b-panel": B("Панели", "#22c7f0"),
    "b-brick": B("Кирпич", "#ff8a3d"),
    "b-stone": B("Камень", "#9a93b0"),
    "b-metal": B("Металл", "#b7c3d6"),
    "b-crate": B("Ящик", "#c98a4b"),
    "b-hazard": B("Опасность", "#ffb31f"),
    "b-tech": B("Схема", "#22c7f0"),
    "b-dark": B("Тёмный", "#ff4f9a"),
    "b-frame": B("Рамка", "#ffffff"),
    "b-checker": B("Шашки", "#ff4f9a"),
    "b-studs": B("Кнопки", "#ff3b5c"),

    half: { cat: "shapes", name: "Полублок", color: "#22c7f0", r: 34 },
    small: { cat: "shapes", name: "Кубик", color: "#22c7f0", r: 20 },
    slab: { cat: "shapes", name: "Плита", color: "#8b5cff", r: 62 },
    pillar: { cat: "shapes", name: "Колонна", color: "#8b5cff", r: 62 },
    plank: { cat: "shapes", name: "Балка", color: "#c98a4b", r: 62 },
    step: { cat: "shapes", name: "Ступени", color: "#7ee03a", r: 34 },
    cross: { cat: "shapes", name: "Крест", color: "#ffb31f", r: 34 },

    ramp: { cat: "slopes", name: "Рампа", color: "#22c7f0", r: 34 },
    ramp2: { cat: "slopes", name: "Пологая", color: "#22c7f0", r: 62 },
    "ramp-half": { cat: "slopes", name: "Малая", color: "#22c7f0", r: 34 },
    wedge: { cat: "slopes", name: "Клин", color: "#ff4f9a", r: 34 },
    curve: { cat: "slopes", name: "Дуга", color: "#7ee03a", r: 34 },

    "g-block": { cat: "glass", name: "Стекло", color: "#9fe8ff", r: 34 },
    "g-half": { cat: "glass", name: "Полустекло", color: "#9fe8ff", r: 34 },
    "g-pane": { cat: "glass", name: "Витрина", color: "#9fe8ff", r: 62 },
    "g-ramp": { cat: "glass", name: "Стекл. рампа", color: "#9fe8ff", r: 34 },
    "g-tile": { cat: "glass", name: "Окно", color: "#ffd36b", r: 34 },
    "g-crack": { cat: "glass", name: "Трещины", color: "#9fe8ff", r: 34 },
    "g-shards": { cat: "glass", name: "Осколки", color: "#9fe8ff", r: 40 },

    "fx-boom": { cat: "fx", name: "Взрыв", color: "#ff6a1f", r: 42 },
    "fx-bang": { cat: "fx", name: "Бах!", color: "#ffb31f", r: 46, v: "БАХ!" },
    "fx-spark": { cat: "fx", name: "Искра", color: "#ffffff", r: 34 },
    "fx-fire": { cat: "fx", name: "Огонь", color: "#ff6a1f", r: 38 },
    "fx-smoke": { cat: "fx", name: "Дым", color: "#b9b4c9", r: 42 },
    "fx-bolt": { cat: "fx", name: "Молния", color: "#ffe14a", r: 42 },
    "fx-debris": { cat: "fx", name: "Обломки", color: "#9a93b0", r: 46 },
    "fx-confetti": { cat: "fx", name: "Конфетти", color: "#ff4f9a", r: 42 },
    "fx-beam": { cat: "fx", name: "Луч", color: "#22c7f0", r: 62 },

    text: { cat: "deco", name: "Текст", color: "#ffffff", r: 40, v: "Текст" },
    star: { cat: "deco", name: "Звезда", color: "#ffb31f", r: 32 },
    crystal: { cat: "deco", name: "Кристалл", color: "#ff4f9a", r: 32 },
    lamp: { cat: "deco", name: "Лампа", color: "#ffb31f", r: 30 },
    "d-gear": { cat: "deco", name: "Шестерня", color: "#b7c3d6", r: 34 },
    "d-arrow": { cat: "deco", name: "Указатель", color: "#7ee03a", r: 34 },
    "d-sign": { cat: "deco", name: "Знак", color: "#ffb31f", r: 40 },
    "d-flag": { cat: "deco", name: "Флаг", color: "#ff3b5c", r: 46 },
    "d-chain": { cat: "deco", name: "Цепь", color: "#b7c3d6", r: 46 },
    "d-pipe": { cat: "deco", name: "Труба", color: "#7ee03a", r: 62 },
    "d-grass": { cat: "deco", name: "Трава", color: "#7ee03a", r: 34 },
    "d-heart": { cat: "deco", name: "Сердце", color: "#ff3b5c", r: 30 },
    "d-moon": { cat: "deco", name: "Месяц", color: "#ffe14a", r: 32 },
    cloud: { cat: "deco", name: "Облако", color: "#ffffff", r: 44, old: true },
    ring: { cat: "deco", name: "Кольцо", color: "#7ee03a", r: 40, old: true },

    "t-color": { cat: "triggers", name: "Цвет", color: "#ff4f9a", r: 28, hint: "мир уходит в этот цвет до следующего триггера цвета" },
    "t-flash": { cat: "triggers", name: "Вспышка", color: "#ffffff", r: 28, hint: "экран вспыхивает этим цветом" },
    "t-shake": { cat: "triggers", name: "Тряска", color: "#ffb31f", r: 28, v: "0.6", hint: "камера вздрагивает" },
    "t-zoom": { cat: "triggers", name: "Зум", color: "#22c7f0", r: 28, v: "1.25", hint: "камера приближается или отдаляется до следующего зума" },
    "t-tilt": { cat: "triggers", name: "Наклон", color: "#7ee03a", r: 28, v: "8", hint: "камера наклоняется до следующего наклона" },
  };

  /** Значения триггеров без цвета: [значение, подпись]. */
  const OPTIONS = {
    "t-shake": [["0.3", "Слабо"], ["0.6", "Средне"], ["1", "Сильно"]],
    "t-zoom": [["0.7", "×0.7"], ["0.85", "×0.85"], ["1", "×1"], ["1.25", "×1.25"], ["1.5", "×1.5"]],
    "t-tilt": [["-15", "−15°"], ["-8", "−8°"], ["0", "0°"], ["8", "8°"], ["15", "15°"]],
  };

  /** Виды, у которых значение — текст, а не цвет. */
  const TEXTS = new Set(["text", "fx-bang"]);

  const isTrigger = (k) => k.startsWith("t-");
  /** У каких видов значение — цвет. У текста значение — сам текст, у остальных триггеров — число. */
  const colored = (k) => !OPTIONS[k] && !TEXTS.has(k);
  const radius = (o) => KINDS[o.k].r * (isTrigger(o.k) ? 1 : o.s || 1);
  const colorOf = (o) => (colored(o.k) && /^#[0-9a-f]{6}$/i.test(o.v || "") ? o.v : KINDS[o.k].color);

  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const shade = (hex, k) => {
    const [r, g, b] = hexRgb(hex);
    const f = (v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  };
  const alpha = (hex, a) => {
    const [r, g, b] = hexRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  };

  /** Палитра космоса для триггера цвета: те же ключи, что у тем в course.js. */
  function palette(hex) {
    const c = hexRgb(hex);
    const mul = (k) => c.map((v) => Math.round(v * k));
    const lift = (k) => c.map((v) => Math.round(v + (255 - v) * k));
    return { sky: mul(0.55), sky2: mul(0.28), neb: lift(0.2), neb2: c, wall: mul(0.35), wall2: lift(0.1), glow: lift(0.7) };
  }

  // ---------- Рисование (начало координат — центр объекта) ----------

  function outlined(c, fill, width = 4) {
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = width;
    c.strokeStyle = OUTLINE;
    c.lineJoin = "round";
    c.stroke();
  }

  /** Вертикальный градиент цвета: светлее сверху, темнее снизу. */
  function grad(c, color, h, top = 0.25, bottom = -0.45) {
    const g = c.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, shade(color, top));
    g.addColorStop(1, shade(color, bottom));
    return g;
  }

  function poly(c, pts) {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
  }

  function strokeLines(c, segs, style, width) {
    c.beginPath();
    for (const [x1, y1, x2, y2] of segs) {
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
    }
    c.strokeStyle = style;
    c.lineWidth = width;
    c.stroke();
  }

  /** Блок: заливка с бликом сверху и рамкой внутри. */
  function block(c, w, h, color) {
    c.beginPath();
    c.rect(-w / 2, -h / 2, w, h);
    outlined(c, grad(c, color, h));
    const p = Math.min(8, Math.min(w, h) / 4);
    c.strokeStyle = "rgba(255,255,255,.45)";
    c.lineWidth = 3;
    c.strokeRect(-w / 2 + p, -h / 2 + p, w - p * 2, h - p * 2);
  }

  /** Квадрат 60×60 с рисунком внутри: pattern рисует поверх заливки, обводка сверху всего. */
  function tile(c, fill, pattern) {
    c.save();
    c.beginPath();
    c.rect(-30, -30, 60, 60);
    c.fillStyle = fill;
    c.fill();
    c.clip();
    pattern();
    c.restore();
    c.beginPath();
    c.rect(-30, -30, 60, 60);
    c.lineWidth = 4;
    c.strokeStyle = OUTLINE;
    c.stroke();
  }

  /** Фаска: светлый верх и левый край, тёмный низ и правый. */
  function bevel(c, x, y, w, h, d, light = "rgba(255,255,255,.4)", dark = "rgba(0,0,0,.3)") {
    c.fillStyle = light;
    poly(c, [[x, y], [x + w, y], [x + w - d, y + d], [x + d, y + d], [x + d, y + h - d], [x, y + h]]);
    c.fill();
    c.fillStyle = dark;
    poly(c, [[x + w, y + h], [x, y + h], [x + d, y + h - d], [x + w - d, y + h - d], [x + w - d, y + d], [x + w, y]]);
    c.fill();
  }

  const BLOCKS = {
    block: (c, col) => block(c, 60, 60, col),
    "b-gem": (c, col) => tile(c, col, () => {
      // пирамида: четыре грани к центру
      for (const [pts, k] of [
        [[[-30, -30], [30, -30], [0, 0]], 0.35], [[[-30, -30], [-30, 30], [0, 0]], 0.05],
        [[[30, -30], [30, 30], [0, 0]], -0.3], [[[-30, 30], [30, 30], [0, 0]], -0.5],
      ]) {
        poly(c, pts);
        c.fillStyle = shade(col, k);
        c.fill();
      }
      strokeLines(c, [[-30, -30, 30, 30], [30, -30, -30, 30]], "rgba(0,0,0,.25)", 2);
    }),
    "b-inset": (c, col) => tile(c, grad(c, col, 60), () => {
      bevel(c, -30, -30, 60, 60, 6);
      c.fillStyle = shade(col, -0.35);
      c.fillRect(-16, -16, 32, 32);
      bevel(c, -16, -16, 32, 32, 5, "rgba(0,0,0,.35)", "rgba(255,255,255,.3)");
    }),
    "b-grid": (c, col) => tile(c, grad(c, col, 60), () => {
      const s = [];
      for (const v of [-10, 10]) s.push([v, -30, v, 30], [-30, v, 30, v]);
      strokeLines(c, s, "rgba(0,0,0,.35)", 3);
      strokeLines(c, s.map(([a, b, d, e]) => [a + 2, b + 2, d + 2, e + 2]), "rgba(255,255,255,.22)", 1.5);
    }),
    "b-panel": (c, col) => tile(c, shade(col, -0.15), () => {
      for (const x of [-30, 0]) for (const y of [-30, 0]) {
        c.fillStyle = shade(col, x + y === -30 ? 0.1 : -0.05);
        c.fillRect(x, y, 30, 30);
        bevel(c, x, y, 30, 30, 5);
      }
    }),
    "b-brick": (c, col) => tile(c, col, () => {
      const s = [[-30, -15, 30, -15], [-30, 0, 30, 0], [-30, 15, 30, 15]];
      for (let row = 0; row < 4; row++) {
        const y = -30 + row * 15, off = row % 2 ? 0 : 15;
        for (let x = -30 + off; x < 30; x += 30) s.push([x, y, x, y + 15]);
      }
      c.fillStyle = "rgba(255,255,255,.18)";
      for (let row = 0; row < 4; row++) c.fillRect(-30, -30 + row * 15, 60, 4);
      strokeLines(c, s, shade(col, -0.55), 3);
    }),
    "b-stone": (c, col) => tile(c, grad(c, col, 60, 0.15, -0.35), () => {
      c.beginPath();
      c.moveTo(-30, -6); c.lineTo(-12, -10); c.lineTo(-4, 4); c.lineTo(14, 2); c.lineTo(30, 12);
      c.moveTo(-4, 4); c.lineTo(-10, 30);
      c.moveTo(-12, -10); c.lineTo(-6, -30);
      c.moveTo(14, 2); c.lineTo(20, -18); c.lineTo(30, -22);
      c.strokeStyle = shade(col, -0.6);
      c.lineWidth = 3;
      c.lineJoin = "round";
      c.stroke();
      c.fillStyle = "rgba(255,255,255,.2)";
      c.fillRect(-26, -26, 10, 6);
      c.fillRect(6, 10, 12, 5);
    }),
    "b-metal": (c, col) => tile(c, grad(c, col, 60, 0.4, -0.35), () => {
      bevel(c, -30, -30, 60, 60, 5);
      c.fillStyle = shade(col, -0.55);
      for (const x of [-19, 19]) for (const y of [-19, 19]) {
        c.beginPath();
        c.arc(x, y, 3.5, 0, TAU);
        c.fill();
      }
      strokeLines(c, [[-14, -14, 14, -14]], "rgba(255,255,255,.5)", 2);
    }),
    "b-crate": (c, col) => tile(c, col, () => {
      strokeLines(c, [[-30, -10, 30, -10], [-30, 10, 30, 10]], shade(col, -0.45), 2);
      c.lineWidth = 7;
      c.strokeStyle = shade(col, -0.3);
      c.strokeRect(-26, -26, 52, 52);
      strokeLines(c, [[-24, -24, 24, 24]], shade(col, -0.3), 7);
      strokeLines(c, [[-24, -24, 24, 24]], shade(col, 0.2), 2);
      c.strokeStyle = shade(col, -0.6);
      c.lineWidth = 2;
      c.strokeRect(-23, -23, 46, 46);
    }),
    "b-hazard": (c, col) => tile(c, col, () => {
      c.fillStyle = OUTLINE;
      for (let x = -90; x < 60; x += 24) poly(c, [[x, 30], [x + 12, 30], [x + 72, -30], [x + 60, -30]]), c.fill();
      bevel(c, -30, -30, 60, 60, 4, "rgba(255,255,255,.3)", "rgba(0,0,0,.3)");
    }),
    "b-tech": (c, col) => tile(c, shade(col, -0.7), () => {
      c.strokeStyle = col;
      c.lineWidth = 3;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(-30, -14); c.lineTo(-10, -14); c.lineTo(-2, -22); c.lineTo(30, -22);
      c.moveTo(-30, 8); c.lineTo(4, 8); c.lineTo(14, -2); c.lineTo(14, -10);
      c.moveTo(-14, 30); c.lineTo(-14, 20); c.lineTo(20, 20); c.lineTo(30, 10);
      c.stroke();
      c.fillStyle = shade(col, 0.5);
      for (const [x, y] of [[-10, -14], [14, -10], [-14, 20], [4, 8]]) {
        c.beginPath();
        c.arc(x, y, 3.5, 0, TAU);
        c.fill();
      }
    }),
    "b-dark": (c, col) => tile(c, "#120c2a", () => {
      c.shadowColor = col;
      c.shadowBlur = 10;
      c.strokeStyle = col;
      c.lineWidth = 3;
      c.strokeRect(-24, -24, 48, 48);
      c.shadowBlur = 0;
      c.fillStyle = alpha(col.startsWith("#") ? col : "#ffffff", 0.12);
      c.fillRect(-24, -24, 48, 48);
    }),
    "b-frame": (c, col) => {
      c.beginPath();
      c.rect(-30, -30, 60, 60);
      c.rect(-18, 18, 36, -36);
      outlined(c, grad(c, col, 60, 0.1, -0.4));
    },
    "b-checker": (c, col) => tile(c, shade(col, 0.15), () => {
      c.fillStyle = shade(col, -0.4);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) c.fillRect(-30 + i * 15, -30 + j * 15, 15, 15);
    }),
    "b-studs": (c, col) => tile(c, grad(c, col, 60), () => {
      for (const x of [-14, 14]) for (const y of [-14, 14]) {
        c.beginPath();
        c.arc(x, y + 2, 9, 0, TAU);
        c.fillStyle = shade(col, -0.45);
        c.fill();
        c.beginPath();
        c.arc(x, y, 9, 0, TAU);
        c.fillStyle = shade(col, 0.2);
        c.fill();
        c.strokeStyle = "rgba(0,0,0,.3)";
        c.lineWidth = 1.5;
        c.stroke();
      }
    }),
  };

  /** Стекло: прозрачная заливка, светлая кромка и косой блик. path рисует контур. */
  function glass(c, color, path, extra) {
    path();
    c.fillStyle = alpha(color, 0.28);
    c.fill();
    c.save();
    c.clip();
    c.fillStyle = "rgba(255,255,255,.35)";
    poly(c, [[-70, 40], [-50, 40], [10, -70], [-10, -70]]);
    c.fill();
    poly(c, [[-38, 40], [-32, 40], [28, -70], [22, -70]]);
    c.fill();
    if (extra) extra();
    c.restore();
    path();
    c.lineWidth = 4;
    c.strokeStyle = OUTLINE;
    c.lineJoin = "round";
    c.stroke();
    path();
    c.lineWidth = 2;
    c.strokeStyle = alpha(color, 0.9);
    c.stroke();
  }

  const rect = (c, w, h) => () => {
    c.beginPath();
    c.rect(-w / 2, -h / 2, w, h);
  };

  /** Огненный шар со звёздными лучами: взрыв и «Бах». */
  function burst(c, r, color, spikes, inner, t) {
    c.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i * Math.PI) / spikes + t * 0.3;
      const rr = i % 2 ? r * inner : r * (0.85 + ((i * 37) % 7) / 40);
      c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath();
  }

  /** Блоки, формы, склоны, стекло, эффекты и декор: k → рисунок. */
  const DRAW = {
    ...BLOCKS,
    half: (c, col) => block(c, 60, 30, col),
    small: (c, col) => block(c, 30, 30, col),
    slab: (c, col) => block(c, 120, 30, col),
    pillar: (c, col) => block(c, 34, 120, col),
    plank: (c, col) => {
      c.beginPath();
      c.rect(-60, -7, 120, 14);
      outlined(c, grad(c, col, 14), 3);
      strokeLines(c, [[-30, -7, -30, 7], [0, -7, 0, 7], [30, -7, 30, 7]], "rgba(0,0,0,.3)", 2);
    },
    step: (c, col) => {
      poly(c, [[-30, 30], [-30, 10], [-10, 10], [-10, -10], [10, -10], [10, -30], [30, -30], [30, 30]]);
      outlined(c, grad(c, col, 60));
      strokeLines(c, [[-26, 14, -14, 14], [-6, -6, 6, -6], [14, -26, 26, -26]], "rgba(255,255,255,.5)", 3);
    },
    cross: (c, col) => {
      poly(c, [[-10, -30], [10, -30], [10, -10], [30, -10], [30, 10], [10, 10], [10, 30], [-10, 30], [-10, 10], [-30, 10], [-30, -10], [-10, -10]]);
      outlined(c, grad(c, col, 60));
    },

    ramp: (c, col) => { poly(c, [[-30, 30], [30, -30], [30, 30]]); outlined(c, grad(c, col, 60)); },
    ramp2: (c, col) => { poly(c, [[-60, 30], [60, -30], [60, 30]]); outlined(c, grad(c, col, 60)); },
    "ramp-half": (c, col) => { poly(c, [[-30, 15], [30, -15], [30, 15]]); outlined(c, grad(c, col, 30)); },
    wedge: (c, col) => { poly(c, [[-30, 30], [0, -30], [30, 30]]); outlined(c, grad(c, col, 60)); },
    curve: (c, col) => {
      c.beginPath();
      // выпуклый склон: четверть круга от левого нижнего угла к правому верхнему
      c.moveTo(-30, 30);
      c.quadraticCurveTo(-30, -30, 30, -30);
      c.lineTo(30, 30);
      c.closePath();
      outlined(c, grad(c, col, 60));
    },

    "g-block": (c, col) => glass(c, col, rect(c, 60, 60)),
    "g-half": (c, col) => glass(c, col, rect(c, 60, 30)),
    "g-pane": (c, col) => glass(c, col, rect(c, 16, 120)),
    "g-ramp": (c, col) => glass(c, col, () => poly(c, [[-30, 30], [30, -30], [30, 30]])),
    "g-tile": (c, col) => glass(c, col, rect(c, 60, 60), () => {
      strokeLines(c, [[0, -30, 0, 30], [-30, 0, 30, 0]], OUTLINE, 5);
      strokeLines(c, [[0, -30, 0, 30], [-30, 0, 30, 0]], shade(col, -0.2), 2);
    }),
    "g-crack": (c, col) => glass(c, col, rect(c, 60, 60), () => {
      c.beginPath();
      for (const [x, y] of [[-30, -20], [30, -8], [-12, 30], [22, 30], [-30, 14], [8, -30]]) {
        c.moveTo(2, -2);
        c.lineTo((x + 2) / 2 + 3, (y - 2) / 2 - 2);
        c.lineTo(x, y);
      }
      c.strokeStyle = "rgba(255,255,255,.85)";
      c.lineWidth = 1.5;
      c.stroke();
    }),
    "g-shards": (c, col, t) => {
      const shards = [[-20, -14, 0.3], [12, -20, -0.5], [22, 8, 0.9], [-6, 16, -0.2], [-26, 14, 1.4]];
      shards.forEach(([x, y, a], i) => {
        const f = reduce ? 0 : Math.sin(t * 1.6 + i) * 3;
        c.save();
        c.translate(x, y + f);
        c.rotate(a + (reduce ? 0 : Math.sin(t + i) * 0.15));
        glass(c, col, () => poly(c, [[-9, 8], [0, -11], [10, 6]]));
        c.restore();
      });
    },

    "fx-boom": (c, col, t) => {
      const k = reduce ? 1 : 1 + Math.sin(t * 9) * 0.06;
      c.scale(k, k);
      burst(c, 40, col, 9, 0.55, reduce ? 0 : t);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 40);
      g.addColorStop(0, "#fffbe0");
      g.addColorStop(0.35, "#ffe14a");
      g.addColorStop(1, col);
      outlined(c, g, 3);
      burst(c, 20, col, 7, 0.5, reduce ? 0 : -t * 1.5);
      c.fillStyle = "rgba(255,255,255,.85)";
      c.fill();
    },
    "fx-bang": (c, col, t, o) => {
      const k = reduce ? 1 : 1 + Math.sin(t * 6) * 0.04;
      c.scale(k, k);
      burst(c, 46, col, 12, 0.72, 0);
      outlined(c, col, 4);
      burst(c, 36, col, 12, 0.75, 0.1);
      c.fillStyle = "#fff6c9";
      c.fill();
      c.font = "900 18px Unbounded, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = 5;
      c.strokeStyle = OUTLINE;
      const text = ((o && o.v) || KINDS["fx-bang"].v).slice(0, 8);
      c.strokeText(text, 0, 1);
      c.fillStyle = "#ff3b5c";
      c.fillText(text, 0, 1);
    },
    "fx-spark": (c, col, t) => {
      const twinkle = (x, y, r, ph) => {
        const k = reduce ? 1 : 0.6 + Math.abs(Math.sin(t * 3 + ph)) * 0.4;
        c.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4, rr = (i % 2 ? r * 0.22 : r) * k;
          c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        c.closePath();
        outlined(c, col, 3);
      };
      twinkle(-4, 0, 30, 0);
      twinkle(20, -20, 12, 1.7);
      twinkle(18, 20, 9, 3.1);
    },
    "fx-fire": (c, col, t) => {
      for (const [k, fill] of [[1, col], [0.62, "#ffe14a"], [0.3, "#fffbe0"]]) {
        const w = reduce ? 0 : Math.sin(t * 11 + k * 5) * 4 * k;
        c.beginPath();
        c.moveTo(0, 32);
        c.bezierCurveTo(-30 * k, 30, -26 * k, 0, -10 * k + w, -14 * k);
        c.bezierCurveTo(-4 * k, -22 * k, 0, -26 * k, w * 1.5, -36 * k);
        c.bezierCurveTo(10 * k, -20 * k, 28 * k, -4 * k, 24 * k, 12);
        c.bezierCurveTo(22 * k, 26, 10 * k, 32, 0, 32);
        if (k === 1) outlined(c, fill, 3);
        else {
          c.fillStyle = fill;
          c.fill();
        }
      }
    },
    "fx-smoke": (c, col, t) => {
      for (let i = 0; i < 4; i++) {
        const p = reduce ? i / 4 : ((t * 0.35 + i / 4) % 1);
        const r = 10 + p * 16;
        c.globalAlpha = 0.85 * (1 - p * 0.8);
        c.beginPath();
        c.arc(Math.sin(i * 2.1 + p * 3) * 8, 26 - p * 58, r, 0, TAU);
        outlined(c, shade(col, 0.15 - i * 0.08), 3);
      }
      c.globalAlpha = 1;
    },
    "fx-bolt": (c, col, t) => {
      c.globalAlpha = reduce ? 1 : 0.55 + Math.abs(Math.sin(t * 13)) * 0.45;
      poly(c, [[6, -42], [-16, 2], [-2, 2], [-10, 42], [16, -6], [2, -6], [12, -42]]);
      c.shadowColor = col;
      c.shadowBlur = 12;
      outlined(c, col, 3);
      c.shadowBlur = 0;
      c.globalAlpha = 1;
    },
    "fx-debris": (c, col, t) => {
      const rocks = [[0, -30, 9], [26, -10, 7], [20, 22, 10], [-18, 24, 6], [-28, -6, 8]];
      rocks.forEach(([x, y, r], i) => {
        c.save();
        const a = reduce ? 0 : t * 0.4;
        c.rotate(a);
        c.translate(x, y);
        c.rotate(i + (reduce ? 0 : t * (i % 2 ? 1.2 : -0.9)));
        poly(c, [[-r, -r * 0.4], [-r * 0.2, -r], [r, -r * 0.5], [r * 0.7, r * 0.8], [-r * 0.6, r]]);
        outlined(c, shade(col, (i % 3) * 0.1 - 0.1), 3);
        c.restore();
      });
    },
    "fx-confetti": (c, col, t) => {
      const cols = [col, "#ffb31f", "#22c7f0", "#7ee03a", "#ffffff"];
      for (let i = 0; i < 14; i++) {
        const x = ((i * 53) % 70) - 35;
        const y = reduce ? ((i * 29) % 70) - 35 : (((i * 29 + t * 40) % 80) + 80) % 80 - 40;
        c.save();
        c.translate(x, y);
        c.rotate(i + (reduce ? 0 : t * (2 + (i % 3))));
        c.fillStyle = cols[i % cols.length];
        c.fillRect(-4, -2.5, 8, 5);
        c.strokeStyle = OUTLINE;
        c.lineWidth = 1;
        c.strokeRect(-4, -2.5, 8, 5);
        c.restore();
      }
    },
    "fx-beam": (c, col, t) => {
      const k = reduce ? 1 : 0.8 + Math.sin(t * 2.5) * 0.2;
      const g = c.createLinearGradient(0, -60, 0, 60);
      g.addColorStop(0, alpha(col, 0.85 * k));
      g.addColorStop(1, alpha(col, 0));
      poly(c, [[-8, -60], [8, -60], [30, 60], [-30, 60]]);
      c.fillStyle = g;
      c.fill();
      c.fillStyle = "rgba(255,255,255,.7)";
      c.fillRect(-3, -60, 6, 70 * k);
      c.beginPath();
      c.rect(-12, -64, 24, 8);
      outlined(c, shade(col, -0.3), 3);
    },

    star: (c, col, t) => {
      c.rotate(reduce ? 0 : t * 0.6);
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? 13.5 : 30;
        c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.closePath();
      outlined(c, col);
    },
    crystal: (c, col) => {
      poly(c, [[0, -32], [18, -6], [0, 32], [-18, -6]]);
      outlined(c, col);
      c.beginPath();
      c.moveTo(0, -32);
      c.lineTo(-6, -6);
      c.lineTo(0, 32);
      c.fillStyle = "rgba(255,255,255,.45)";
      c.fill();
    },
    lamp: (c, col, t) => {
      const k = reduce ? 1 : 0.85 + Math.sin(t * 7) * 0.08 + Math.sin(t * 2.3) * 0.07;
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 70 * k);
      g.addColorStop(0, alpha(col, 0.55));
      g.addColorStop(1, alpha(col, 0));
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, 70 * k, 0, TAU);
      c.fill();
      c.beginPath();
      c.arc(0, 0, 12, 0, TAU);
      outlined(c, shade(col, 0.5), 3);
    },
    "d-gear": (c, col, t) => {
      c.rotate(reduce ? 0 : t * 0.8);
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i * TAU) / 10, d = TAU / 40;
        c.lineTo(Math.cos(a - d * 1.6) * 24, Math.sin(a - d * 1.6) * 24);
        c.lineTo(Math.cos(a - d) * 32, Math.sin(a - d) * 32);
        c.lineTo(Math.cos(a + d) * 32, Math.sin(a + d) * 32);
        c.lineTo(Math.cos(a + d * 1.6) * 24, Math.sin(a + d * 1.6) * 24);
      }
      c.closePath();
      c.moveTo(9, 0);
      c.arc(0, 0, 9, 0, TAU, true);
      outlined(c, grad(c, col, 60, 0.3, -0.35), 3);
    },
    "d-arrow": (c, col) => {
      poly(c, [[-30, -10], [4, -10], [4, -24], [30, 0], [4, 24], [4, 10], [-30, 10]]);
      outlined(c, grad(c, col, 48));
    },
    "d-sign": (c, col) => {
      c.beginPath();
      c.rect(-3, 4, 6, 36);
      outlined(c, "#8a8399", 3);
      poly(c, [[0, -38], [30, 14], [-30, 14]]);
      outlined(c, col);
      c.font = "900 30px Unbounded, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = OUTLINE;
      c.fillText("!", 0, -2);
    },
    "d-flag": (c, col, t) => {
      c.beginPath();
      c.rect(-24, -44, 6, 88);
      outlined(c, "#d8d2e6", 3);
      const w = reduce ? 0 : Math.sin(t * 5) * 5;
      c.beginPath();
      c.moveTo(-18, -42);
      c.quadraticCurveTo(4, -48 + w, 26, -36);
      c.lineTo(26, -8);
      c.quadraticCurveTo(4, -20 - w, -18, -14);
      c.closePath();
      outlined(c, col, 3);
    },
    "d-chain": (c, col, t) => {
      c.rotate(reduce ? 0 : Math.sin(t * 1.8) * 0.12);
      for (let i = 0; i < 5; i++) {
        const y = -38 + i * 19;
        c.beginPath();
        if (i % 2) c.ellipse(0, y, 3.5, 12, 0, 0, TAU);
        else c.ellipse(0, y, 8, 12, 0, 0, TAU);
        c.lineWidth = 7;
        c.strokeStyle = OUTLINE;
        c.stroke();
        c.lineWidth = 3.5;
        c.strokeStyle = col;
        c.stroke();
      }
    },
    "d-pipe": (c, col) => {
      c.beginPath();
      c.rect(-12, -60, 24, 120);
      const g = c.createLinearGradient(-12, 0, 12, 0);
      g.addColorStop(0, shade(col, -0.3));
      g.addColorStop(0.35, shade(col, 0.4));
      g.addColorStop(1, shade(col, -0.5));
      outlined(c, g, 3);
      for (const y of [-56, 44]) {
        c.beginPath();
        c.rect(-17, y, 34, 12);
        outlined(c, g, 3);
      }
    },
    "d-grass": (c, col, t) => {
      const sway = reduce ? 0 : Math.sin(t * 2.2) * 4;
      c.beginPath();
      [[-24, 22], [-14, 34], [-4, 26], [6, 38], [16, 28], [26, 20]].forEach(([x, h], i) => {
        c.moveTo(x - 6, 30);
        c.quadraticCurveTo(x + sway * 0.5, 30 - h * 0.6, x + sway + (i % 2 ? 3 : -3), 30 - h);
        c.quadraticCurveTo(x + 2, 30 - h * 0.5, x + 6, 30);
      });
      outlined(c, grad(c, col, 60, 0.3, -0.3), 3);
    },
    "d-heart": (c, col, t) => {
      const k = reduce ? 1 : 1 + Math.max(0, Math.sin(t * 4)) * 0.08;
      c.scale(k, k);
      c.beginPath();
      c.moveTo(0, 26);
      c.bezierCurveTo(-34, 2, -24, -30, 0, -12);
      c.bezierCurveTo(24, -30, 34, 2, 0, 26);
      outlined(c, col);
      c.beginPath();
      c.ellipse(-11, -10, 5, 3, -0.6, 0, TAU);
      c.fillStyle = "rgba(255,255,255,.6)";
      c.fill();
    },
    "d-moon": (c, col) => {
      c.beginPath();
      c.arc(0, 0, 30, 0.45 * Math.PI, 1.55 * Math.PI);
      c.arc(14, 0, 24, 1.62 * Math.PI, 0.38 * Math.PI, true);
      c.closePath();
      outlined(c, col);
    },
    text: (c, col, t, o) => {
      c.font = "900 36px Unbounded, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineJoin = "round";
      c.lineWidth = 8;
      c.strokeStyle = OUTLINE;
      const text = ((o && o.v) || KINDS.text.v).slice(0, 40);
      c.strokeText(text, 0, 0);
      c.fillStyle = "#fff";
      c.fillText(text, 0, 0);
    },
    cloud: (c, col) => {
      // сначала общий контур, потом заливка поверх: стыки кругов не видны
      c.beginPath();
      for (const [x, y, r] of [[-22, 6, 18], [0, -8, 24], [24, 6, 17]]) {
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, TAU);
      }
      c.lineWidth = 7;
      c.strokeStyle = OUTLINE;
      c.stroke();
      c.fillStyle = col;
      c.fill();
    },
    ring: (c, col, t) => {
      const k = reduce ? 1 : 1 + Math.sin(t * 3) * 0.06;
      c.lineWidth = 14 * k;
      c.strokeStyle = OUTLINE;
      c.beginPath();
      c.arc(0, 0, 32 * k, 0, TAU);
      c.stroke();
      c.lineWidth = 8 * k;
      c.strokeStyle = col;
      c.stroke();
    },
  };

  /** Можно ли повернуть: у текста, триггеров и круглых вещей поворот не нужен. */
  const rotatable = (k) => !isTrigger(k) && !TEXTS.has(k) && !["lamp", "cloud", "ring", "fx-smoke", "fx-confetti", "fx-spark"].includes(k);

  /** Блок или декорация. */
  function draw(c, o, t) {
    const fn = DRAW[o.k];
    if (!fn) return;
    c.save();
    c.scale(o.s || 1, o.s || 1);
    if (o.r && rotatable(o.k)) c.rotate((o.r * Math.PI) / 180);
    fn(c, colorOf(o), t, o);
    c.restore();
  }

  /** Значок триггера в редакторе: кружок с картинкой и подпись значения. В матче триггеры не видны. */
  function drawTrigger(c, o, selected, label = true) {
    const color = colorOf(o);
    c.save();
    c.beginPath();
    c.arc(0, 0, 26, 0, TAU);
    outlined(c, "#2c2266", selected ? 5 : 4);
    c.strokeStyle = color;
    c.lineWidth = 4;
    c.beginPath();
    c.arc(0, 0, 20, 0, TAU);
    c.stroke();
    c.fillStyle = color;
    c.strokeStyle = color;
    c.lineWidth = 3;
    c.lineCap = "round";
    switch (o.k) {
      case "t-color":
        c.beginPath();
        c.arc(0, 0, 11, 0, TAU);
        c.fill();
        break;
      case "t-flash":
        c.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          c.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
          c.lineTo(Math.cos(a) * 12, Math.sin(a) * 12);
        }
        c.stroke();
        break;
      case "t-shake":
        c.beginPath();
        c.moveTo(-12, 0);
        for (let i = 0; i < 6; i++) c.lineTo(-8 + i * 4, i % 2 ? 7 : -7);
        c.lineTo(12, 0);
        c.stroke();
        break;
      case "t-zoom":
        c.beginPath();
        c.arc(-3, -3, 8, 0, TAU);
        c.moveTo(3, 3);
        c.lineTo(11, 11);
        c.stroke();
        break;
      case "t-tilt":
        c.rotate(-0.4);
        c.beginPath();
        c.moveTo(-12, 0);
        c.lineTo(12, 0);
        c.moveTo(-12, 0);
        c.arc(-12, 0, 18, -0.6, 0);
        c.stroke();
        break;
    }
    c.restore();
    if (!label) return;
    const text = OPTIONS[o.k] ? (OPTIONS[o.k].find((p) => p[0] === o.v) || ["", o.v])[1] : KINDS[o.k].name;
    c.font = "900 13px Nunito, sans-serif";
    c.textAlign = "center";
    c.lineJoin = "round";
    c.lineWidth = 4;
    c.strokeStyle = OUTLINE;
    c.strokeText(text, 0, 44);
    c.fillStyle = "#fff";
    c.fillText(text, 0, 44);
  }

  /** Значок вида k для палитры: canvas size×size, объект вписан целиком. */
  function icon(k, size = 44) {
    const cv = document.createElement("canvas");
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = cv.height = Math.round(size * dpr);
    cv.style.width = cv.style.height = size + "px";
    const c = cv.getContext("2d");
    c.scale(dpr, dpr);
    c.translate(size / 2, size / 2);
    const o = create(k, 0, 0, 0);
    const reach = isTrigger(k) ? 30 : k === "text" ? 60 : k === "lamp" ? 22 : KINDS[k].r;
    const s = (size / 2 - 2) / reach;
    c.scale(s, s);
    if (isTrigger(k)) drawTrigger(c, o, false, false);
    else if (k === "text") {
      c.font = "900 44px Unbounded, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = 8;
      c.strokeStyle = OUTLINE;
      c.strokeText("Аа", 0, 2);
      c.fillStyle = "#fff";
      c.fillText("Аа", 0, 2);
    } else draw(c, o, 0);
    return cv;
  }

  // ---------- Препятствия на ячейке ----------

  const SPIKE = "#ff3b5c";

  /** Шипы вместо стрелки: три красных зуба. Рисует и матч, и редактор. */
  function spikes(c, r) {
    c.beginPath();
    for (let k = -1; k <= 1; k++) {
      const x = k * r * 0.42, h = k === 0 ? r * 0.75 : r * 0.55;
      c.moveTo(x - r * 0.22, r * 0.38);
      c.lineTo(x, r * 0.38 - h);
      c.lineTo(x + r * 0.22, r * 0.38);
    }
    c.closePath();
    c.fillStyle = SPIKE;
    c.fill();
    c.lineJoin = "round";
    c.lineWidth = 3;
    c.strokeStyle = OUTLINE;
    c.stroke();
  }

  /** Стена в превью редактора: каменный столб поперёк пути (в матче её рисует course.js). */
  function wall(c, r) {
    c.beginPath();
    c.roundRect(-r * 0.6, -r * 2.2, r * 1.2, r * 4.4, 8);
    outlined(c, "#8a8399");
    c.strokeStyle = "rgba(29,19,64,.55)";
    c.lineWidth = 3;
    c.beginPath();
    for (const y of [-1.3, -0.3, 0.7, 1.6]) {
      c.moveTo(-r * 0.6, y * r);
      c.lineTo(r * 0.6, y * r);
    }
    c.moveTo(0, -1.3 * r); c.lineTo(0, -0.3 * r);
    c.moveTo(-r * 0.25, -0.3 * r); c.lineTo(-r * 0.25, 0.7 * r);
    c.moveTo(r * 0.2, 0.7 * r); c.lineTo(r * 0.2, 1.6 * r);
    c.stroke();
  }

  /** Новый объект вида k: цвет, значение и размер по умолчанию. */
  function create(k, c, x, y) {
    const kind = KINDS[k];
    return { k, c, x: Math.round(x), y: Math.round(y), s: 1, v: kind.v ?? (colored(k) ? kind.color : null), r: 0 };
  }

  return {
    KINDS, CATS, COLORS, OPTIONS, SPIKE, isTrigger, colored, rotatable, radius, hexRgb, palette,
    draw, drawTrigger, icon, create, spikes, wall,
  };
})();
