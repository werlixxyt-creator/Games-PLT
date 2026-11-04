"use strict";

// Плавность триггеров: готовые кривые и своя кривая Безье с двумя ручками, как в CSS cubic-bezier.
// easecurve.fn(e, b) → функция 0..1 → 0..1 (может выходить за края у «Упругости» и «Отдачи»).
//   e — номер кривой из LIST, b — своя кривая "x1,y1,x2,y2" (только для e = CUSTOM).
// easecurve.create({ e, b, onInput(e, b) }) → { el } — график с ручками и кнопки готовых кривых для редактора.
const easecurve = (() => {
  const CUSTOM = 9;
  const LIST = [
    ["Ровно", (t) => t],
    ["Плавно", (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)],
    ["Замедление", (t) => 1 - (1 - t) ** 3],
    ["Отскок", (t) => {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    }],
    ["Разгон", (t) => t * t * t],
    ["Упругость", (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1)],
    ["Отдача", (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2],
    ["Синус", (t) => -(Math.cos(Math.PI * t) - 1) / 2],
    ["Экспонента", (t) => (t === 0 || t === 1 ? t : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2)],
    ["Своя кривая", null],
  ];
  const DEFAULT_B = [0.25, 0.1, 0.25, 1];
  const B_RE = /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/;

  /** Своя кривая из строки; неверная — стандартная. Числа ограничены: x в 0..1, y в -1..2. */
  function parseB(b) {
    if (typeof b !== "string" || !B_RE.test(b)) return DEFAULT_B.slice();
    const [x1, y1, x2, y2] = b.split(",").map(Number);
    const cx = (v) => Math.max(0, Math.min(1, v)), cy = (v) => Math.max(-1, Math.min(2, v));
    return [cx(x1), cy(y1), cx(x2), cy(y2)];
  }
  const formatB = (p) => p.map((v) => Math.round(v * 100) / 100).join(",");

  /** Кривая Безье от (0,0) до (1,1): по x находим параметр делением пополам и возвращаем y. */
  function bezier([x1, y1, x2, y2]) {
    const at = (a, b, s) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
    return (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let lo = 0, hi = 1, s = t;
      for (let i = 0; i < 24; i++) {
        s = (lo + hi) / 2;
        if (at(x1, x2, s) < t) lo = s;
        else hi = s;
      }
      return at(y1, y2, s);
    };
  }

  function fn(e, b) {
    const i = Math.max(0, Math.min(CUSTOM, e | 0));
    return i === CUSTOM ? bezier(parseB(b)) : LIST[i][1];
  }

  /** Виджет: график кривой с сеткой, ручки для своей кривой, кнопки готовых. */
  function create({ e = 1, b = null, onInput }) {
    let cur = Math.max(0, Math.min(CUSTOM, e | 0));
    let pts = parseB(b);
    const W = 220, H = 160, PAD_X = 16, PAD_TOP = 34, PAD_BOT = 26;
    const root = document.createElement("div");
    root.className = "ec";
    const cv = document.createElement("canvas");
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = W + "px";
    cv.style.height = H + "px";
    cv.className = "ec-graph";
    cv.title = "Тяни ручки, чтобы сделать свою кривую";
    const ctx = cv.getContext("2d");
    const chips = document.createElement("div");
    chips.className = "ec-chips";

    // координаты графика: x 0..1 слева направо, y 0..1 снизу вверх, с запасом сверху и снизу для «Упругости»
    const gx = (x) => PAD_X + x * (W - PAD_X * 2);
    const gy = (y) => H - PAD_BOT - y * (H - PAD_TOP - PAD_BOT);
    const fromG = (px, py) => [(px - PAD_X) / (W - PAD_X * 2), (H - PAD_BOT - py) / (H - PAD_TOP - PAD_BOT)];

    function paint() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,.05)";
      ctx.fillRect(gx(0), gy(1), gx(1) - gx(0), gy(0) - gy(1));
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k <= 4; k++) {
        ctx.moveTo(gx(k / 4), gy(0));
        ctx.lineTo(gx(k / 4), gy(1));
        ctx.moveTo(gx(0), gy(k / 4));
        ctx.lineTo(gx(1), gy(k / 4));
      }
      ctx.stroke();
      const f = fn(cur, formatB(pts));
      if (cur === CUSTOM) {
        // ручки: линии от углов к точкам
        ctx.strokeStyle = "rgba(255,225,74,.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(gx(0), gy(0));
        ctx.lineTo(gx(pts[0]), gy(pts[1]));
        ctx.moveTo(gx(1), gy(1));
        ctx.lineTo(gx(pts[2]), gy(pts[3]));
        ctx.stroke();
      }
      ctx.strokeStyle = "#22c7f0";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const t = i / 80;
        ctx[i ? "lineTo" : "moveTo"](gx(t), gy(f(t)));
      }
      ctx.stroke();
      const handles = cur === CUSTOM ? [[pts[0], pts[1]], [pts[2], pts[3]]] : [];
      for (const [x, y] of handles) {
        ctx.beginPath();
        ctx.arc(gx(x), gy(y), 7, 0, Math.PI * 2);
        ctx.fillStyle = "#ffe14a";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#1d1340";
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.font = "800 10px Nunito, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("начало", gx(0), H - 8);
      ctx.textAlign = "right";
      ctx.fillText("конец", gx(1), H - 8);
      ctx.fillText(LIST[cur][0], W - 4, 14);
      for (const b of chips.children) b.classList.toggle("on", +b.dataset.e === cur);
    }

    const emit = () => onInput(cur, cur === CUSTOM ? formatB(pts) : null);

    LIST.forEach(([name], i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ed-chip";
      btn.textContent = name;
      btn.dataset.e = i;
      btn.addEventListener("click", () => {
        cur = i;
        paint();
        emit();
      });
      chips.append(btn);
    });

    // перетаскивание ручки; тянешь график готовой кривой — он становится своей кривой
    let drag = -1;
    cv.addEventListener("pointerdown", (ev) => {
      if (root.classList.contains("off")) return;
      const r = cv.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      if (cur !== CUSTOM) {
        cur = CUSTOM;
        pts = DEFAULT_B.slice();
      }
      const d = [0, 1].map((k) => Math.hypot(gx(pts[k * 2]) - px, gy(pts[k * 2 + 1]) - py));
      drag = d[0] <= d[1] ? 0 : 1;
      try { cv.setPointerCapture(ev.pointerId); } catch { /* синтетическое событие */ }
      move(ev);
    });
    const move = (ev) => {
      if (drag < 0) return;
      const r = cv.getBoundingClientRect();
      const [x, y] = fromG(ev.clientX - r.left, ev.clientY - r.top);
      pts[drag * 2] = Math.max(0, Math.min(1, x));
      pts[drag * 2 + 1] = Math.max(-1, Math.min(2, y));
      paint();
      emit();
    };
    cv.addEventListener("pointermove", move);
    const up = () => { drag = -1; };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);

    root.append(cv, chips);
    paint();
    return { el: root };
  }

  return { LIST, CUSTOM, fn, create, parseB };
})();
