"use strict";

// Объекты уровня из редактора: блоки, декор и триггеры, как в GD. Один код рисует их в редакторе (edview.js) и в матче (course.js).
// Объект привязан к ячейке: { k — вид, c — номер ячейки, x, y — сдвиг от её стрелки, s — размер, v — цвет, текст или сила }.
// На игру блоки и декор не влияют. Триггер срабатывает, когда игрок проходит свою ячейку: цвет, зум и наклон
// держатся до следующего такого же триггера, вспышка и тряска — разовые. Список видов есть и на сервере (LevelGenerator.EditorObjects).
const levelobj = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const OUTLINE = "#1d1340";
  const TAU = Math.PI * 2;

  /** Цвета, из которых выбирает автор. */
  const COLORS = ["#ffffff", "#ff4f9a", "#ffb31f", "#7ee03a", "#22c7f0", "#8b5cff", "#ff3b5c", "#1d1340"];

  // cat — вкладка редактора; color — цвет нового объекта; v — значение нового триггера
  const KINDS = {
    block: { cat: "blocks", name: "Блок", color: "#22c7f0", r: 34 },
    half: { cat: "blocks", name: "Полублок", color: "#22c7f0", r: 34 },
    ramp: { cat: "blocks", name: "Рампа", color: "#22c7f0", r: 34 },
    pillar: { cat: "blocks", name: "Колонна", color: "#8b5cff", r: 50 },
    text: { cat: "deco", name: "Текст", color: "#ffffff", r: 40, v: "Текст" },
    star: { cat: "deco", name: "Звезда", color: "#ffb31f", r: 32 },
    cloud: { cat: "deco", name: "Облако", color: "#ffffff", r: 44 },
    ring: { cat: "deco", name: "Кольцо", color: "#7ee03a", r: 40 },
    crystal: { cat: "deco", name: "Кристалл", color: "#ff4f9a", r: 32 },
    lamp: { cat: "deco", name: "Лампа", color: "#ffb31f", r: 30 },
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

  const isTrigger = (k) => k.startsWith("t-");
  /** У каких видов значение — цвет. У текста значение — сам текст, у остальных триггеров — число. */
  const colored = (k) => !OPTIONS[k] && k !== "text";
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

  /** Блок как в GD: заливка с бликом сверху и рамкой внутри. */
  function block(c, w, h, color) {
    const g = c.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, shade(color, 0.25));
    g.addColorStop(1, shade(color, -0.45));
    c.beginPath();
    c.rect(-w / 2, -h / 2, w, h);
    outlined(c, g);
    c.strokeStyle = "rgba(255,255,255,.45)";
    c.lineWidth = 3;
    c.strokeRect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16);
  }

  function star(c, r, color, t) {
    c.rotate(reduce ? 0 : t * 0.6);
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
      c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath();
    outlined(c, color);
  }

  /** Блок или декорация. */
  function draw(c, o, t) {
    const color = colorOf(o);
    c.save();
    c.scale(o.s || 1, o.s || 1);
    switch (o.k) {
      case "block": block(c, 60, 60, color); break;
      case "half": block(c, 60, 30, color); break;
      case "pillar": block(c, 34, 120, color); break;
      case "ramp": {
        const g = c.createLinearGradient(0, -30, 0, 30);
        g.addColorStop(0, shade(color, 0.25));
        g.addColorStop(1, shade(color, -0.45));
        c.beginPath();
        c.moveTo(-30, 30);
        c.lineTo(30, -30);
        c.lineTo(30, 30);
        c.closePath();
        outlined(c, g);
        break;
      }
      case "text": {
        c.font = "900 36px Unbounded, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.lineJoin = "round";
        c.lineWidth = 8;
        c.strokeStyle = OUTLINE;
        const text = (o.v || KINDS.text.v).slice(0, 40);
        c.strokeText(text, 0, 0);
        c.fillStyle = "#fff";
        c.fillText(text, 0, 0);
        break;
      }
      case "star": star(c, 30, color, t); break;
      case "cloud": {
        // сначала общий контур, потом заливка поверх: стыки кругов не видны
        c.beginPath();
        for (const [x, y, r] of [[-22, 6, 18], [0, -8, 24], [24, 6, 17]]) {
          c.moveTo(x + r, y);
          c.arc(x, y, r, 0, TAU);
        }
        c.lineWidth = 7;
        c.strokeStyle = OUTLINE;
        c.stroke();
        c.fillStyle = color;
        c.fill();
        break;
      }
      case "ring": {
        const k = reduce ? 1 : 1 + Math.sin(t * 3) * 0.06;
        c.lineWidth = 14 * k;
        c.strokeStyle = OUTLINE;
        c.beginPath();
        c.arc(0, 0, 32 * k, 0, TAU);
        c.stroke();
        c.lineWidth = 8 * k;
        c.strokeStyle = color;
        c.stroke();
        break;
      }
      case "crystal": {
        c.beginPath();
        c.moveTo(0, -32);
        c.lineTo(18, -6);
        c.lineTo(0, 32);
        c.lineTo(-18, -6);
        c.closePath();
        outlined(c, color);
        c.beginPath();
        c.moveTo(0, -32);
        c.lineTo(-6, -6);
        c.lineTo(0, 32);
        c.fillStyle = "rgba(255,255,255,.45)";
        c.fill();
        break;
      }
      case "lamp": {
        const k = reduce ? 1 : 0.85 + Math.sin(t * 7) * 0.08 + Math.sin(t * 2.3) * 0.07;
        const g = c.createRadialGradient(0, 0, 0, 0, 0, 70 * k);
        const [r, gg, b] = hexRgb(color);
        g.addColorStop(0, `rgba(${r},${gg},${b},.55)`);
        g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        c.fillStyle = g;
        c.fillRect(-70, -70, 140, 140);
        c.beginPath();
        c.arc(0, 0, 12, 0, TAU);
        outlined(c, shade(color, 0.5), 3);
        break;
      }
    }
    c.restore();
  }

  /** Значок триггера в редакторе: кружок с картинкой и подпись значения. В матче триггеры не видны. */
  function drawTrigger(c, o, selected) {
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
    const label = OPTIONS[o.k] ? (OPTIONS[o.k].find((p) => p[0] === o.v) || ["", o.v])[1] : KINDS[o.k].name;
    c.font = "900 13px Nunito, sans-serif";
    c.textAlign = "center";
    c.lineJoin = "round";
    c.lineWidth = 4;
    c.strokeStyle = OUTLINE;
    c.strokeText(label, 0, 44);
    c.fillStyle = "#fff";
    c.fillText(label, 0, 44);
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
    return { k, c, x: Math.round(x), y: Math.round(y), s: 1, v: kind.v ?? (colored(k) ? kind.color : null) };
  }

  return { KINDS, COLORS, OPTIONS, SPIKE, isTrigger, colored, radius, hexRgb, palette, draw, drawTrigger, create, spikes, wall };
})();
