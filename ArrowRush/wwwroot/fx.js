"use strict";

// Визуальные эффекты: фон с плывущими стрелками и частицы поверх всего (штрихи, капли, конфетти).
// Без свечения: всё рисуется обычным смешиванием, как тушь и бумага на светлом холсте.
// Без зависимостей, всё на двух <canvas>. При «уменьшить движение» в системе — почти всё выключено.
const fx = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const COLORS = [0, 1, 2, 3].map((i) => css.getPropertyValue("--a" + i).trim());
  const INK = "#000";
  // обрезки бумаги для конфетти: цвета стрелок, тушь и кость
  const SCRAPS = [...COLORS, INK, "#e7e5e4"];

  // стрелки: 0 ← 1 ↑ 2 → 3 ↓; символ в index.html смотрит вверх
  const ROT = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  const DIR = [[-1, 0], [0, -1], [1, 0], [0, 1]];
  const ARROW = new Path2D("M12 3 L21 13 H15.5 V21 H8.5 V13 H3 Z");

  const bg = document.getElementById("bg");
  const top = document.getElementById("fx");
  const bctx = bg.getContext("2d");
  const fctx = top.getContext("2d");
  let W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth;
    H = innerHeight;
    for (const c of [bg, top]) {
      c.width = W * dpr;
      c.height = H * dpr;
    }
  }
  resize();
  addEventListener("resize", resize);

  // ---------- Фон ----------

  let calm = 0;          // 0 — меню, 1 — игра (фон тише и медленнее, чтобы не отвлекал)
  let calmTarget = 0;
  let mx = 0, my = 0;    // мышь, -0.5..0.5 — для параллакса
  addEventListener("pointermove", (e) => { mx = e.clientX / W - 0.5; my = e.clientY / H - 0.5; });

  function drifter() {
    const z = 0.25 + Math.random() * 0.75; // глубина: ближе — крупнее, темнее, быстрее
    return {
      d: Math.floor(Math.random() * 4),
      z,
      x: Math.random() * W,
      y: Math.random() * H,
      size: 12 + z * 34,
      speed: 6 + z * 22,
      alpha: 0.025 + z * 0.055,
      wob: Math.random() * Math.PI * 2,
    };
  }
  const drifters = reduce ? [] : Array.from({ length: Math.round(Math.min(30, (W * H) / 45000)) }, drifter);

  function drawArrow(ctx, x, y, size, rot, color, alpha) {
    ctx.globalAlpha = alpha;
    drawShape(ctx, ARROW, x, y, size, rot, color);
  }

  /** Фигура из viewBox 24×24 с центром в (x, y); прозрачность — текущая у ctx. */
  function drawShape(ctx, path, x, y, size, rot, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(size / 24, size / 24);
    ctx.translate(-12, -12);
    ctx.fillStyle = color;
    ctx.fill(path);
    ctx.restore();
  }

  function drawBackground(dt, t) {
    calm += (calmTarget - calm) * Math.min(1, dt * 3);
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, W, H);

    const speedK = 1 - calm * 0.7;
    const alphaK = 1 - calm * 0.65;
    const pad = 40;

    for (const a of drifters) {
      const [dx, dy] = DIR[a.d];
      a.x += dx * a.speed * speedK * dt;
      a.y += dy * a.speed * speedK * dt;
      if (a.x < -pad) a.x = W + pad; else if (a.x > W + pad) a.x = -pad;
      if (a.y < -pad) a.y = H + pad; else if (a.y > H + pad) a.y = -pad;

      // лёгкое покачивание поперёк движения + параллакс
      const wob = Math.sin(t * 1.3 + a.wob) * 4 * a.z;
      const px = a.x + dy * wob - mx * 40 * a.z;
      const py = a.y + dx * wob - my * 40 * a.z;
      drawArrow(bctx, px, py, a.size, ROT[a.d], INK, a.alpha * alphaK);
    }
  }

  // ---------- Частицы ----------

  const parts = [];
  const MAX_PARTS = 600;

  function add(p) {
    if (parts.length < MAX_PARTS) parts.push(p);
  }

  /** Штрихи пером во все стороны и расплывающаяся капля (заполнили ползунок). */
  function burst(x, y, color, n = 18, power = 1) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (120 + Math.random() * 240) * power;
      add({
        kind: "spark", x, y, color,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 60 * power,
        life: 0, max: 0.45 + Math.random() * 0.45,
        size: 1 + Math.random() * 1.6,
      });
    }
    add({ kind: "bloom", x, y, color, life: 0, max: 0.6, radius: 26 * power });
    ring(x, y, color, 60 * power, 1.5);
  }

  /** Расходящееся тонкое кольцо. */
  function ring(x, y, color, radius = 70, width = 1.5) {
    if (reduce) return;
    add({ kind: "ring", x, y, color, life: 0, max: 0.6, radius, width });
  }

  /** Конфетти сверху (победа, финиш). */
  function confetti(n = 140) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      add({
        kind: "confetti",
        x: Math.random() * W, y: -20 - Math.random() * H * 0.4,
        vx: (Math.random() - 0.5) * 120, vy: 120 + Math.random() * 220,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 12,
        w: 6 + Math.random() * 6, h: 3 + Math.random() * 4,
        color: SCRAPS[i % SCRAPS.length], life: 0, max: 3 + Math.random() * 1.5,
        sway: Math.random() * Math.PI * 2,
      });
    }
  }

  /** Залп стрелками от точки (финиш). */
  function arrowsFrom(x, y, n = 16) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      const d = i % 4;
      const [dx, dy] = DIR[d];
      const sp = 200 + Math.random() * 300;
      const spread = (Math.random() - 0.5) * 0.6;
      add({
        kind: "arrow", x, y, d, color: COLORS[d],
        vx: (dx + dy * spread) * sp, vy: (dy + dx * spread) * sp,
        life: 0, max: 0.8 + Math.random() * 0.5, size: 12 + Math.random() * 14,
      });
    }
  }

  // ---------- Скины эффектов ----------

  const STAR = (() => {
    const path = new Path2D();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 4.5 : 11;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      path[i ? "lineTo" : "moveTo"](12 + Math.cos(a) * r, 12 + Math.sin(a) * r);
    }
    path.closePath();
    return path;
  })();
  // приглушённые палитры под бумажный фон
  const GOLD = ["#b8862f", "#d9b36a", "#8a6420"];
  const ICE = ["#ffffff", "#f1efe9", "#9fb6c4"];
  const FIRE = ["#b0503f", "#c4923a", "#7a2e24"];
  const VOLT = ["#4f7f9e", "#1f3d52", "#ffffff"];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /** Звёзды падают сверху, крутясь. */
  function stars(n = 70) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      add({
        kind: "star",
        x: Math.random() * W, y: -30 - Math.random() * H * 0.5,
        vx: (Math.random() - 0.5) * 80, vy: 160 + Math.random() * 220,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 6,
        size: 12 + Math.random() * 16, color: pick(GOLD),
        life: 0, max: 2.6 + Math.random() * 1.4,
      });
    }
  }

  /** Медленный снегопад. */
  function snow(n = 130) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      add({
        kind: "flake",
        x: Math.random() * W, y: -20 - Math.random() * H * 0.7,
        vx: (Math.random() - 0.5) * 30, vy: 60 + Math.random() * 90,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 2,
        size: 4 + Math.random() * 7, color: pick(ICE), sway: Math.random() * Math.PI * 2,
        life: 0, max: 4 + Math.random() * 2,
      });
    }
  }

  /** Ракеты снизу, на вершине — взрыв искрами. */
  function fireworks(n = 7) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      add({
        kind: "rocket",
        x: W * (0.15 + Math.random() * 0.7), y: H + 10,
        vx: (Math.random() - 0.5) * 60, vy: -(H * 0.9 + Math.random() * H * 0.5),
        color: COLORS[i % 4],
        life: -i * 0.22, max: 0.75 + Math.random() * 0.25,
      });
    }
  }

  /** Угольки поднимаются вверх и мерцают (серия «Пламя»; color null — радуга). */
  function embers(x, y, n, palette) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      add({
        kind: "ember",
        x: x + (Math.random() - 0.5) * 80, y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 90, vy: -(80 + Math.random() * 200),
        size: 2 + Math.random() * 4,
        color: palette ? pick(palette) : null, hue: Math.random() * 360,
        life: 0, max: 0.9 + Math.random() * 0.9, flick: Math.random() * 10,
      });
    }
  }

  /** Короткие ломаные разряды во все стороны (серия «Молнии»). */
  function zaps(x, y, n) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 260 + Math.random() * 380;
      add({
        kind: "zap", x, y, color: pick(VOLT),
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: 0, max: 0.35 + Math.random() * 0.3, seed: Math.random() * 100,
      });
    }
    ring(x, y, VOLT[0], 120, 4);
  }

  /** Эффект победы выбранного скина. */
  function win(kind, x, y) {
    if (kind === "stars") stars();
    else if (kind === "snow") snow();
    else if (kind === "fireworks") fireworks();
    else confetti(180);
    if (x !== undefined) arrowsFrom(x, y, 28);
  }

  /** Эффект серии побед выбранного скина; power растёт с длиной серии. */
  function streak(kind, x, y, power = 1) {
    const n = Math.round(30 * Math.min(2.5, power));
    if (kind === "electric") zaps(x, y, Math.round(n * 0.6));
    else if (kind === "rainbow") { embers(x, y, n, null); ring(x, y, COLORS[2], 110, 4); }
    else { embers(x, y, n, FIRE); ring(x, y, FIRE[0], 100, 4); }
  }

  function drawParticles(dt) {
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.clearRect(0, 0, W, H);
    if (parts.length === 0) return;

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life < 0) continue; // ракета ещё ждёт своей очереди
      const k = p.life / p.max;
      if (k >= 1) {
        parts.splice(i, 1);
        if (p.kind === "rocket") burst(p.x, p.y, p.color, 46, 1.5);
        continue;
      }

      if (p.kind === "star" || p.kind === "flake") {
        p.x += (p.vx + (p.sway !== undefined ? Math.sin((p.sway += dt * 2)) * 30 : 0)) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        fctx.globalAlpha = Math.min(1, (1 - k) * 3);
        if (p.kind === "star") {
          drawShape(fctx, STAR, p.x, p.y, p.size, p.rot, p.color);
        } else {
          fctx.strokeStyle = p.color;
          fctx.lineWidth = 1.6;
          fctx.beginPath();
          for (let j = 0; j < 3; j++) {
            const a = p.rot + (j * Math.PI) / 3;
            fctx.moveTo(p.x - Math.cos(a) * p.size, p.y - Math.sin(a) * p.size);
            fctx.lineTo(p.x + Math.cos(a) * p.size, p.y + Math.sin(a) * p.size);
          }
          fctx.stroke();
        }
      } else if (p.kind === "rocket") {
        p.vy *= 1 - dt * 1.6;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        fctx.globalAlpha = 1;
        fctx.strokeStyle = p.color;
        fctx.lineWidth = 3;
        fctx.beginPath();
        fctx.moveTo(p.x, p.y);
        fctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        fctx.stroke();
      } else if (p.kind === "ember") {
        p.vx *= 1 - dt * 1.5;
        p.x += p.vx * dt + Math.sin(p.life * 8 + p.flick) * 0.6;
        p.y += p.vy * dt;
        fctx.globalAlpha = (1 - k) * (0.6 + 0.4 * Math.sin(p.life * 30 + p.flick));
        fctx.fillStyle = p.color || `hsl(${(p.hue + p.life * 400) % 360} 45% 48%)`;
        fctx.beginPath();
        fctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, Math.PI * 2);
        fctx.fill();
      } else if (p.kind === "zap") {
        p.vx *= 1 - dt * 4;
        p.vy *= 1 - dt * 4;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // ломаная от точки назад по скорости
        fctx.globalAlpha = 1 - k;
        fctx.strokeStyle = p.color;
        fctx.lineWidth = 2;
        fctx.beginPath();
        fctx.moveTo(p.x, p.y);
        for (let j = 1; j <= 3; j++) {
          const jit = Math.sin(p.seed + j * 7 + p.life * 40) * 6;
          fctx.lineTo(p.x - p.vx * 0.02 * j - p.vy * 0.004 * jit, p.y - p.vy * 0.02 * j + p.vx * 0.004 * jit);
        }
        fctx.stroke();
      } else if (p.kind === "spark") {
        p.vx *= 1 - dt * 2.5;
        p.vy = p.vy * (1 - dt * 2.5) + 600 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // штрих пером вдоль полёта: длинный в начале, к концу сходит на нет
        fctx.globalAlpha = 1 - k;
        fctx.strokeStyle = p.color;
        fctx.lineWidth = p.size * (1 - k * 0.5);
        fctx.lineCap = "round";
        fctx.beginPath();
        fctx.moveTo(p.x, p.y);
        fctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        fctx.stroke();
      } else if (p.kind === "bloom") {
        // капля краски расплывается и бледнеет
        const e = 1 - (1 - k) ** 2;
        fctx.globalAlpha = (1 - k) * 0.28;
        fctx.fillStyle = p.color;
        fctx.beginPath();
        fctx.arc(p.x, p.y, 4 + p.radius * e, 0, Math.PI * 2);
        fctx.fill();
      } else if (p.kind === "ring") {
        const e = 1 - (1 - k) ** 3;
        fctx.globalAlpha = (1 - k) * 0.9;
        fctx.strokeStyle = p.color;
        fctx.lineWidth = p.width * (1 - k);
        fctx.beginPath();
        fctx.arc(p.x, p.y, 8 + p.radius * e, 0, Math.PI * 2);
        fctx.stroke();
      } else if (p.kind === "arrow") {
        p.vx *= 1 - dt * 1.8;
        p.vy *= 1 - dt * 1.8;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        drawArrow(fctx, p.x, p.y, p.size, ROT[p.d], p.color, (1 - k) * 0.9);
      } else {
        // конфетти
        p.sway += dt * 4;
        p.x += (p.vx + Math.sin(p.sway) * 40) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        fctx.save();
        fctx.translate(p.x, p.y);
        fctx.rotate(p.rot);
        fctx.scale(1, Math.cos(p.sway)); // «переворачивается» в воздухе
        fctx.globalAlpha = Math.min(1, (1 - k) * 3);
        fctx.fillStyle = p.color;
        fctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        fctx.restore();
      }
    }
    fctx.globalCompositeOperation = "source-over";
    fctx.globalAlpha = 1;
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    drawBackground(dt, now / 1000);
    drawParticles(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- Мелочи для DOM ----------

  /** Перезапускает CSS-анимацию класса (тряска, вспышка, «поп») и снимает класс, когда она закончится. */
  function retrigger(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    const done = (e) => {
      if (e.target !== el || e.pseudoElement) return; // анимации детей и ::after не считаем
      el.classList.remove(cls);
      el.removeEventListener("animationend", done);
    };
    el.addEventListener("animationend", done);
  }

  /** Плавно докручивает число в элементе до value. */
  function countUp(el, value, ms = 700) {
    const from = parseInt(el.textContent, 10);
    if (typeof value !== "number" || reduce || isNaN(from) || from === value) {
      el.textContent = value;
      return;
    }
    const start = performance.now();
    cancelAnimationFrame(el._countRaf);
    const step = (now) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - (1 - k) ** 3;
      el.textContent = Math.round(from + (value - from) * e);
      if (k < 1) el._countRaf = requestAnimationFrame(step);
    };
    el._countRaf = requestAnimationFrame(step);
  }

  /** Центр верхней части элемента в координатах экрана. */
  function anchor(el, atTop = false) {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, atTop ? r.top + 6 : r.top + r.height / 2];
  }

  return {
    colors: COLORS,
    burst, ring, confetti, arrowsFrom, win, streak,
    retrigger, countUp, anchor,
    setCalm(on) { calmTarget = on ? 1 : 0; },
  };
})();
