"use strict";

// Превью уровня в редакторе, как в GD: тот же космос, что в матче, пол и потолок из блоков, ячейки по порядку вдоль пути.
// Ключи рисует cells.js, как в матче. ↑ уводит путь вверх, ↓ вниз, длина участка — время заполнения.
// Что делать с ячейкой под курсором, решает levels.js: сюда приходят только клики, протяжка и прокрутка.
// Блоки, декор и триггеры (levelobj.js) стоят у стрелки своей ячейки; инструментом «Выбор» их таскают, ластиком удаляют.
const edview = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const COLORS = [0, 1, 2, 3].map((i) => css.getPropertyValue("--a" + i).trim());
  const OUTLINE = css.getPropertyValue("--outline").trim() || "#1d1340";
  const SEL = COLORS[3];
  const FAKE = "#d36bff";

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

  // o: { get, hit(i), append(), place(c, x, y) — поставить объект, pickObj(obj), eraseObj(obj), moved() — объект перетащили }
  let canvas, ctx, o;
  let w = 0, h = 0, scale = 1;
  let camX = -300, camTarget = null, pendingFocus = null;
  let geo = null;            // { xs, ys, end } последнего кадра
  let hover = null;          // номер ячейки под курсором, "add" — ячейка «+», объект — сам объект
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

  /** Стрелка ячейки c: к ней привязаны объекты. */
  const keyAt = (c) => ({ x: geo.xs[c + 1], y: geo.ys[c + 1] });

  /** Ячейка, чья стрелка ближе всего к x мира. */
  function anchor(wx) {
    let best = 0;
    for (let c = 1; c < geo.xs.length - 1; c++) if (Math.abs(geo.xs[c + 1] - wx) < Math.abs(geo.xs[best + 1] - wx)) best = c;
    return best;
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

  /** Сетка «Сетки»: тонкие линии между полом и потолком, каждая четвёртая ярче. */
  function drawGrid(g, left, right) {
    ctx.lineWidth = 1 / scale;
    for (const strong of [false, true]) {
      ctx.strokeStyle = strong ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.07)";
      ctx.beginPath();
      for (let x = Math.floor(left / g) * g; x <= right; x += g) {
        if ((Math.round(x / g) % 4 === 0) !== strong) continue;
        ctx.moveTo(x, -FLOOR);
        ctx.lineTo(x, FLOOR);
      }
      for (let y = -Math.floor(FLOOR / g) * g; y <= FLOOR; y += g) {
        if ((Math.round(y / g) % 4 === 0) !== strong) continue;
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }
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
      ctx.globalAlpha = run ? (i < run.i ? 0.95 : 0.42) : i === s.sel ? 0.95 : i === hover ? 0.7 : 0.42;
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

    // препятствия: стена вместо стрелки, шипы — красная ячейка, обман — настоящая стрелка с пометкой для автора
    if (c.o === "wall") {
      levelobj.wall(ctx, r);
      outlinedText("СТЕНА", 0, r * 2.2 + 26, "#d8d2e6", "900 15px Unbounded, sans-serif");
    } else if (c.o === "spike") {
      cells.draw(ctx, { skin: s.skin, r, color: levelobj.SPIKE, t: time });
      levelobj.spikes(ctx, r);
      outlinedText("ШИПЫ", 0, r + 38, levelobj.SPIKE, "900 16px Unbounded, sans-serif");
    } else {
      cells.draw(ctx, { skin: s.skin, r, color: COLORS[c.a], t: time });
      cells.arrow(ctx, r, c.a, current);
    }
    if (c.o === "fake") {
      ctx.strokeStyle = FAKE;
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // какой она покажется издалека
      ctx.save();
      ctx.translate(r * 0.95, r * 0.95);
      ctx.globalAlpha = 0.85;
      cells.arrow(ctx, r * 0.42, (c.a + 2) % 4, false);
      ctx.restore();
      outlinedText("ОБМАН", 0, r + 38, FAKE, "900 16px Unbounded, sans-serif");
    }

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

  function drawHero(s, x = 0, y = 0) {
    if (s.hero !== heroId) {
      heroId = s.hero;
      heroImg = document.createElement("canvas");
      heroImg.width = heroImg.height = 168;
      course.paintHero(heroImg, heroId);
    }
    y += reduce ? 0 : Math.sin(time * 3) * 5;
    ctx.drawImage(heroImg, x - 42, y - 42, 84, 84);
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

  /** Объекты уровня: блоки и декор своего слоя (0 — за дорогой, 1 — перед ней), триггеры — значками поверх, с пунктиром вниз к своей ячейке. */
  function drawObjects(s, left, right, triggers, layer = 0) {
    for (const ob of s.objects) {
      if (levelobj.isTrigger(ob.k) !== triggers || ob.c >= s.cells.length) continue;
      if (!triggers && (ob.z || 0) !== layer) continue;
      const k = keyAt(ob.c), x = k.x + ob.x, y = k.y + ob.y, r = levelobj.radius(ob);
      if (x < left - r * 2 || x > right + r * 2) continue;
      if (triggers) {
        ctx.strokeStyle = "rgba(255,255,255,.5)";
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(x, y + (y < k.y ? 26 : -26));
        ctx.lineTo(x, k.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // в тесте объекты двигают и красят триггеры анимации
      const look = run && !triggers ? run.rt.look(ob) : null;
      if (run && !triggers && !look) continue;
      ctx.save();
      ctx.translate(x, y);
      if (triggers) levelobj.drawTrigger(ctx, ob, ob === s.selObj);
      else if (look) trigrun.drawObject(ctx, ob, look, time);
      else levelobj.draw(ctx, ob, time);
      if (!run && !triggers && ob.gr > 0) {
        // номер группы — маленькой плашкой, чтобы видеть, что двигают триггеры
        ctx.font = "900 13px Nunito, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(16,12,34,.8)";
        ctx.fillRect(r * 0.5, -r - 4, 26, 17);
        ctx.fillStyle = "#ffe14a";
        ctx.fillText(ob.gr, r * 0.5 + 13, -r + 9);
      }
      if (ob === s.selObj || ob === hover) {
        ctx.strokeStyle = ob === s.selObj ? SEL : "rgba(255,255,255,.7)";
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 8]);
        ctx.lineDashOffset = reduce ? 0 : -time * 30;
        ctx.beginPath();
        ctx.arc(0, 0, r + 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
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
    const mark = run ? heroPos().x : s.cells[s.sel] ? geo.xs[s.sel + 1] : null;
    if (mark !== null) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(at(mark) - 2, m.y - 4, 4, m.h + 8);
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

    let s = o.get();
    geo = layout(s.cells, s.fast);
    if (run) {
      s = { ...s, sel: -1 };
      hover = null;
      runFrame(dt);
    } else if (pendingFocus !== null) {
      focusNow(pendingFocus);
      pendingFocus = null;
    }
    if (!run && camTarget !== null) {
      camX += (camTarget - camX) * (1 - Math.exp(-dt * (reduce ? 60 : 10)));
      if (Math.abs(camTarget - camX) < 0.5) {
        camX = camTarget;
        camTarget = null;
      }
    }
    clampCam();

    // в тесте триггеры уровня меняют палитру, камеру и фон, как в матче
    const tv = run ? run.rt.view() : null;
    const p = run ? run.rt.palette(paletteOf(s.theme)) : paletteOf(s.theme);
    const left = camX - 60, right = camX + viewW() + 60;
    drawSky(p);
    const bgView = { w, h, camX, scale, time };
    if (tv) {
      if (tv.bg.k < 1) bgart.draw(ctx, tv.bg.prev, bgView, p, 1 - tv.bg.k);
      bgart.draw(ctx, tv.bg.id, bgView, p, tv.bg.k);
    }

    ctx.save();
    if (tv) {
      // зум и наклон — вокруг персонажа, сдвиг и тряска — всей камерой
      const shake = reduce ? 0 : Math.max(run.shake, tv.rumble * 0.7) * 16;
      const ax = w * 0.35, ay = h / 2;
      ctx.translate(ax + (Math.random() - 0.5) * shake, ay + (Math.random() - 0.5) * shake);
      ctx.rotate(tv.tilt);
      ctx.scale(tv.zoom, tv.zoom);
      ctx.translate(-ax - tv.ox * scale, -ay - tv.oy * scale);
    }
    ctx.translate(-camX * scale, h / 2);
    ctx.scale(scale, scale);
    drawBlocks(p, left, right);
    if (!run && s.grid && s.mode === "object") drawGrid(s.grid, left, right);
    drawPortal(p);
    drawObjects(s, left, right, false);
    // рисуем только видимые участки
    let from = 0;
    while (from < s.cells.length && geo.xs[from + 1] < left - 120) from++;
    let to = from;
    while (to < s.cells.length && geo.xs[to] < right + 120) to++;
    if (to > from) drawRoad(s, from, to);
    if (run) {
      for (let i = to - 1; i >= Math.max(from, run.i); i--) drawRunKey(s, i);
      drawObjects(s, left, right, false, 1);
      drawRunHero(s);
    } else {
      drawHero(s);
      for (let i = from; i < to; i++) if (i !== s.sel) drawKey(s, i);
      if (s.sel >= from && s.sel < to) drawKey(s, s.sel);
      drawObjects(s, left, right, false, 1);
      drawGhost(s);
      drawObjects(s, left, right, true);
    }
    ctx.restore();

    if (tv) {
      if (tv.effect.k < 1) bgart.effect(ctx, tv.effect.prev, bgView, p, 1 - tv.effect.k);
      bgart.effect(ctx, tv.effect.id, bgView, p, tv.effect.k);
      bgart.darken(ctx, w, h, tv.dark);
      if (tv.message) bgart.message(ctx, w, h, tv.message.text, tv.message.alpha);
      if (run.flash.k > 0.02 && !reduce) {
        ctx.fillStyle = `rgba(${run.flash.rgb.join(",")},${run.flash.k * 0.6})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
    drawMap(s);
    if (run) drawHud(s);
  }

  // ---------- Быстрый тест ----------
  // Уровень проходится прямо в превью, как в GD: с выбранной ячейки, без сервера и без выхода из редактора.
  // Правила те же, что в Match.cs (их числа передаёт levels.js), но прохождение не засчитывается для публикации.
  // «Раст», «Кловд» и триггеры здесь не запускаются — их проверяет полный «Тест».

  // run: { cells, from, fast, rules, i, k, held, t, startT, entered, stunUntil, jumpAt, hits, wallSeconds,
  //        attempt, shown, done, failAt, msg, saved }
  let run = null;

  const JUMP_HEIGHT = 120;

  function play(level) {
    run = {
      cells: level.cells, from: level.from, fast: level.fast, rules: level.rules,
      held: 0, t: 0, attempt: 0, msg: null, saved: camX, onEnd: level.onEnd,
      objects: level.objects || [], rt: null, flash: { rgb: [255, 255, 255], k: 0 }, shake: 0,
    };
    restart();
    hover = null;
    drag = null;
    canvas.style.cursor = "default";
    if (geo) camX = heroPos().x - viewW() * 0.35;
    camTarget = null;
    show();
  }

  function stop() {
    if (!run) return;
    camX = run.saved;
    run = null;
    canvas.style.cursor = "grab";
  }

  /** Попытка с начала: туда же, откуда запускали. */
  function restart() {
    Object.assign(run, {
      i: run.from, k: 0, startT: run.t, entered: run.t, stunUntil: -Infinity, jumpAt: -Infinity,
      hits: 0, wallSeconds: 0, done: null, failAt: null, shown: run.from, attempt: run.attempt + 1,
    });
    // триггеры заново: всё, что позади стартовой ячейки, уже включено
    run.rt = trigrun.create(run.objects);
    run.rt.seek(run.from);
  }

  function say(text, color = "#fff") {
    run.msg = { text, color, at: run.t };
  }

  const cur = () => run.cells[run.i];
  const live = () => run.done === null && run.failAt === null;
  const wallLives = () => run.rules.wallLives - Math.floor(run.wallSeconds / run.rules.wallLife);

  function advance() {
    const note = cur().note;
    if (note) say(`${note} — только в полном «Тесте»`, "#ffd54a");
    run.i++;
    run.k = 0;
    run.entered = run.t;
    run.hits = 0;
    run.wallSeconds = 0;
    if (run.i >= run.cells.length) {
      run.done = run.t;
      say(`Пройдено за ${(run.t - run.startT).toFixed(2)} с`, COLORS[1]);
    }
  }

  function fail(text) {
    run.failAt = run.t;
    say(text, "#ff3b5c");
  }

  /** НЛО: удар возвращает к началу участка, как Match.Crash. */
  function crash() {
    run.jumpAt = -Infinity;
    run.k = 0;
    while (run.i > 0 && run.cells[run.i - 1].ufo) run.i--;
    say("Удар!", "#ff3b5c");
  }

  function stepRun(dt) {
    run.t += dt;
    for (const ev of run.rt.update(run.i, dt)) {
      if (ev.type === "flash") run.flash = { rgb: ev.rgb, k: Math.max(run.flash.k, ev.power) };
      else if (ev.type === "shake") run.shake = Math.max(run.shake, ev.power);
    }
    run.flash.k *= Math.exp(-dt * 4);
    run.shake *= Math.exp(-dt * 5);
    if (run.failAt !== null) {
      if (run.t - run.failAt > 0.8) {
        restart();
        run.shown = run.from;
      }
      return;
    }
    if (run.done !== null) {
      if (run.t - run.done > 2.4) end();
      return;
    }
    const c = cur(), R = run.rules;
    if (c.ufo) {
      run.k += dt / c.f;
      if (run.k < 1) return;
      const jump = (run.t - run.jumpAt) / R.jump;
      if (jump >= R.clearFrom && jump <= R.clearTo) advance();
      else crash();
      return;
    }
    if (c.wall) {
      if (c.zone !== "rainbow") return;
      run.wallSeconds += dt;
      if (wallLives() <= 0) fail("Лазеры добили — заново");
      return;
    }
    if (c.spike) {
      if (run.held) return;
      run.k += dt / c.f;
      if (run.k >= 1) advance();
      return;
    }
    if (run.fast) return;
    const target = 1 << c.a;
    if (!run.held) run.k -= R.idle * dt;
    else if (run.held & ~target) run.k -= R.wrong * dt;
    else run.k += dt / c.f;
    run.k = Math.max(0, run.k);
    if (run.k >= 1) advance();
  }

  /** Стрелку нажали: новые нажатия разбираются, как в Match.SetHeld. */
  function press(a) {
    if (!run) return;
    const bit = 1 << a;
    const fresh = !(run.held & bit);
    run.held |= bit;
    if (!fresh || !live()) return;
    const c = cur(), R = run.rules;
    if (c.ufo) {
      if (run.t - run.jumpAt >= R.jump) run.jumpAt = run.t;
    } else if (c.wall) {
      run.hits++;
      run.k = run.hits / R.wallHits;
      if (run.hits >= R.wallHits) advance();
    } else if (c.spike) {
      if (run.t - run.entered < R.spikeGrace) return;
      run.k = 0;
      say("Шипы!", "#ff3b5c");
    } else if (run.fast && run.t >= run.stunUntil) {
      if (a === c.a) advance();
      else run.stunUntil = run.t + R.stun;
    }
  }

  function release(a) {
    if (run) run.held &= ~(1 << a);
  }

  function releaseAll() {
    if (run) run.held = 0;
  }

  /** Тест кончился сам (уровень пройден): редактор возвращает свои кнопки. */
  function end() {
    const cb = run.onEnd;
    stop();
    if (cb) cb();
  }

  /** Где персонаж: на участке i он летит от точки i к стрелке i; после финиша — к порталу. */
  function heroPos() {
    const n = geo.xs.length - 1;
    const f = run.shown;
    if (f >= n) return { x: geo.end + Math.min(1, f - n) * PORTAL_AT, y: geo.ys[n] };
    const i = Math.max(0, Math.floor(f)), k = f - i;
    return { x: geo.xs[i] + (geo.xs[i + 1] - geo.xs[i]) * k, y: geo.ys[i] + (geo.ys[i + 1] - geo.ys[i]) * k };
  }

  function runFrame(dt) {
    stepRun(dt);
    if (!run) return;
    const target = run.done !== null ? run.cells.length + 1 : run.i + Math.min(1, run.k);
    run.shown += (target - run.shown) * (1 - Math.exp(-dt * (reduce ? 60 : 16)));
    const want = heroPos().x - viewW() * 0.35;
    camX += (want - camX) * (1 - Math.exp(-dt * (reduce ? 60 : 7)));
  }

  function drawRunKey(s, i) {
    const c = run.cells[i];
    const now = i === run.i && live();
    const r = (s.fast ? KEY_R_FAST : KEY_R) * (now ? 1.15 : 1);
    const k = now ? Math.min(1, run.k) : 0;
    ctx.save();
    ctx.translate(geo.xs[i + 1], geo.ys[i + 1] + (reduce ? 0 : Math.sin(time * 2.4 + i * 1.3) * 3));

    if (c.wall) {
      levelobj.wall(ctx, r);
      if (now) {
        outlinedText(`${run.rules.wallHits - run.hits}`, 0, 8, "#fff", "900 22px Unbounded, sans-serif");
        const lives = c.zone === "rainbow" ? ` · ♥ ${wallLives()}` : "";
        outlinedText(`ЖМИ ЛЮБУЮ${lives}`, 0, r * 2.2 + 26, "#d8d2e6", "900 15px Unbounded, sans-serif");
      }
    } else if (c.spike || c.ufo) {
      cells.draw(ctx, { skin: s.skin, r, color: levelobj.SPIKE, k, t: time });
      levelobj.spikes(ctx, r);
      if (now) outlinedText(c.ufo ? "ПРЫГАЙ" : "НЕ ЖМИ", 0, r + 38, levelobj.SPIKE, "900 16px Unbounded, sans-serif");
    } else {
      // обман открывает настоящую стрелку, только когда до неё дошли
      const a = c.fake && !now ? (c.a + 2) % 4 : c.a;
      const wrong = now && (run.fast ? run.t < run.stunUntil : (run.held & ~(1 << c.a)) !== 0);
      cells.draw(ctx, { skin: s.skin, r, color: COLORS[a], k, t: time, wrong });
      cells.arrow(ctx, r, a, now);
    }

    const sp = s.cells[i] && s.cells[i].s && s.specials[s.cells[i].s];
    if (sp) {
      ctx.strokeStyle = sp.color;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, 0, r + 9, 0, Math.PI * 2);
      ctx.stroke();
      outlinedText(sp.name.toUpperCase(), 0, -r - 18, sp.color, "900 15px Unbounded, sans-serif");
    }
    ctx.restore();
  }

  function drawRunHero(s) {
    const p = heroPos();
    let y = p.y;
    const ufo = run.i < run.cells.length && run.cells[run.i].ufo;
    const jump = (run.t - run.jumpAt) / run.rules.jump;
    if (ufo && jump >= 0 && jump <= 1) y -= Math.sin(jump * Math.PI) * JUMP_HEIGHT;
    if (ufo) {
      // НЛО под персонажем
      ctx.fillStyle = "rgba(57,230,255,.85)";
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 50, 62, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (run.failAt !== null) ctx.globalAlpha = Math.floor(run.t * 12) % 2 ? 0.25 : 1;
    drawHero(s, p.x, y);
    ctx.globalAlpha = 1;
  }

  /** Плашка теста сверху и большие надписи по центру — в пикселях экрана. */
  function drawHud() {
    const n = run.cells.length, total = n - run.from;
    const passed = Math.min(run.i, n) - run.from;
    const secs = (run.done ?? run.failAt ?? run.t) - run.startT;
    const bw = Math.min(460, w - 24), bx = (w - bw) / 2, by = 12;

    ctx.save();
    ctx.fillStyle = "rgba(16,12,34,.72)";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 70, 14);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "900 14px Unbounded, sans-serif";
    ctx.fillText(`БЫСТРЫЙ ТЕСТ · попытка ${run.attempt} · ${secs.toFixed(1)} с`, w / 2, by + 22);
    ctx.fillStyle = "rgba(255,255,255,.15)";
    ctx.fillRect(bx + 14, by + 32, bw - 28, 8);
    ctx.fillStyle = COLORS[1];
    ctx.fillRect(bx + 14, by + 32, (bw - 28) * (total ? passed / total : 1), 8);
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.font = "800 12px Nunito, sans-serif";
    ctx.fillText(`с ячейки ${run.from + 1} · ${passed}/${total} · Esc — в редактор · для публикации нужен полный «Тест»`, w / 2, by + 58);

    const m = run.msg;
    if (m && run.t - m.at < 1.6) {
      ctx.globalAlpha = Math.min(1, (1.6 - (run.t - m.at)) * 2.5);
      outlinedText(m.text, w / 2, h * 0.3, m.color, `900 ${m.text.length > 20 ? 22 : 34}px Unbounded, sans-serif`);
    }
    ctx.restore();
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

  /** Объект под точкой экрана: сверху то, что нарисовано позже, — триггеры, потом декор с конца списка. */
  function hitObject({ x, y }) {
    const s = o.get();
    const wx = toWorld(x), wy = (y - h / 2) / scale;
    for (const triggers of [true, false]) {
      for (let i = s.objects.length - 1; i >= 0; i--) {
        const ob = s.objects[i];
        if (levelobj.isTrigger(ob.k) !== triggers || ob.c >= s.cells.length) continue;
        const k = keyAt(ob.c);
        if (Math.hypot(wx - (k.x + ob.x), wy - (k.y + ob.y)) <= levelobj.radius(ob) + 8) return ob;
      }
    }
    return null;
  }

  /** Объекты ловят курсор только у «Выбора» и ластика: остальные инструменты работают с ячейками под ними. */
  const objectsClickable = (s) => s.mode === "pick" || s.mode === "erase";

  function jumpMap(x) {
    const m = mapRect();
    const total = geo.end + PORTAL_AT;
    camX = ((x - m.x) / m.w) * total - viewW() / 2;
    camTarget = null;
    clampCam();
  }

  function onDown(e) {
    if (!geo || e.button > 0 || run) return; // в тесте превью не правится
    const pt = local(e);
    canvas.setPointerCapture(e.pointerId);
    if (inMap(pt)) {
      drag = { kind: "map" };
      jumpMap(pt.x);
      return;
    }
    const s = o.get();
    const ob = objectsClickable(s) ? hitObject(pt) : null;
    if (ob) {
      drag = null;
      if (s.mode === "erase") return o.eraseObj(ob);
      o.pickObj(ob);
      if (!s.locked) drag = { kind: "move", ob, x: pt.x, y: pt.y, oc: ob.c, ox: ob.x, oy: ob.y, moved: false };
      return;
    }
    const hit = hitTest(pt);
    if (hit === "add") {
      drag = null;
      o.append();
      return;
    }
    if (s.mode === "object") {
      // новый объект у ближайшей ячейки, там, куда кликнули; с «Протяжкой» — и дальше, пока ведёшь
      const p = gridPoint(toWorld(pt.x), (pt.y - h / 2) / scale, s.grid);
      placeAt(p);
      drag = s.swipe ? { kind: "swipe", last: p } : null;
      return;
    }
    if (hit !== null && s.paints) {
      drag = { kind: "paint", done: new Set([hit]) };
      o.hit(hit);
      return;
    }
    drag = { kind: "pan", x: pt.x, camX, moved: false, hit };
  }

  /** Точка мира, выровненная по сетке шага grid (0 — без сетки). */
  function gridPoint(wx, wy, grid) {
    return grid ? { x: Math.round(wx / grid) * grid, y: Math.round(wy / grid) * grid } : { x: wx, y: wy };
  }

  function placeAt(p) {
    const c = anchor(p.x), k = keyAt(c);
    o.place(c, p.x - k.x, p.y - k.y);
  }

  /** «Протяжка»: объекты встают вплотную друг к другу — шаг равен размеру объекта, по главной оси движения. */
  function swipeTo(pt) {
    const s = o.get();
    const step = s.swipeStep || 60;
    const wx = toWorld(pt.x), wy = (pt.y - h / 2) / scale;
    for (let guard = 0; guard < 40; guard++) {
      const dx = wx - drag.last.x, dy = wy - drag.last.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < step) return;
      const p = Math.abs(dx) >= Math.abs(dy)
        ? { x: drag.last.x + Math.sign(dx) * step, y: drag.last.y }
        : { x: drag.last.x, y: drag.last.y + Math.sign(dy) * step };
      drag.last = p;
      placeAt(p);
    }
  }

  /** Перетаскивание объекта: он переходит к ближайшей ячейке, триггер встаёт прямо над её стрелкой. */
  function moveObject(pt) {
    if (Math.abs(pt.x - drag.x) + Math.abs(pt.y - drag.y) > 4) drag.moved = true;
    if (!drag.moved) return;
    const from = keyAt(drag.oc);
    const g = gridPoint(from.x + drag.ox + (pt.x - drag.x) / scale, from.y + drag.oy + (pt.y - drag.y) / scale, o.get().grid);
    const wx = g.x, wy = g.y;
    const c = anchor(wx), k = keyAt(c);
    drag.ob.c = c;
    drag.ob.x = levelobj.isTrigger(drag.ob.k) ? 0 : Math.round(wx - k.x);
    drag.ob.y = Math.round(Math.max(-VIEW_H, Math.min(VIEW_H, wy)) - k.y);
    canvas.style.cursor = "grabbing";
  }

  function onMove(e) {
    if (run) return;
    const pt = local(e);
    if (!drag) {
      const s = o.get();
      const ob = !inMap(pt) && objectsClickable(s) ? hitObject(pt) : null;
      hover = ob || (inMap(pt) ? null : hitTest(pt));
      canvas.style.cursor = ob ? "move" : s.mode === "object" ? "copy" : inMap(pt) || hover !== null ? "pointer" : "grab";
      return;
    }
    if (drag.kind === "map") {
      jumpMap(pt.x);
    } else if (drag.kind === "swipe") {
      swipeTo(pt);
    } else if (drag.kind === "move") {
      moveObject(pt);
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
    if (drag && drag.kind === "pan" && !drag.moved) {
      if (drag.hit !== null) o.hit(drag.hit);
      else o.pickObj(null); // клик в пустоту снимает выбор с объекта
    }
    if (drag && drag.kind === "move" && drag.moved) o.moved();
    drag = null;
    canvas.style.cursor = "grab";
  }

  function onWheel(e) {
    e.preventDefault();
    if (run) return; // в тесте камера едет за персонажем
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

  return { init, show, reset, focus, play, stop, press, release, releaseAll, playing: () => !!run };
})();
