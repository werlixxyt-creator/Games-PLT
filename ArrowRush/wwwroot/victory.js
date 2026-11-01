"use strict";

// Большая сцена победы на весь экран: играет в конце уровня и как превью на экране скинов.
// Скин победы — это постановка (SHOWS). Ритм у всех общий: нарастание, удар в момент IMPACT
// (вспышка, тряска, фанфара), затем надпись с персонажем игрока и послесвечение.
// В отличие от fx.js здесь есть свечение: частицы складываются режимом "lighter" на тёмном фоне.
// Рисует только пока идёт сцена. При «уменьшить движение» — спокойная надпись без эффектов.
const victory = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const COLORS = [0, 1, 2, 3].map((i) => css.getPropertyValue("--a" + i).trim());
  const OUTLINE = css.getPropertyValue("--outline").trim() || "#1d1340";
  const FONT = css.getPropertyValue("--font-display").trim();
  const BODY_FONT = css.getPropertyValue("--font-body").trim();
  const GOLD = ["#ffc93c", "#ffe27a", "#ff9f1c"];
  const ICE = ["#ffffff", "#d8f3ff", "#9fe3ff"];
  const ARROW = new Path2D("M12 3 L21 13 H15.5 V21 H8.5 V13 H3 Z");
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

  const IMPACT = 1.3;      // секунда удара
  const LENGTH = 5.4;      // длина всей сцены
  const CALM_LENGTH = 2.5; // столько держится надпись при «уменьшить движение»
  const FADE = 0.5;        // сцена растворяется в конце
  const SKIP_AFTER = 1.1;  // раньше не пропускаем: игрок ещё жмёт клавиши последнего ползунка
  const MAX_PARTS = 1400;
  const TAU = Math.PI * 2;

  const canvas = document.getElementById("victory");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;
  let run = null;  // идущая сцена: { show, t0, end, last, cues, parts, rings, flash, shake, ... }

  const clamp01 = (k) => Math.max(0, Math.min(1, k));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const easeOut = (k) => 1 - (1 - k) ** 3;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = innerWidth;
    H = innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  addEventListener("resize", () => { if (run) resize(); });

  // ---------- Рисование ----------

  /** Фигура из viewBox 24×24 с центром в (x, y); прозрачность — текущая у ctx. */
  function shape(path, x, y, size, rot, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(size / 24, size / 24);
    ctx.translate(-12, -12);
    ctx.fillStyle = color;
    ctx.fill(path);
    ctx.restore();
  }

  /** Мягкое пятно света. */
  function glow(x, y, radius, color, alpha = 1) {
    if (radius <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  // ---------- Частицы и кольца ----------

  function add(p) {
    if (run.parts.length < MAX_PARTS) run.parts.push({ life: 0, drag: 0, grav: 0, vr: 0, rot: 0, ...p });
  }

  /** Разлёт из точки: o = { kind, colors, speed, drag, grav, max: [от, до], size: [от, до] }. */
  function burst(x, y, n, o) {
    for (let i = 0; i < n; i++) {
      const ang = rand(0, TAU);
      const sp = o.speed * Math.sqrt(Math.random());
      add({
        kind: o.kind, x, y, color: pick(o.colors),
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        rot: ang + Math.PI / 2, vr: o.kind === "star" ? rand(-5, 5) : 0,
        drag: o.drag || 0, grav: o.grav || 0,
        max: rand(...o.max), size: rand(...o.size),
      });
    }
  }

  /** Ударная волна, через delay секунд от текущего момента сцены. */
  function ring(x, y, radius, width, color, delay = 0, max = 0.9) {
    run.rings.push({ x, y, radius, width, color, at: run.t + delay, max });
  }

  /** Вызывает fn в среднем rate раз в секунду. */
  function emit(dt, rate, fn) {
    run.acc = (run.acc || 0) + dt * rate;
    while (run.acc >= 1) { run.acc--; fn(); }
  }

  function drawRings(t) {
    ctx.lineCap = "butt";
    for (const r of run.rings) {
      const k = (t - r.at) / r.max;
      if (k <= 0 || k >= 1) continue;
      ctx.globalAlpha = (1 - k) ** 2;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - k);
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + r.radius * easeOut(k), 0, TAU);
      ctx.stroke();
    }
  }

  function drawParts(dt) {
    const parts = run.parts;
    ctx.lineCap = "round";
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) {
        parts.splice(i, 1);
        if (p.die) p.die(p);
        continue;
      }
      const air = Math.max(0, 1 - p.drag * dt);
      p.vx *= air;
      p.vy = p.vy * air + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ctx.globalAlpha = Math.min(1, (1 - k) * 2);

      if (p.kind === "line") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.stroke();
      } else if (p.kind === "arrow") {
        shape(ARROW, p.x, p.y, p.size, p.rot, p.color);
      } else if (p.kind === "star") {
        shape(STAR, p.x, p.y, p.size, p.rot, p.color);
      } else if (p.kind === "shard") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        p.pts.forEach(([x, y], j) => ctx[j ? "lineTo" : "moveTo"](x, y));
        ctx.closePath();
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
    }
  }

  // ---------- Постановки ----------

  // setup(cue) готовит сцену, cue(секунда, fn) ставит событие на таймлайн (удар — IMPACT);
  // draw(t, dt) рисует слой под частицами. sky — цвет затемнения, title — градиент букв сверху вниз.
  const SHOWS = {
    // Стрелки слетаются со всех сторон в гигантскую стрелку, она уносится вверх, и всё разлетается
    rush: {
      sky: "#140a38",
      title: ["#ffffff", "#ffc93c"],
      setup(cue) {
        run.flow = Array.from({ length: 170 }, () => ({
          a: rand(0, TAU), at: rand(0.3, IMPACT), color: pick(COLORS), size: rand(18, 48),
        }));
        cue(IMPACT, () => {
          const cx = W / 2, cy = H / 2, big = Math.hypot(W, H);
          burst(cx, cy, 110, { kind: "arrow", colors: COLORS, speed: big * 1.5, drag: 1.5, max: [1, 2], size: [22, 64] });
          burst(cx, cy, 150, { kind: "line", colors: [...COLORS, "#fff"], speed: big * 2, drag: 2, max: [0.5, 1.2], size: [2, 5] });
          COLORS.forEach((color, i) => ring(cx, cy, big * 0.6, 26, color, i * 0.08));
        });
      },
      draw(t, dt) {
        const cx = W / 2, cy = H / 2, far = Math.hypot(W, H) * 0.6, min = Math.min(W, H);
        for (const f of run.flow) {
          const k = (t - f.at + 0.6) / 0.6;
          if (k <= 0 || k >= 1) continue;
          const dist = far * (1 - k ** 3);
          ctx.globalAlpha = 1;
          shape(ARROW, cx + Math.cos(f.a) * dist, cy + Math.sin(f.a) * dist, f.size, f.a - Math.PI / 2, f.color);
        }
        if (t < IMPACT) {
          const k = t / IMPACT;
          ctx.globalAlpha = clamp01(k * 3);
          shape(ARROW, cx, cy, min * 0.85 * k * k, 0, COLORS[Math.floor(t * 10) % 4]);
        } else if (t < IMPACT + 0.5) {
          const up = t - IMPACT;
          ctx.globalAlpha = 1;
          shape(ARROW, cx, cy - up * up * H * 9, min * 0.85, 0, "#fff");
        } else if (t < run.end - 1) {
          // послесвечение: стрелки взлетают снизу, от центра бьют штрихи
          emit(dt, 70, () => {
            if (Math.random() < 0.3) {
              add({ kind: "arrow", x: rand(0, W), y: H + 40, vx: 0, vy: -H * rand(0.7, 1.2), max: 1.7, size: rand(18, 44), color: pick(COLORS) });
            } else {
              const a = rand(0, TAU), sp = rand(500, 1100);
              add({ kind: "line", x: cx + Math.cos(a) * 60, y: cy + Math.sin(a) * 60, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 0.7, size: 2, color: pick(COLORS) });
            }
          });
        }
      },
    },

    // Искры по спирали стягиваются в ядро, оно сжимается в точку и взрывается лучами
    nova: {
      sky: "#0c0626",
      title: ["#fff6c9", "#ff9f1c"],
      pal: GOLD,
      rgb: ["255,226,122", "255,159,28"], // свет лучей: от центра к краю
      setup(cue) {
        run.stars = Array.from({ length: 130 }, () => ({ x: rand(0, W), y: rand(0, H), size: rand(0.6, 2), phase: rand(0, TAU) }));
        run.spiral = Array.from({ length: 260 }, () => ({
          a: rand(0, TAU), r: Math.max(W, H) * rand(0.3, 0.75), at: rand(0, IMPACT - 0.8), color: pick(run.show.pal),
        }));
        cue(IMPACT, () => {
          const cx = W / 2, cy = H / 2, big = Math.hypot(W, H);
          burst(cx, cy, 130, { kind: "star", colors: run.show.pal, speed: big * 1.3, drag: 1.5, max: [1.4, 2.8], size: [12, 36] });
          burst(cx, cy, 200, { kind: "line", colors: [...run.show.pal, "#fff"], speed: big * 2.2, drag: 2.2, max: [0.6, 1.5], size: [1.5, 4] });
          ring(cx, cy, big * 0.7, 70, run.show.pal[1]);
          ring(cx, cy, big * 0.5, 34, "#fff", 0.12);
          ring(cx, cy, big * 0.35, 18, run.show.pal[2], 0.26);
        });
      },
      draw(t, dt) {
        const cx = W / 2, cy = H / 2, min = Math.min(W, H);
        ctx.fillStyle = "#fff";
        for (const s of run.stars) {
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3 + s.phase);
          ctx.fillRect(s.x, s.y, s.size, s.size);
        }

        if (t < IMPACT) {
          for (const s of run.spiral) {
            const k = (t - s.at) / 0.8;
            if (k <= 0 || k >= 1) continue;
            const dist = s.r * (1 - k * k), ang = s.a + k * 4;
            ctx.globalAlpha = k;
            ctx.fillStyle = s.color;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, 1.5 + k * 2.5, 0, TAU);
            ctx.fill();
          }
          // ядро растёт, а перед самым ударом резко сжимается в точку
          const grow = clamp01(t / (IMPACT - 0.3)), fall = clamp01((IMPACT - t) / 0.3);
          const size = min * 0.3 * grow * grow * fall + 3;
          glow(cx, cy, size * 3, run.show.pal[2], 0.8);
          glow(cx, cy, size * 1.4, "#fff", 1);
          return;
        }

        // лучи вращаются навстречу друг другу
        const since = t - IMPACT, far = Math.hypot(W, H) * 0.7;
        const light = ctx.createRadialGradient(cx, cy, 0, cx, cy, far);
        light.addColorStop(0, `rgba(${run.show.rgb[0]},.9)`);
        light.addColorStop(0.5, `rgba(${run.show.rgb[1]},.28)`);
        light.addColorStop(1, `rgba(${run.show.rgb[1]},0)`);
        ctx.fillStyle = light;
        for (const [dir, rays, alpha] of [[1, 12, 0.55], [-1, 9, 0.35]]) {
          ctx.globalAlpha = clamp01(since / 0.25) * alpha;
          ctx.beginPath();
          for (let i = 0; i < rays; i++) {
            const a = dir * since * 0.3 + (i * TAU) / rays, half = 0.07 + 0.03 * Math.sin(i * 3 + t);
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a - half) * far, cy + Math.sin(a - half) * far);
            ctx.lineTo(cx + Math.cos(a + half) * far, cy + Math.sin(a + half) * far);
            ctx.closePath();
          }
          ctx.fill();
        }
        glow(cx, cy, min * (0.55 + 0.04 * Math.sin(t * 5)), run.show.pal[0], 0.55);

        if (t < run.end - 1) {
          emit(dt, 16, () => {
            const a = rand(0, TAU), sp = rand(40, 170), dist = rand(0.1, 0.5) * min;
            add({ kind: "star", x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vr: rand(-2, 2), max: rand(1.4, 2.4), size: rand(8, 22), color: pick(run.show.pal) });
          });
        }
      },
    },

    // Экран покрывается инеем, стекло трескается и разлетается осколками, за ним — метель и сияние
    frost: {
      sky: "#071a33",
      title: ["#ffffff", "#7fd6ff"],
      setup(cue) {
        const diag = Math.hypot(W, H);

        // узор инея ветвится от углов к центру
        run.ice = [];
        const grow = (x, y, ang, len, depth, t0) => {
          const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len, t1 = t0 + 0.17;
          run.ice.push({ x, y, x2, y2, t0, t1 });
          if (depth === 0) return;
          grow(x2, y2, ang + rand(0.3, 0.7), len * 0.78, depth - 1, t1);
          grow(x2, y2, ang - rand(0.3, 0.7), len * 0.78, depth - 1, t1);
        };
        for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
          const toCenter = Math.atan2(H / 2 - y, W / 2 - x);
          for (const off of [-0.55, 0, 0.55]) grow(x, y, toCenter + off, diag * 0.12, 5, rand(0.05, 0.2));
        }

        // трещины от центра перед самым ударом
        run.cracks = Array.from({ length: 16 }, (_, i) => {
          const a = (i * TAU) / 16 + rand(-0.12, 0.12);
          return Array.from({ length: 8 }, (_, j) => {
            const dist = (diag * 0.6 * (j + 1)) / 8, ang = a + rand(-0.09, 0.09);
            return [W / 2 + Math.cos(ang) * dist, H / 2 + Math.sin(ang) * dist];
          });
        });

        cue(IMPACT, () => {
          const cx = W / 2, cy = H / 2, reach = diag * 0.62;
          // экран разбивается на кольца осколков; чем дальше от центра, тем быстрее летят
          for (let ring_ = 0; ring_ < 4; ring_++) {
            const r0 = (reach * ring_) / 4, r1 = (reach * (ring_ + 1)) / 4, sectors = 10 + ring_ * 6;
            for (let i = 0; i < sectors; i++) {
              const a0 = (i * TAU) / sectors, a1 = ((i + 1) * TAU) / sectors, mid = (a0 + a1) / 2, r = (r0 + r1) / 2;
              const x = cx + Math.cos(mid) * r, y = cy + Math.sin(mid) * r;
              const corner = (dist, ang) => [cx + Math.cos(ang) * dist - x, cy + Math.sin(ang) * dist - y];
              const sp = rand(300, 800) * (1 + ring_ * 0.4);
              add({
                kind: "shard", x, y, pts: [corner(r0, a0), corner(r1, a0), corner(r1, a1), corner(r0, a1)],
                vx: Math.cos(mid) * sp, vy: Math.sin(mid) * sp, vr: rand(-3, 3),
                drag: 0.5, grav: 200, max: rand(1, 1.8), color: `rgba(170,225,255,${rand(0.12, 0.34)})`,
              });
            }
          }
          burst(cx, cy, 170, { kind: "dot", colors: ICE, speed: diag * 1.2, drag: 1.6, max: [0.8, 1.9], size: [1, 3.5] });
          ring(cx, cy, diag * 0.65, 44, "#9fe3ff");
          ring(cx, cy, diag * 0.45, 20, "#fff", 0.14);
        });
      },
      draw(t, dt) {
        const cx = W / 2, cy = H / 2, since = t - IMPACT;

        if (since < 0.15) {
          const fade = since < 0 ? 1 : 1 - since / 0.15;
          // холод подступает от краёв
          const veil = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.2, cx, cy, Math.hypot(W, H) * 0.55);
          veil.addColorStop(0, "rgba(120,210,255,0)");
          veil.addColorStop(1, "rgba(150,225,255,.5)");
          ctx.globalAlpha = clamp01(t / IMPACT) * fade;
          ctx.fillStyle = veil;
          ctx.fillRect(0, 0, W, H);

          ctx.beginPath();
          for (const s of run.ice) {
            const k = clamp01((t - s.t0) / (s.t1 - s.t0));
            if (k === 0) continue;
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s.x + (s.x2 - s.x) * k, s.y + (s.y2 - s.y) * k);
          }
          ctx.lineCap = "round";
          ctx.strokeStyle = "#8fdcff";
          ctx.globalAlpha = 0.3 * fade;
          ctx.lineWidth = 6;
          ctx.stroke();
          ctx.strokeStyle = "#ffffff";
          ctx.globalAlpha = 0.9 * fade;
          ctx.lineWidth = 1.6;
          ctx.stroke();

          const crack = clamp01((t - IMPACT + 0.4) / 0.4);
          if (crack > 0) {
            ctx.beginPath();
            for (const line of run.cracks) {
              ctx.moveTo(cx, cy);
              for (const [x, y] of line.slice(0, Math.ceil(crack * line.length))) ctx.lineTo(x, y);
            }
            ctx.globalAlpha = fade;
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }
        }
        if (since < 0) return;

        // полярное сияние за надписью
        const bands = [["rgba(60,230,190,.5)", 0.26, 1.1], ["rgba(70,150,255,.5)", 0.36, -0.8], ["rgba(150,110,255,.42)", 0.18, 0.6]];
        for (const [color, base, speed] of bands) {
          const g = ctx.createLinearGradient(0, H * base - 120, 0, H * base + 220);
          g.addColorStop(0, color);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.globalAlpha = clamp01(since / 0.6);
          ctx.beginPath();
          ctx.moveTo(0, H);
          for (let x = 0; x <= W + 24; x += 24) {
            ctx.lineTo(x, H * base + Math.sin(x * 0.006 + t * speed) * 70 + Math.sin(x * 0.015 - t * speed) * 26);
          }
          ctx.lineTo(W, H);
          ctx.closePath();
          ctx.fill();
        }

        if (t < run.end - 1) {
          emit(dt, 110, () => {
            add({ kind: "line", x: rand(-W * 0.3, W), y: -30, vx: rand(240, 620), vy: rand(560, 1000), max: 1.3, size: rand(1, 2.4), color: pick(ICE) });
            if (Math.random() < 0.08) add({ kind: "star", x: rand(0, W), y: rand(0, H), vx: 0, vy: 30, vr: 1, max: 0.9, size: rand(8, 20), color: "#fff" });
          });
        }
      },
    },

    // Ночной город: ракеты, на ударе — гигантский золотой шар, потом залпы и золотая ива
    finale: {
      sky: "#070a24",
      title: ["#ffffff", "#ff4f9a"],
      setup(cue) {
        const city = [];
        for (let x = -20; x < W + 20;) {
          const w = rand(36, 96);
          city.push({ x, w, h: H * rand(0.05, 0.17) });
          x += w;
        }
        run.city = city;

        const shell = (colors) => (p) => {
          const size = Math.min(W, H);
          burst(p.x, p.y, 110, { kind: "line", colors, speed: size * 0.75, drag: 1.8, grav: 130, max: [0.9, 1.6], size: [1.5, 3] });
          burst(p.x, p.y, 30, { kind: "dot", colors: ["#fff"], speed: size * 0.4, drag: 2, grav: 130, max: [0.5, 1], size: [1, 2.5] });
          ring(p.x, p.y, size * 0.25, 7, colors[0], 0, 0.5);
        };
        const rocket = (x, y, time, colors) => add({
          kind: "line", x, y: H, vx: rand(-20, 20), vy: (y - H) / time, max: time, size: 3, color: colors[0], die: shell(colors),
        });

        cue(0.05, () => rocket(W * 0.2, H * 0.36, 0.65, [COLORS[0], "#fff"]));
        cue(0.4, () => rocket(W * 0.8, H * 0.3, 0.65, [COLORS[2], "#fff"]));
        cue(0.75, () => add({ kind: "line", x: W / 2, y: H, vx: 0, vy: (H * 0.5 - H) / (IMPACT - 0.75), max: IMPACT - 0.75, size: 5, color: "#ffe27a" }));

        cue(IMPACT, () => {
          const cx = W / 2, cy = H / 2, big = Math.hypot(W, H);
          burst(cx, cy, 280, { kind: "line", colors: GOLD, speed: big * 1.15, drag: 1.7, grav: 150, max: [1.3, 2.3], size: [2, 4] });
          burst(cx, cy, 120, { kind: "line", colors: COLORS, speed: big * 0.7, drag: 1.9, grav: 150, max: [1, 1.8], size: [1.5, 3] });
          burst(cx, cy, 90, { kind: "dot", colors: ["#fff"], speed: big * 0.5, drag: 2.4, grav: 90, max: [0.6, 1.3], size: [1, 3] });
          ring(cx, cy, big * 0.55, 34, "#ffe27a");
          ring(cx, cy, big * 0.4, 16, "#ffffff", 0.12);
        });

        // залпы слева и справа от надписи
        for (let i = 0; i < 13; i++) {
          cue(IMPACT + 0.3 + i * 0.24, () => {
            const side = i % 2 ? rand(0.06, 0.34) : rand(0.66, 0.94);
            rocket(W * side, H * rand(0.12, 0.42), 0.4, [COLORS[i % 4], pick(GOLD), "#fff"]);
          });
        }
        // напоследок золотая ива: длинные струи медленно стекают вниз
        cue(IMPACT + 2.5, () => {
          for (const k of [0.18, 0.5, 0.82]) {
            burst(W * k, H * 0.2, 130, { kind: "line", colors: GOLD, speed: Math.min(W, H) * 0.6, drag: 2.4, grav: 240, max: [1.5, 2.2], size: [1.2, 2.4] });
          }
          run.flash = Math.max(run.flash, 0.3);
        });
      },
      draw() {
        ctx.globalAlpha = 1;
        const light = ctx.createLinearGradient(0, H * 0.45, 0, H);
        light.addColorStop(0, "rgba(120,60,200,0)");
        light.addColorStop(1, "rgba(255,110,120,.35)");
        ctx.fillStyle = light;
        ctx.fillRect(0, H * 0.45, W, H * 0.55);

        ctx.fillStyle = "#0b0720";
        for (const b of run.city) ctx.fillRect(b.x, H - b.h, b.w, b.h);
      },
    },
  };

  SHOWS.sapphire = { ...SHOWS.nova, sky: "#050b2e", title: ["#ffffff", "#4fa8ff"], pal: ["#4fa8ff", "#bfe4ff", "#2f6bff"], rgb: ["191,228,255", "47,107,255"] };
  SHOWS.redgiant = { ...SHOWS.nova, sky: "#1f0509", title: ["#ffe9d6", "#ff3b3b"], pal: ["#ff3b3b", "#ffb199", "#c8102e"], rgb: ["255,177,153", "200,16,46"] };

  // ---------- Надпись и персонаж ----------

  /** Перелив букв и размер шрифта, при котором надпись влезает на экран. */
  function titleLayout(r) {
    ctx.font = `900 100px ${FONT}`;
    const letters = [...r.title], widths = letters.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0);
    return { letters, widths, total, k: Math.min((W * 0.88) / total, (H * 0.2) / 100) };
  }

  /** Буквы влетают по одной: большие и прозрачные — на место, с лёгким отскоком. */
  function drawTitle(r, since) {
    const { letters, widths, total, k } = titleLayout(r);
    const size = 100 * k, y = H * 0.56;
    const fill = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
    fill.addColorStop(0, r.show.title[0]);
    fill.addColorStop(1, r.show.title[1]);

    ctx.font = `900 ${size}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    let x = W / 2 - (total * k) / 2;
    letters.forEach((letter, i) => {
      const w = widths[i] * k, step = clamp01((since - i * 0.06) / 0.32);
      if (step > 0) {
        ctx.save();
        ctx.globalAlpha = clamp01(step * 3);
        ctx.translate(x + w / 2, y + Math.sin(since * 3 + i * 0.7) * size * 0.025);
        const zoom = 1 + 1.7 * (1 - step) ** 3 - 0.12 * Math.sin(step * Math.PI);
        ctx.scale(zoom, zoom);
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = size * 0.17;
        ctx.strokeText(letter, 0, 0);
        ctx.fillStyle = fill;
        ctx.fillText(letter, 0, 0);
        ctx.restore();
      }
      x += w;
    });

    if (r.sub) {
      const sub = Math.max(16, size * 0.3);
      ctx.globalAlpha = clamp01((since - 0.55) / 0.3);
      ctx.font = `800 ${sub}px ${BODY_FONT}`;
      ctx.lineWidth = sub * 0.26;
      ctx.strokeText(r.sub, W / 2, y + size * 0.62 + sub * 0.6, W * 0.9);
      ctx.fillStyle = "#fff";
      ctx.fillText(r.sub, W / 2, y + size * 0.62 + sub * 0.6, W * 0.9);
    }
    return size;
  }

  /** Персонаж игрока выпрыгивает над надписью. */
  function drawHero(r, since, titleSize) {
    if (!r.hero) return;
    const step = clamp01((since - 0.1) / 0.45);
    if (step === 0) return;
    const size = Math.min(W, H) * 0.24 * (1 + 0.5 * Math.sin(step * Math.PI)) * easeOut(step);
    const y = Math.max(size / 2 + 8, H * 0.56 - titleSize * 0.7 - Math.min(W, H) * 0.15) + Math.sin(since * 2.4) * 6;
    ctx.globalAlpha = 1;
    ctx.drawImage(r.hero, W / 2 - size / 2, y - size / 2, size, size);
  }

  // ---------- Ход сцены ----------

  function frame(now) {
    const r = run;
    if (!r) return;
    const t = Math.max(0, (now - r.t0) / 1000);
    const dt = Math.min((now - r.last) / 1000, 0.05);
    r.last = now;
    r.t = t;
    if (t >= r.end) return finish();

    while (r.cues.length && r.cues[0].at <= t) r.cues.shift().fn();
    r.flash *= Math.exp(-dt * 3.2);
    r.shake *= Math.exp(-dt * 4.5);
    canvas.style.opacity = clamp01((r.end - t) / FADE);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // до удара сквозь затемнение ещё видно уровень
    ctx.globalAlpha = t < IMPACT ? 0.8 * clamp01(t / 0.5) : 0.8 + 0.16 * clamp01((t - IMPACT) / 0.2);
    ctx.fillStyle = r.show.sky;
    ctx.fillRect(0, 0, W, H);

    if (!reduce) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * r.shake * 46, (Math.random() - 0.5) * r.shake * 46);
      ctx.globalCompositeOperation = "lighter";
      r.show.draw(t, dt);
      drawRings(t);
      drawParts(dt);
      ctx.restore();
    }

    if (r.flash > 0.01) {
      ctx.globalAlpha = r.flash;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
    }

    const since = t - IMPACT;
    if (since >= 0) {
      ctx.save();
      ctx.font = `900 100px ${FONT}`;
      const size = drawTitle(r, since);
      drawHero(r, since, size);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }

  function finish() {
    const waiting = run.after;
    run = null;
    canvas.hidden = true;
    for (const fn of waiting) fn();
  }

  /**
   * Запускает сцену. kind — id скина победы.
   * @param o { title, sub — строка под надписью, hero — <canvas> с персонажем }
   */
  function play(kind, { title, sub, hero }) {
    if (run) return;
    resize();
    const now = performance.now();
    run = {
      show: SHOWS[kind] || SHOWS.rush,
      title, sub, hero,
      // при «уменьшить движение» сразу показываем готовую надпись
      t0: reduce ? now - (IMPACT + 1) * 1000 : now,
      end: reduce ? IMPACT + 1 + CALM_LENGTH : LENGTH,
      last: now, t: 0, flash: 0, shake: 0, parts: [], rings: [], cues: [], after: [],
    };
    if (!reduce) {
      const cue = (at, fn) => run.cues.push({ at, fn });
      cue(IMPACT, () => { run.flash = 1; run.shake = 1; });
      run.show.setup(cue);
      run.cues.sort((a, b) => a.at - b.at);
    }
    canvas.style.opacity = 1;
    canvas.hidden = false;
    music.fanfare(reduce ? 0.1 : IMPACT);
    requestAnimationFrame(frame);
  }

  /** Начинает растворять сцену раньше времени. */
  function skip() {
    if (run && run.t >= SKIP_AFTER) run.end = Math.min(run.end, run.t + FADE);
  }
  canvas.addEventListener("pointerdown", skip);
  addEventListener("keydown", (e) => {
    if (e.code === "Enter" || e.code === "Space" || e.code === "Escape") skip();
  });

  /** Выполнит fn, когда сцена закончится; если её нет — сразу. */
  function after(fn) {
    if (run) run.after.push(fn);
    else fn();
  }

  return { play, after };
})();
