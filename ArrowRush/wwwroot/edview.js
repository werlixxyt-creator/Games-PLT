"use strict";

// Превью уровня в редакторе, как в GD: тот же космос, что в матче, пол и потолок из блоков, ячейки по порядку вдоль пути.
// Ключи рисует cells.js, как в матче. ↑ уводит путь вверх, ↓ вниз, длина участка — время заполнения.
// Что делать с ячейкой под курсором, решает levels.js: сюда приходят только клики, протяжка и прокрутка.
const edview = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const COLORS = [0, 1, 2, 3].map((i) => css.getPropertyValue("--a" + i).trim());
  const OUTLINE = css.getPropertyValue("--outline").trim() || "#1d1340";
  const SEL = COLORS[3];

  const VIEW_H = 960;        // столько единиц мира видно по высоте: на экране 6–8 ячеек
  const BASE = 60;           // длина участка: BASE + секунды заполнения × PER_SECOND
  const PER_SECOND = 160;
  const FAST_STEP = 150;     // быстрый темп: все участки одной длины
  const RISE = 0.32;         // ↑ и ↓ уводят путь на такую долю длины участка
  const Y_LIMIT = 150;       // дальше от середины путь отражается обратно
  const FLOOR = 330;         // от середины до пола и потолка
  const BLOCK = 50;          // шаг блоков пола
  const KEY_R = 30, KEY_R_FAST = 24;
  const GHOST_AT = 110;      // ячейка «+»: насколько правее последней
  const GHOST_HALF = 40;
  const PORTAL_AT = 250;     // финишный портал
  const MAP_H = 16, MAP_PAD = 12; // полоска всего уровня внизу, в пикселях экрана

  let canvas, ctx, o;        // o: { get, hit(i), append() }
  let w = 0, h = 0, scale = 1;
  let camX = -300, camTarget = null, pendingFocus = null;
  let geo = null;            // { xs, ys, end } последнего кадра
  let hover = null;          // номер ячейки под курсором, "add" — ячейка «+»
  let drag = null;
  let raf = 0, last = 0, time = 0;
  let heroImg = null, heroId = null;

  // звёзды: повторяются по горизонтали, p — скорость относительно мира
  const STAR_SPAN = 2600;
  const stars = Array.from({ length: 150 }, (_, i) => {
    const r = (k) => ((Math.sin(i * 127.1 + k * 311.7) * 43758.5453) % 1 + 1) % 1;
    return { x: r(1) * STAR_SPAN, y: (r(2) - 0.5) * VIEW_H, size: 0.8 + r(3) * 2.2, p: 0.15 + r(4) * 0.35, tw: r(5) * 6 };
  });

  const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const paletteOf = (theme) => course.themes[theme] || scenes.palettes[theme] || course.themes.violet;
  const viewW = () => w / scale;
  const toWorld = (x) => camX + x / scale;

  /** Где стоит каждая ячейка: участок i идёт от точки i к точке i + 1, ключ — в его конце. */
  function layout(cellList, fast) {
    const xs = [0], ys = [0];
    cellList.forEach((c, i) => {
      const len = fast ? FAST_STEP : BASE + c.f * PER_SECOND;
      let y = ys[i] + (c.a === 1 ? -1 : c.a === 3 ? 1 : 0) * len * RISE;
      if (y > Y_LIMIT) y = 2 * Y_LIMIT - y;
      if (y < -Y_LIMIT) y = -2 * Y_LIMIT - y;
      xs.push(xs[i] + len);
      ys.push(Math.max(-Y_LIMIT, Math.min(Y_LIMIT, y)));
    });
    return { xs, ys, end: xs[xs.length - 1] };
  }

  function clampCam() {
    if (!geo) return;
    const min = -viewW() * 0.3;
    const max = Math.max(min, geo.end + PORTAL_AT + 260 - viewW());
    camX = Math.max(min, Math.min(max, camX));
  }

  function resize() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return false;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cw !== w || ch !== h || canvas.width !== Math.round(cw * dpr)) {
      w = cw;
      h = ch;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = h / VIEW_H;
    return true;
  }

  // ---------- Рисование ----------

  function drawSky(p) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(p.sky));
    g.addColorStop(1, rgba(p.sky2));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // туманности плывут медленнее мира
    for (const [col, fx, fy, fr] of [[p.neb, 0.3, 0.3, 0.6], [p.neb2, 0.8, 0.7, 0.5]]) {
      const span = w * 1.6;
      const x = (((fx * w - camX * scale * 0.06) % span) + span) % span - w * 0.3;
      const r = h * fr;
      const n = ctx.createRadialGradient(x, fy * h, 0, x, fy * h, r);
      n.addColorStop(0, rgba(col, 0.32));
      n.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = n;
      ctx.fillRect(x - r, fy * h - r, r * 2, r * 2);
    }

    const span = Math.max(STAR_SPAN, viewW() + 50);
    for (const st of stars) {
      const x = ((((st.x - camX * st.p) % span) + span) % span) * scale;
      if (x > w) continue;
      ctx.globalAlpha = 0.45 + (reduce ? 0.3 : Math.sin(time * 1.7 + st.tw) * 0.3);
      ctx.fillStyle = rgba(p.glow);
      ctx.fillRect(x, h / 2 + st.y * scale, st.size, st.size);
    }
    ctx.globalAlpha = 1;
  }

  /** Пол и потолок из блоков, как в GD: сетка в цветах стен коридора. */
  function drawBlocks(p, left, right) {
    const from = Math.floor(left / BLOCK) * BLOCK;
    const depth = VIEW_H / 2 - FLOOR + BLOCK;
    for (const side of [-1, 1]) {
      const y0 = side > 0 ? FLOOR : -FLOOR - depth;
      const g = ctx.createLinearGradient(0, side * FLOOR, 0, side * (FLOOR + depth));
      g.addColorStop(0, rgba(p.wall2, 0.9));
      g.addColorStop(0.12, rgba(p.wall, 1));
      g.addColorStop(1, rgba(p.wall.map((v) => v * 0.55), 1));
      ctx.fillStyle = g;
      ctx.fillRect(left, y0, right - left, depth);

      ctx.strokeStyle = rgba(p.wall2, 0.6);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = from; x <= right; x += BLOCK) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + depth);
      }
      for (let y = 0; y <= depth; y += BLOCK) {
        ctx.moveTo(left, side * (FLOOR + y));
        ctx.lineTo(right, side * (FLOOR + y));
      }
      ctx.stroke();

      ctx.strokeStyle = rgba(p.glow, 0.95);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(left, side * FLOOR);
      ctx.lineTo(right, side * FLOOR);
      ctx.stroke();
    }
  }

  function seg(i) {
    ctx.beginPath();
    ctx.moveTo(geo.xs[i], geo.ys[i]);
    ctx.lineTo(geo.xs[i + 1], geo.ys[i + 1]);
  }

  function drawRoad(s, from, to) {
    const width = s.fast ? 13 : 30;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // участок особой ячейки — цветная полоса под дорогой
    for (let i = from; i < to; i++) {
      const zone = s.zones.get(i);
      if (!zone) continue;
      ctx.strokeStyle = s.specials[zone.kind].color;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = width + 52;
      seg(i);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const [color, lw] of [["rgba(255,255,255,.34)", width + 8], [OUTLINE, width + 2]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(geo.xs[from], geo.ys[from]);
      for (let i = from + 1; i <= to; i++) ctx.lineTo(geo.xs[i], geo.ys[i]);
      ctx.stroke();
    }

    ctx.setLineDash(cells.dash(s.skin));
    for (let i = from; i < to; i++) {
      ctx.globalAlpha = i === s.sel ? 0.95 : i === hover ? 0.7 : 0.42;
      ctx.strokeStyle = COLORS[s.cells[i].a];
      ctx.lineWidth = width - 6;
      seg(i);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function outlinedText(text, x, y, color, font) {
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    ctx.strokeStyle = OUTLINE;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawKey(s, i) {
    const c = s.cells[i];
    const current = i === s.sel;
    const r = (s.fast ? KEY_R_FAST : KEY_R) * (current ? 1.2 : 1);
    ctx.save();
    ctx.translate(geo.xs[i + 1], geo.ys[i + 1] + (reduce ? 0 : Math.sin(time * 2.4 + i * 1.3) * 3));

    if (current) {
      // выбранная ячейка: вращающееся пунктирное кольцо
      ctx.strokeStyle = SEL;
      ctx.lineWidth = 5;
      ctx.setLineDash([12, 9]);
      ctx.lineDashOffset = reduce ? 0 : -time * 30;
      ctx.beginPath();
      ctx.arc(0, 0, r + 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (i === hover) {
      ctx.strokeStyle = "rgba(255,255,255,.6)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r + 12, 0, Math.PI * 2);
      ctx.stroke();
    }

    cells.draw(ctx, { skin: s.skin, r, color: COLORS[c.a], t: time });
    cells.arrow(ctx, r, c.a, current);

    if (c.s) {
      const sp = s.specials[c.s];
      ctx.strokeStyle = sp.color;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, 0, r + 9, 0, Math.PI * 2);
      ctx.stroke();
      outlinedText(sp.name.toUpperCase() + (sp.tag ? " " + sp.tag : ""), 0, r + 38, sp.color, "900 16px Unbounded, sans-serif");
    }

    const caption = s.fast ? `${i + 1}` : `${i + 1} · ${c.f.toFixed(2)} с`;
    outlinedText(caption, 0, -r - (current ? 26 : 16), current ? SEL : "#fff", `900 ${current ? 17 : 14}px Nunito, sans-serif`);

    if (current) {
      // указатель над выбранной ячейкой
      const y = -r - 70 + (reduce ? 0 : Math.sin(time * 5) * 5);
      ctx.beginPath();
      ctx.moveTo(-14, y);
      ctx.lineTo(14, y);
      ctx.lineTo(0, y + 18);
      ctx.closePath();
      ctx.fillStyle = SEL;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHero(s) {
    if (s.hero !== heroId) {
      heroId = s.hero;
      heroImg = document.createElement("canvas");
      heroImg.width = heroImg.height = 168;
      course.paintHero(heroImg, heroId);
    }
    const y = reduce ? 0 : Math.sin(time * 3) * 5;
    ctx.drawImage(heroImg, -42, y - 42, 84, 84);
  }

  function drawGhost(s) {
    if (!s.canAppend) return;
    const x = geo.end + GHOST_AT, y = geo.ys[geo.ys.length - 1];
    const on = hover === "add";
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = on ? "rgba(255,255,255,.28)" : "rgba(255,255,255,.1)";
    ctx.strokeStyle = on ? "#fff" : "rgba(255,255,255,.65)";
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = reduce ? 0 : -time * 20;
    ctx.beginPath();
    ctx.roundRect(-GHOST_HALF, -GHOST_HALF, GHOST_HALF * 2, GHOST_HALF * 2, 16);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    ctx.fillRect(-4, -18, 8, 36);
    ctx.fillRect(-18, -4, 36, 8);
    ctx.restore();
  }

  function drawPortal(p) {
    const x = geo.end + PORTAL_AT, y = geo.ys[geo.ys.length - 1], size = 130;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.4);
    g.addColorStop(0, rgba(p.glow, 0.5));
    g.addColorStop(1, rgba(p.glow, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-size * 1.4, -size * 1.4, size * 2.8, size * 2.8);
    for (const [k, lw, a] of [[1, 9, 0.9], [1.14, 3, 0.45]]) {
      ctx.strokeStyle = rgba([255, 255, 255], a);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.32 * k, size * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Полоска всего уровня: цвета стрелок, особые ячейки, выбранная и видимая часть. */
  function mapRect() {
    return { x: MAP_PAD, y: h - MAP_PAD - MAP_H, w: w - MAP_PAD * 2, h: MAP_H };
  }

  function drawMap(s) {
    const m = mapRect();
    const total = geo.end + PORTAL_AT;
    const at = (x) => m.x + (x / total) * m.w;
    ctx.fillStyle = "rgba(10,8,30,.6)";
    ctx.beginPath();
    ctx.roundRect(m.x - 4, m.y - 4, m.w + 8, m.h + 8, 8);
    ctx.fill();
    s.cells.forEach((c, i) => {
      const x0 = at(geo.xs[i]), x1 = at(geo.xs[i + 1]);
      ctx.fillStyle = COLORS[c.a];
      ctx.fillRect(x0, m.y + 4, Math.max(1, x1 - x0 - 1), m.h - 8);
      if (c.s) {
        ctx.fillStyle = s.specials[c.s].color;
        ctx.fillRect(x1 - 3, m.y - 2, 4, m.h + 4);
      }
    });
    if (s.cells[s.sel]) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(at(geo.xs[s.sel + 1]) - 2, m.y - 4, 4, m.h + 8);
    }
    const v0 = Math.max(m.x, at(camX)), v1 = Math.min(m.x + m.w, at(camX + viewW()));
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(v0, m.y - 2, Math.max(4, v1 - v0), m.h + 4);
  }

  function frame(now) {
    raf = 0;
    if (!resize()) return; // экран редактора скрыт — цикл стоит до следующего show()
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    time += dt;

    const s = o.get();
    geo = layout(s.cells, s.fast);
    if (pendingFocus !== null) {
      focusNow(pendingFocus);
      pendingFocus = null;
    }
    if (camTarget !== null) {
      camX += (camTarget - camX) * (1 - Math.exp(-dt * (reduce ? 60 : 10)));
      if (Math.abs(camTarget - camX) < 0.5) {
        camX = camTarget;
        camTarget = null;
      }
    }
    clampCam();

    const p = paletteOf(s.theme);
    const left = camX - 60, right = camX + viewW() + 60;
    drawSky(p);

    ctx.save();
    ctx.translate(-camX * scale, h / 2);
    ctx.scale(scale, scale);
    drawBlocks(p, left, right);
    drawPortal(p);
    // рисуем только видимые участки
    let from = 0;
    while (from < s.cells.length && geo.xs[from + 1] < left - 120) from++;
    let to = from;
    while (to < s.cells.length && geo.xs[to] < right + 120) to++;
    if (to > from) drawRoad(s, from, to);
    drawHero(s);
    for (let i = from; i < to; i++) if (i !== s.sel) drawKey(s, i);
    if (s.sel >= from && s.sel < to) drawKey(s, s.sel);
    drawGhost(s);
    ctx.restore();

    drawMap(s);
  }

  // ---------- Мышь и касания ----------

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function inMap({ x, y }) {
    const m = mapRect();
    return y >= m.y - 8 && y <= m.y + m.h + 8 && x >= m.x - 4 && x <= m.x + m.w + 4;
  }

  /** Номер ячейки под точкой экрана, "add" — ячейка «+», null — пусто. */
  function hitTest({ x, y }) {
    if (!geo) return null;
    const s = o.get();
    const wx = toWorld(x), wy = (y - h / 2) / scale;
    if (s.canAppend && Math.abs(wx - (geo.end + GHOST_AT)) <= GHOST_HALF + 10
        && Math.abs(wy - geo.ys[geo.ys.length - 1]) <= GHOST_HALF + 30) return "add";
    if (Math.abs(wy) > FLOOR) return null;
    const pad = (s.fast ? KEY_R_FAST : KEY_R) * 0.8;
    if (wx < -60) return null; // левее старта — персонаж
    for (let i = 0; i < s.cells.length; i++) if (wx <= geo.xs[i + 1] + pad) return i;
    return null;
  }

  function jumpMap(x) {
    const m = mapRect();
    const total = geo.end + PORTAL_AT;
    camX = ((x - m.x) / m.w) * total - viewW() / 2;
    camTarget = null;
    clampCam();
  }

  function onDown(e) {
    if (!geo || e.button > 0) return;
    const pt = local(e);
    canvas.setPointerCapture(e.pointerId);
    if (inMap(pt)) {
      drag = { kind: "map" };
      jumpMap(pt.x);
      return;
    }
    const hit = hitTest(pt);
    if (hit === "add") {
      drag = null;
      o.append();
      return;
    }
    if (hit !== null && o.get().paints) {
      drag = { kind: "paint", done: new Set([hit]) };
      o.hit(hit);
      return;
    }
    drag = { kind: "pan", x: pt.x, camX, moved: false, hit };
  }

  function onMove(e) {
    const pt = local(e);
    if (!drag) {
      hover = inMap(pt) ? null : hitTest(pt);
      canvas.style.cursor = inMap(pt) || hover !== null ? "pointer" : "grab";
      return;
    }
    if (drag.kind === "map") {
      jumpMap(pt.x);
    } else if (drag.kind === "paint") {
      const hit = hitTest(pt);
      hover = hit;
      if (typeof hit === "number" && !drag.done.has(hit)) {
        drag.done.add(hit);
        o.hit(hit);
      }
    } else {
      if (Math.abs(pt.x - drag.x) > 5) drag.moved = true;
      if (drag.moved) {
        camX = drag.camX - (pt.x - drag.x) / scale;
        camTarget = null;
        canvas.style.cursor = "grabbing";
      }
    }
  }

  function onUp() {
    if (drag && drag.kind === "pan" && !drag.moved && drag.hit !== null) o.hit(drag.hit);
    drag = null;
    canvas.style.cursor = "grab";
  }

  function onWheel(e) {
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    camX += (d * (e.deltaMode === 1 ? 30 : 1)) / scale;
    camTarget = null;
    clampCam();
  }

  // ---------- Что вызывает levels.js ----------

  function focusNow(i) {
    if (!geo || i < 0 || i >= geo.xs.length - 1) return;
    const x = geo.xs[i + 1], cur = camTarget ?? camX;
    if (x < cur + viewW() * 0.15 || x > cur + viewW() * 0.82) camTarget = x - viewW() * 0.45;
  }

  /** Показать ячейку i, если она за краем экрана. */
  function focus(i) {
    pendingFocus = i;
  }

  /** Новый уровень открыт: камера к началу. */
  function reset() {
    camX = -viewW() * 0.3 || -300;
    camTarget = null;
    pendingFocus = null;
    hover = null;
  }

  /** Экран редактора виден: запустить цикл, если стоит. */
  function show() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function init(el, options) {
    canvas = el;
    ctx = canvas.getContext("2d");
    o = options;
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", () => { if (!drag) hover = null; });
    canvas.addEventListener("wheel", onWheel, { passive: false });
  }

  return { init, show, reset, focus };
})();
