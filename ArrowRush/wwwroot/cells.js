"use strict";

// Скины ячеек: форма, отделка и анимация заполнения. Один код рисует ячейки в матче (course.js) и на экране скинов.
// Цвет обводки и стрелки зависит только от направления, скин меняет всё остальное.
// fill(c, r, k, color, t) рисует заполнение k (0..1) внутри фигуры радиуса r, обрезка уже включена.
const cells = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const COLORS = [0, 1, 2, 3].map((i) => css.getPropertyValue("--a" + i).trim());
  const OUTLINE = css.getPropertyValue("--outline").trim() || "#1d1340";
  // стрелки: 0 ← 1 ↑ 2 → 3 ↓; символ смотрит вверх
  const ROT = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  const ARROW = new Path2D("M12 3 L21 13 H15.5 V21 H8.5 V13 H3 Z");
  const TAU = Math.PI * 2;
  const TOP = -Math.PI / 2;

  const BAD = "#ff3b5c";
  const HIDDEN_RIM = "#8c88b4";
  const HIDDEN_BODY = "#3a3560";

  // превью: заполнение, вспышка и пауза по кругу
  const FILL_SECONDS = 1.6;
  const POP_SECONDS = 0.4;
  const CYCLE = FILL_SECONDS + POP_SECONDS + 0.3;
  const PREVIEW_SIZE = 88;

  // ---------- Формы ----------

  function poly(c, r, sides, turn) {
    for (let i = 0; i < sides; i++) {
      const a = turn + (i * TAU) / sides;
      c[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
    }
  }

  const SHAPES = {
    circle: (c, r) => c.arc(0, 0, r, 0, TAU),
    rounded: (c, r) => c.roundRect(-r * 0.92, -r * 0.92, r * 1.84, r * 1.84, r * 0.42),
    square: (c, r) => c.rect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8),
    hex: (c, r) => poly(c, r * 1.06, 6, 0),
    octagon: (c, r) => poly(c, r * 1.02, 8, Math.PI / 8),
    diamond: (c, r) => poly(c, r * 1.2, 4, 0),
  };

  // ---------- Заполнения ----------

  /** Поверхность жидкости: волна на высоте level, ниже всё закрашено. */
  function wave(c, r, level, amp, length, phase) {
    const edge = r * 1.3;
    c.beginPath();
    c.moveTo(-edge, edge);
    for (let x = -edge; x <= edge; x += r / 8) c.lineTo(x, level + Math.sin(x / length + phase) * amp);
    c.lineTo(edge, edge);
    c.closePath();
  }

  const levelOf = (r, k) => r * 1.1 - r * 2.2 * k;

  /** Часы: сектор идёт от верха по кругу. */
  function pie(c, r, k, color) {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, r * 1.3, TOP, TOP + k * TAU);
    c.closePath();
    c.fill();
  }

  /** Неон: свет разгорается от центра. */
  function bloom(c, r, k, color) {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r * 1.35 * k + 1);
    g.addColorStop(0, "#fff");
    g.addColorStop(0.45, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 2.6);
  }

  /** Карамель: уровень поднимается, по нему бегут полоски. */
  function stripes(c, r, k, color, t) {
    const level = levelOf(r, k);
    c.beginPath();
    c.rect(-r * 1.3, level, r * 2.6, r * 2.6);
    c.clip();
    c.fillStyle = color;
    c.fillRect(-r * 1.3, level, r * 2.6, r * 2.6);
    const step = r * 0.6, shift = (t * 40) % step;
    c.fillStyle = "rgba(255,255,255,.5)";
    for (let x = -r * 3; x < r * 2; x += step) {
      c.beginPath();
      c.moveTo(x + shift, r * 1.3);
      c.lineTo(x + shift + step / 2, r * 1.3);
      c.lineTo(x + shift + step / 2 + r * 2.6, -r * 1.3);
      c.lineTo(x + shift + r * 2.6, -r * 1.3);
      c.closePath();
      c.fill();
    }
  }

  /** Пиксели: блоки зажигаются вразброс, порядок один и тот же. */
  const BLOCKS = 6;
  const BLOCK_ORDER = Array.from({ length: BLOCKS * BLOCKS }, (_, i) => (i * 23 + 7) % (BLOCKS * BLOCKS));
  function blocks(c, r, k, color) {
    const size = (r * 2) / BLOCKS;
    c.fillStyle = color;
    BLOCK_ORDER.forEach((turn, i) => {
      if (turn / BLOCK_ORDER.length >= k) return;
      const col = i % BLOCKS, row = Math.floor(i / BLOCKS);
      c.fillRect(-r + col * size + 1, -r + row * size + 1, size - 2, size - 2);
    });
  }

  /** Золото: слиток наливается снизу, по нему проходит блик. */
  function gold(c, r, k, color, t) {
    const g = c.createLinearGradient(-r, 0, r, 0);
    g.addColorStop(0, "#c98a0c");
    g.addColorStop(0.5, "#ffe27a");
    g.addColorStop(1, "#c98a0c");
    wave(c, r, levelOf(r, k), r * 0.03, r * 0.5, t * 4);
    c.fillStyle = g;
    c.fill();
    c.clip();
    const x = ((t * 1.1) % 1) * r * 4 - r * 2;
    c.fillStyle = "rgba(255,255,255,.65)";
    c.beginPath();
    c.moveTo(x, r * 1.3);
    c.lineTo(x + r * 0.35, r * 1.3);
    c.lineTo(x + r * 1.05, -r * 1.3);
    c.lineTo(x + r * 0.7, -r * 1.3);
    c.closePath();
    c.fill();
  }

  /** Радуга: сектор переливается и вращается. */
  function rainbow(c, r, k, color, t) {
    const g = c.createConicGradient(t * 2, 0, 0);
    ["#ff4f4f", "#ffd23f", "#5dff7a", "#3fb6ff", "#b07bff", "#ff4f4f"].forEach((hue, i) => g.addColorStop(i / 5, hue));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, r * 1.3, TOP, TOP + k * TAU);
    c.closePath();
    c.fill();
  }

  /** Океан: две волны и пузырьки. */
  function ocean(c, r, k, color, t) {
    const level = levelOf(r, k);
    wave(c, r, level - r * 0.08, r * 0.1, r * 0.42, -t * 3);
    c.fillStyle = "rgba(127,214,255,.55)";
    c.fill();
    const g = c.createLinearGradient(0, level, 0, r);
    g.addColorStop(0, "#3fb6ff");
    g.addColorStop(1, "#0d4fa8");
    wave(c, r, level, r * 0.1, r * 0.5, t * 4);
    c.fillStyle = g;
    c.fill();
    c.fillStyle = "rgba(255,255,255,.7)";
    for (let i = 0; i < 4; i++) {
      const y = r - ((t * 0.5 + i * 0.27) % 1) * r * 2;
      if (y > level) c.fillRect(-r * 0.6 + i * r * 0.4, y, r * 0.08, r * 0.08);
    }
  }

  /** Лава: густая волна с тёмной коркой и раскалённым верхом. */
  function lava(c, r, k, color, t) {
    const level = levelOf(r, k);
    const g = c.createLinearGradient(0, level, 0, r);
    g.addColorStop(0, "#ffd23f");
    g.addColorStop(0.35, "#ff6a2b");
    g.addColorStop(1, "#c8102e");
    wave(c, r, level, r * 0.09, r * 0.3, t * 1.6);
    c.fillStyle = g;
    c.fill();
    c.clip();
    c.fillStyle = "rgba(90,10,10,.55)";
    for (let i = 0; i < 5; i++) {
      const x = -r + ((t * 0.12 + i * 0.23) % 1) * r * 2;
      c.beginPath();
      c.ellipse(x, r * (0.8 - i * 0.28), r * 0.2, r * 0.08, 0, 0, TAU);
      c.fill();
    }
  }

  /** Мята: лепестки раскрываются из центра. */
  function petals(c, r, k, color, t) {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, "#d8fff0");
    g.addColorStop(1, "#1fbf8f");
    c.fillStyle = g;
    for (let i = 0; i < 6; i++) {
      c.save();
      c.rotate(t * 0.8 + (i * TAU) / 6);
      c.beginPath();
      c.ellipse(0, -r * 0.62 * k, r * 0.34 * k + 1, r * 0.66 * k + 1, 0, 0, TAU);
      c.fill();
      c.restore();
    }
  }

  // ---------- Скины ----------

  // shape — форма, body — цвет внутри, fill — заполнение, rim(t) — внешняя кайма,
  // dash — пунктир дороги, glow — ореол, sharp — острые углы
  const SKINS = {
    classic: { shape: "circle", body: "#0e0a26", fill: pie },
    neon: { shape: "circle", body: "#05030f", fill: bloom, glow: true },
    candy: { shape: "rounded", body: "#3a1238", fill: stripes, rim: () => "#ffc2e4" },
    pixel: { shape: "square", body: "#14142e", fill: blocks, dash: [12, 7], sharp: true },
    gold: { shape: "hex", body: "#2b1d05", fill: gold, rim: () => "#ffd84d" },
    rainbow: { shape: "circle", body: "#0e0a26", fill: rainbow, rim: (t) => `hsl(${(t * 120) % 360} 90% 65%)` },
    ocean: { shape: "circle", body: "#06243f", fill: ocean, rim: () => "#9fe3ff" },
    lava: { shape: "octagon", body: "#2a0a08", fill: lava, rim: () => "#ff8a3d" },
    mint: { shape: "diamond", body: "#07281f", fill: petals, rim: () => "#b8ffe6" },
  };

  const skinOf = (id) => SKINS[id] || SKINS.classic;

  function outline(c, s, r) {
    c.beginPath();
    SHAPES[s.shape](c, r);
    c.closePath();
  }

  /** Ячейка в начале координат. o: { skin, r, color, k — заполнение, t — время, hidden, wrong }. */
  function draw(c, { skin, r, color, k = 0, t = 0, hidden = false, wrong = false }) {
    const s = skinOf(skin);
    c.lineJoin = s.sharp ? "miter" : "round";

    if (s.glow && !hidden) {
      c.strokeStyle = color;
      for (const [width, alpha] of [[22, 0.1], [14, 0.2]]) {
        c.globalAlpha = alpha;
        c.lineWidth = width;
        outline(c, s, r);
        c.stroke();
      }
      c.globalAlpha = 1;
    }

    outline(c, s, r);
    c.fillStyle = hidden ? HIDDEN_BODY : s.body;
    c.fill();
    if (k > 0 && !hidden) {
      c.save();
      outline(c, s, r);
      c.clip();
      s.fill(c, r, k, color, t);
      c.restore();
    }

    outline(c, s, r);
    c.strokeStyle = hidden ? HIDDEN_RIM : color;
    c.lineWidth = 6;
    c.stroke();
    outline(c, s, r + 4);
    c.strokeStyle = wrong ? BAD : !hidden && s.rim ? s.rim(t) : "#fff";
    c.lineWidth = 3;
    c.stroke();
  }

  /** Заполненная ячейка лопается: k от 0 до 1. */
  function pop(c, skin, k, r, color, t) {
    const s = skinOf(skin), size = r * (1 + k * 0.7);
    c.save();
    c.globalAlpha = (1 - k) ** 1.5;
    outline(c, s, size);
    c.fillStyle = s.body;
    c.fill();
    outline(c, s, size);
    c.clip();
    s.fill(c, size, 1, color, t);
    c.restore();
  }

  /** Стрелка в ячейке; light — светлая кайма, чтобы она читалась на заполнении. */
  function arrow(c, r, dir, light) {
    const k = (r * 1.5) / 24;
    c.save();
    c.rotate(ROT[dir]);
    c.scale(k, k);
    c.translate(-12, -12);
    c.lineJoin = "round";
    if (light) {
      c.strokeStyle = "#fff";
      c.lineWidth = 5.5;
      c.stroke(ARROW);
    }
    c.strokeStyle = OUTLINE;
    c.lineWidth = 2.4;
    c.stroke(ARROW);
    c.fillStyle = COLORS[dir];
    c.fill(ARROW);
    c.restore();
  }

  // ---------- Превью ----------

  /** Ячейка на маленьком холсте: заполнение k, вспышка popK. */
  function paint(canvas, id, dir, k, popK, t) {
    const c = canvas.getContext("2d"), scale = canvas.width / PREVIEW_SIZE, r = 27;
    c.setTransform(scale, 0, 0, scale, PREVIEW_SIZE * scale / 2, PREVIEW_SIZE * scale / 2);
    c.clearRect(-PREVIEW_SIZE, -PREVIEW_SIZE, PREVIEW_SIZE * 2, PREVIEW_SIZE * 2);
    if (popK !== null) {
      pop(c, id, popK, r, COLORS[dir], t);
      return;
    }
    draw(c, { skin: id, r, color: COLORS[dir], k, t });
    arrow(c, r, dir, true);
  }

  const live = new Set(); // холсты с анимацией; убранные со страницы выпадают сами
  let running = false;

  function tick(now) {
    const t = now / 1000;
    for (const item of live) {
      if (!item.canvas.isConnected) { live.delete(item); continue; }
      const time = t + item.phase, at = time % CYCLE;
      const dir = Math.floor(time / CYCLE) % 4;
      const popping = at >= FILL_SECONDS && at < FILL_SECONDS + POP_SECONDS;
      if (at >= FILL_SECONDS + POP_SECONDS) paint(item.canvas, item.id, (dir + 1) % 4, 0, null, t);
      else if (popping) paint(item.canvas, item.id, dir, 1, (at - FILL_SECONDS) / POP_SECONDS, t);
      else paint(item.canvas, item.id, dir, at / FILL_SECONDS, null, t);
    }
    running = live.size > 0;
    if (running) requestAnimationFrame(tick);
  }

  /** Новый холст-превью; animated — ячейка сама заполняется по кругу. */
  function preview(id, animated) {
    const canvas = document.createElement("canvas");
    canvas.className = "cell-preview";
    canvas.width = canvas.height = PREVIEW_SIZE * 2;
    paint(canvas, id, 1, 0.6, null, 0);
    if (animated && !reduce) {
      live.add({ canvas, id, phase: live.size * 0.37 });
      if (!running) {
        running = true;
        requestAnimationFrame(tick);
      }
    }
    return canvas;
  }

  return { draw, pop, arrow, preview, dash: (id) => skinOf(id).dash || [] };
})();
