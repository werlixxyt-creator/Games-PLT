"use strict";

// Визуальные эффекты: фон с летящими стрелками и частицы поверх всего (искры, кольца, конфетти).
// Без зависимостей, всё на двух <canvas>. При «уменьшить движение» в системе — почти всё выключено.
const fx = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const COLORS = [0, 1, 2, 3].map((i) => css.getPropertyValue("--a" + i).trim());

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
    const z = 0.25 + Math.random() * 0.75; // глубина: ближе — крупнее, ярче, быстрее
    return {
      d: Math.floor(Math.random() * 4),
      z,
      x: Math.random() * W,
      y: Math.random() * H,
      size: 10 + z * 30,
      speed: 10 + z * 40,
      alpha: 0.04 + z * 0.12,
      wob: Math.random() * Math.PI * 2,
    };
  }
  const drifters = reduce ? [] : Array.from({ length: Math.round(Math.min(46, (W * H) / 32000)) }, drifter);

  function drawArrow(ctx, x, y, size, rot, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(size / 24, size / 24);
    ctx.translate(-12, -12);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill(ARROW);
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
      drawArrow(bctx, px, py, a.size, ROT[a.d], COLORS[a.d], a.alpha * alphaK);
    }
  }

  // ---------- Частицы ----------

  const parts = [];
  const MAX_PARTS = 600;

  function add(p) {
    if (parts.length < MAX_PARTS) parts.push(p);
  }

  /** Искры во все стороны (заполнили ползунок). */
  function burst(x, y, color, n = 18, power = 1) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (120 + Math.random() * 260) * power;
      add({
        kind: "spark", x, y, color,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 80 * power,
        life: 0, max: 0.45 + Math.random() * 0.45,
        size: 1.5 + Math.random() * 2.5,
      });
    }
    ring(x, y, color, 60 * power);
  }

  /** Расходящееся кольцо. */
  function ring(x, y, color, radius = 70, width = 3) {
    if (reduce) return;
    add({ kind: "ring", x, y, color, life: 0, max: 0.5, radius, width });
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
        color: COLORS[i % 4], life: 0, max: 3 + Math.random() * 1.5,
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

  function drawParticles(dt) {
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.clearRect(0, 0, W, H);
    if (parts.length === 0) return;

    fctx.globalCompositeOperation = "lighter";
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { parts.splice(i, 1); continue; }

      if (p.kind === "spark") {
        p.vx *= 1 - dt * 2.5;
        p.vy = p.vy * (1 - dt * 2.5) + 600 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        fctx.globalAlpha = 1 - k;
        fctx.fillStyle = p.color;
        fctx.beginPath();
        fctx.arc(p.x, p.y, p.size * (1 - k * 0.6), 0, Math.PI * 2);
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
        // конфетти рисуем обычным смешиванием, иначе на светлом выцветает
        fctx.globalCompositeOperation = "source-over";
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
        fctx.globalCompositeOperation = "lighter";
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
    burst, ring, confetti, arrowsFrom,
    retrigger, countUp, anchor,
    setCalm(on) { calmTarget = on ? 1 : 0; },
  };
})();
