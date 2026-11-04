"use strict";

// Картинки фона и эффекты частиц для триггеров «Картинка фона» и «Эффект фона».
// Всё рисуется кодом в пикселях экрана поверх неба, цвета берутся из текущей палитры мира (её меняют триггеры цвета).
// Ничего не хранится между кадрами: положение каждой детали считается из её номера, времени и камеры.
// view: { w, h, camX — камера в единицах мира, scale — пикселей на единицу, time }; pal: палитра, как у тем course.js.
const bgart = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TAU = Math.PI * 2;

  /** Картинки фона: [id, название]. */
  const BGS = [
    ["none", "Без картинки"],
    ["city", "Неоновый город"],
    ["mountains", "Горы"],
    ["forest", "Лес"],
    ["ocean", "Океан"],
    ["desert", "Пустыня"],
    ["synth", "Ретро-сетка"],
    ["clouds", "Облака"],
    ["crystals", "Кристаллы"],
    ["planets", "Планеты"],
    ["volcano", "Вулкан"],
    ["digital", "Цифровой дождь"],
    ["castle", "Замок"],
    ["aurora", "Северное сияние"],
  ];

  /** Эффекты частиц: [id, название]. */
  const EFFECTS = [
    ["none", "Без эффекта"],
    ["snow", "Снег"],
    ["rain", "Дождь"],
    ["embers", "Искры"],
    ["bubbles", "Пузыри"],
    ["leaves", "Листья"],
    ["meteors", "Метеоры"],
    ["confetti", "Конфетти"],
    ["fireflies", "Светлячки"],
  ];

  const rnd = (i, k) => (((Math.sin(i * 127.1 + k * 311.7) * 43758.5453) % 1) + 1) % 1;
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const BLACK = [0, 0, 0], WHITE = [255, 255, 255];

  /** Сдвиг слоя по горизонтали: дальние слои едут медленнее. Возвращает смещение в пикселях внутри повтора span. */
  const shift = (view, f, span) => ((((view.camX * view.scale * f) % span) + span) % span);

  /** Повторить рисунок слоя по ширине экрана: fn(x0) рисует один повтор шириной span начиная с x0. */
  function tiled(view, f, span, fn) {
    const off = shift(view, f, span);
    for (let x0 = -off; x0 < view.w; x0 += span) fn(x0);
  }

  function glowCircle(c, x, y, r, col, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, a));
    g.addColorStop(1, rgba(col, 0));
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /** Хребет: ломаная по сумме синусов, залитая до низа экрана. */
  function ridge(c, view, f, base, amp, seed, col) {
    const { w, h } = view;
    const off = view.camX * view.scale * f;
    c.beginPath();
    c.moveTo(0, h);
    for (let x = 0; x <= w + 20; x += 20) {
      const u = (x + off) / 260;
      const y = h * base - amp * h * (0.55 * Math.sin(u + seed) + 0.3 * Math.sin(u * 2.3 + seed * 2) + 0.15 * Math.sin(u * 5.1 + seed * 3));
      c.lineTo(x, y);
    }
    c.lineTo(w, h);
    c.closePath();
    c.fillStyle = col;
    c.fill();
  }

  const BG = {
    city(c, v, pal, t) {
      const { w, h } = v;
      glowCircle(c, w * 0.7, h * 0.5, h * 0.7, pal.glow, 0.18);
      for (const [f, top, col, lit] of [[0.05, 0.35, mix(pal.sky2, pal.neb, 0.35), 0.25], [0.12, 0.48, mix(pal.sky2, BLACK, 0.35), 0.6]]) {
        tiled(v, f, 1300, (x0) => {
          let x = x0, i = 0;
          while (x < x0 + 1300) {
            const bw = 50 + rnd(i, f * 10) * 90;
            const bh = h * (1 - top) * (0.35 + rnd(i, f * 20) * 0.65);
            const y = h - bh;
            c.fillStyle = rgba(col);
            c.fillRect(x, y, bw - 6, bh);
            if (rnd(i, 7) > 0.6) c.fillRect(x + bw * 0.4, y - 26, 3, 26); // антенна
            // окна: часть горит цветом свечения, часть мигает
            for (let wy = y + 12; wy < h - 8; wy += 16) {
              for (let wx = x + 8; wx < x + bw - 14; wx += 12) {
                const n = rnd(wx * 0.37 + i, wy * 0.11);
                if (n > lit) continue;
                const blink = reduce ? 1 : n < 0.04 ? 0.5 + Math.sin(t * 3 + wx) * 0.5 : 1;
                c.fillStyle = rgba(mix(pal.glow, WHITE, 0.2), 0.55 * blink);
                c.fillRect(wx, wy, 5, 7);
              }
            }
            x += bw;
            i++;
          }
        });
      }
    },

    mountains(c, v, pal) {
      const { w, h } = v;
      glowCircle(c, w * 0.3, h * 0.35, h * 0.25, pal.glow, 0.35);
      ridge(c, v, 0.03, 0.62, 0.22, 1, rgba(mix(pal.sky2, pal.neb, 0.45)));
      ridge(c, v, 0.07, 0.74, 0.18, 4, rgba(mix(pal.sky2, BLACK, 0.2)));
      ridge(c, v, 0.13, 0.86, 0.12, 9, rgba(mix(pal.sky2, BLACK, 0.5)));
    },

    forest(c, v, pal) {
      const { h } = v;
      ridge(c, v, 0.04, 0.78, 0.08, 2, rgba(mix(pal.sky2, pal.neb, 0.3)));
      for (const [f, base, size, col] of [[0.07, 0.8, 0.22, mix(pal.sky2, BLACK, 0.25)], [0.14, 0.92, 0.3, mix(pal.sky2, BLACK, 0.55)]]) {
        tiled(v, f, 900, (x0) => {
          for (let i = 0; i < 16; i++) {
            const x = x0 + i * 56 + rnd(i, f) * 30, th = h * size * (0.6 + rnd(i, f * 3) * 0.5), y = h * base;
            c.fillStyle = rgba(col);
            for (let k = 0; k < 3; k++) {
              const ty = y - th * (0.35 + k * 0.28), tw = th * (0.32 - k * 0.07);
              c.beginPath();
              c.moveTo(x - tw, ty + th * 0.35);
              c.lineTo(x, ty - th * 0.12);
              c.lineTo(x + tw, ty + th * 0.35);
              c.fill();
            }
            c.fillRect(x - 3, y - th * 0.1, 6, h);
          }
        });
        c.fillStyle = rgba(col);
        c.fillRect(0, h * base, v.w, h);
      }
    },

    ocean(c, v, pal, t) {
      const { w, h } = v;
      const sea = h * 0.62;
      glowCircle(c, w * 0.68, h * 0.3, h * 0.3, pal.glow, 0.4);
      c.beginPath();
      c.arc(w * 0.68, h * 0.3, h * 0.08, 0, TAU);
      c.fillStyle = rgba(mix(pal.glow, WHITE, 0.6));
      c.fill();
      const g = c.createLinearGradient(0, sea, 0, h);
      g.addColorStop(0, rgba(mix(pal.sky2, pal.neb2, 0.3)));
      g.addColorStop(1, rgba(mix(pal.sky2, BLACK, 0.5)));
      c.fillStyle = g;
      c.fillRect(0, sea, w, h - sea);
      // дорожка луны и волны
      for (let i = 0; i < 14; i++) {
        const y = sea + 6 + i * i * 2.2, ww = 30 + i * 9;
        c.fillStyle = rgba(pal.glow, 0.35 - i * 0.02);
        c.fillRect(w * 0.68 - ww / 2 + (reduce ? 0 : Math.sin(t * 2 + i) * 6), y, ww, 2 + i * 0.2);
      }
      c.strokeStyle = rgba(WHITE, 0.12);
      c.lineWidth = 2;
      for (let row = 0; row < 6; row++) {
        const y = sea + 18 + row * row * 9;
        c.beginPath();
        for (let x = 0; x <= w; x += 16) {
          const u = x + v.camX * v.scale * (0.05 + row * 0.03);
          c.lineTo(x, y + Math.sin(u / 40 + (reduce ? 0 : t * 1.5) + row) * (2 + row));
        }
        c.stroke();
      }
    },

    desert(c, v, pal) {
      const { w, h } = v;
      const sun = mix(pal.glow, [255, 190, 90], 0.5);
      glowCircle(c, w * 0.35, h * 0.42, h * 0.4, sun, 0.4);
      c.beginPath();
      c.arc(w * 0.35, h * 0.42, h * 0.14, 0, TAU);
      c.fillStyle = rgba(mix(sun, WHITE, 0.3));
      c.fill();
      ridge(c, v, 0.04, 0.72, 0.06, 3, rgba(mix(pal.wall, [210, 140, 80], 0.45)));
      ridge(c, v, 0.1, 0.84, 0.07, 7, rgba(mix(pal.wall, [150, 80, 50], 0.5)));
      tiled(v, 0.1, 1100, (x0) => {
        for (let i = 0; i < 3; i++) {
          const x = x0 + 150 + i * 360 + rnd(i, 4) * 120, y = h * 0.86, ch = 50 + rnd(i, 9) * 40;
          c.fillStyle = rgba(mix(pal.wall, BLACK, 0.45));
          c.fillRect(x - 6, y - ch, 12, ch);
          c.fillRect(x - 22, y - ch * 0.65, 8, ch * 0.3);
          c.fillRect(x - 22, y - ch * 0.65, 18, 7);
          c.fillRect(x + 14, y - ch * 0.8, 8, ch * 0.35);
          c.fillRect(x + 4, y - ch * 0.5, 18, 7);
        }
      });
    },

    synth(c, v, pal, t) {
      const { w, h } = v;
      const horizon = h * 0.6;
      // полосатое солнце
      const sx = w * 0.5, sy = horizon - h * 0.05, r = h * 0.22;
      const g = c.createLinearGradient(0, sy - r, 0, sy + r);
      g.addColorStop(0, rgba(mix(pal.glow, [255, 230, 120], 0.5)));
      g.addColorStop(1, rgba(mix(pal.neb2, [255, 60, 160], 0.5)));
      c.save();
      c.beginPath();
      c.arc(sx, sy, r, 0, TAU);
      c.clip();
      c.fillStyle = g;
      c.fillRect(sx - r, sy - r, r * 2, r * 2);
      c.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 6; i++) c.fillRect(sx - r, sy + r * (0.1 + i * 0.16), r * 2, 3 + i * 1.6);
      c.restore();
      c.fillStyle = rgba(mix(pal.sky2, BLACK, 0.55));
      c.fillRect(0, horizon, w, h - horizon);
      // сетка уходит к горизонту и едет вместе с миром
      c.strokeStyle = rgba(pal.glow, 0.55);
      c.lineWidth = 1.5;
      c.beginPath();
      const move = reduce ? 0 : (v.camX * v.scale * 0.004 + t * 0.4) % 1;
      for (let i = 0; i < 14; i++) {
        const k = (i + move) / 14, y = horizon + (h - horizon) * k * k;
        c.moveTo(0, y);
        c.lineTo(w, y);
      }
      const shiftX = shift(v, 0.3, 80);
      for (let i = -24; i <= 24; i++) {
        const x = sx + i * 80 - shiftX;
        c.moveTo(sx + (x - sx) * 0.08, horizon);
        c.lineTo(sx + (x - sx) * 3, h);
      }
      c.stroke();
    },

    clouds(c, v, pal, t) {
      const drift = reduce ? 0 : t * 12;
      for (const [f, y0, size, a] of [[0.03, 0.25, 0.08, 0.35], [0.07, 0.55, 0.12, 0.5], [0.12, 0.85, 0.16, 0.7]]) {
        const span = 1500;
        const off = (((v.camX * v.scale * f + drift * f * 10) % span) + span) % span;
        for (let x0 = -off - span; x0 < v.w + span; x0 += span) {
          for (let i = 0; i < 4; i++) {
            const cx = x0 + i * 380 + rnd(i, f * 7) * 160, cy = v.h * y0 + (rnd(i, f) - 0.5) * 60, r = v.h * size;
            c.fillStyle = rgba(mix(pal.neb, WHITE, 0.55), a);
            c.beginPath();
            for (const [dx, dy, k] of [[-1.1, 0.25, 0.65], [0, 0, 1], [1.1, 0.2, 0.7], [0.5, -0.4, 0.6], [-0.5, -0.3, 0.55]]) {
              c.moveTo(cx + dx * r + k * r, cy + dy * r);
              c.arc(cx + dx * r, cy + dy * r, k * r, 0, TAU);
            }
            c.fill();
          }
        }
      }
    },

    crystals(c, v, pal, t) {
      const { h } = v;
      for (const [f, base, size, a] of [[0.05, 0.82, 0.35, 0.45], [0.12, 0.96, 0.5, 0.8]]) {
        tiled(v, f, 1000, (x0) => {
          for (let i = 0; i < 9; i++) {
            const x = x0 + i * 115 + rnd(i, f) * 50, ch = h * size * (0.4 + rnd(i, f * 5) * 0.6), cw = ch * 0.22, y = h * base;
            const tilt = (rnd(i, f * 9) - 0.5) * 0.5;
            c.save();
            c.translate(x, y);
            c.rotate(tilt);
            const g = c.createLinearGradient(-cw, 0, cw, 0);
            g.addColorStop(0, rgba(mix(pal.glow, WHITE, 0.3), a));
            g.addColorStop(0.5, rgba(pal.neb2, a));
            g.addColorStop(1, rgba(mix(pal.sky2, BLACK, 0.2), a));
            c.beginPath();
            c.moveTo(-cw, 0);
            c.lineTo(-cw * 0.7, -ch * 0.8);
            c.lineTo(0, -ch);
            c.lineTo(cw * 0.7, -ch * 0.8);
            c.lineTo(cw, 0);
            c.fillStyle = g;
            c.fill();
            if (!reduce && f > 0.1) {
              c.fillStyle = rgba(WHITE, 0.25 + Math.sin(t * 2 + i) * 0.2);
              c.fillRect(-cw * 0.4, -ch * 0.75, cw * 0.15, ch * 0.55);
            }
            c.restore();
          }
        });
      }
    },

    planets(c, v, pal, t) {
      const { w, h } = v;
      const items = [[0.75, 0.32, 0.17, pal.neb2, true], [0.22, 0.6, 0.09, pal.glow, false], [0.5, 0.15, 0.04, mix(pal.neb, WHITE, 0.4), false]];
      items.forEach(([fx, fy, fr, col, ring], i) => {
        const x = (((w * fx - v.camX * v.scale * (0.01 + i * 0.006)) % (w * 1.4)) + w * 1.4) % (w * 1.4) - w * 0.2;
        const y = h * fy, r = h * fr;
        glowCircle(c, x, y, r * 1.8, col, 0.25);
        const g = c.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
        g.addColorStop(0, rgba(mix(col, WHITE, 0.4)));
        g.addColorStop(1, rgba(mix(col, BLACK, 0.55)));
        c.beginPath();
        c.arc(x, y, r, 0, TAU);
        c.fillStyle = g;
        c.fill();
        if (ring) {
          c.save();
          c.translate(x, y);
          c.rotate(-0.35 + (reduce ? 0 : Math.sin(t * 0.2) * 0.03));
          c.strokeStyle = rgba(mix(col, WHITE, 0.5), 0.7);
          c.lineWidth = r * 0.12;
          c.beginPath();
          c.ellipse(0, 0, r * 1.7, r * 0.42, 0, 0.05 * Math.PI, 0.95 * Math.PI, true);
          c.stroke();
          c.restore();
        }
      });
    },

    volcano(c, v, pal, t) {
      const { w, h } = v;
      const lava = [255, 110, 40];
      ridge(c, v, 0.03, 0.8, 0.07, 5, rgba(mix(pal.sky2, BLACK, 0.3)));
      tiled(v, 0.06, 1600, (x0) => {
        const x = x0 + 800, top = h * 0.38, base = h * 0.95;
        glowCircle(c, x, top, h * 0.35, lava, 0.35 + (reduce ? 0 : Math.sin(t * 1.3) * 0.08));
        c.beginPath();
        c.moveTo(x - h * 0.75, base);
        c.lineTo(x - h * 0.09, top);
        c.lineTo(x + h * 0.09, top);
        c.lineTo(x + h * 0.75, base);
        c.closePath();
        c.fillStyle = rgba(mix(pal.wall, BLACK, 0.55));
        c.fill();
        // потоки лавы
        c.strokeStyle = rgba(lava, 0.75);
        c.lineWidth = 4;
        c.beginPath();
        c.moveTo(x - h * 0.03, top + 2);
        c.quadraticCurveTo(x - h * 0.12, top + h * 0.25, x - h * 0.2, top + h * 0.45);
        c.moveTo(x + h * 0.04, top + 2);
        c.quadraticCurveTo(x + h * 0.1, top + h * 0.2, x + h * 0.26, top + h * 0.5);
        c.stroke();
        // пепел и искры над кратером
        if (!reduce) {
          for (let i = 0; i < 18; i++) {
            const p = (t * 0.25 + rnd(i, 3)) % 1;
            c.fillStyle = rgba(i % 3 ? [90, 80, 90] : lava, 0.7 * (1 - p));
            c.fillRect(x + (rnd(i, 5) - 0.5) * 140 * p, top - p * h * 0.35, 4, 4);
          }
        }
      });
    },

    digital(c, v, pal, t) {
      const { w, h } = v;
      const glyphs = "01<>{}[]/\\=+*#АРКИ";
      c.font = "700 16px ui-monospace, Consolas, monospace";
      c.textAlign = "center";
      const off = shift(v, 0.05, 28);
      for (let col = 0; col * 28 - off < w + 28; col++) {
        const x = col * 28 - off, n = col + Math.floor(v.camX * v.scale * 0.05 / 28);
        const speed = 60 + rnd(n, 1) * 120, len = 8 + Math.floor(rnd(n, 2) * 14);
        const head = ((reduce ? rnd(n, 3) * h : t * speed + rnd(n, 3) * h * 2) % (h + len * 18));
        for (let k = 0; k < len; k++) {
          const y = head - k * 18;
          if (y < -18 || y > h) continue;
          const ch = glyphs[Math.floor(rnd(n * 13 + k, Math.floor(t * 4) * 0.1) * glyphs.length)];
          c.fillStyle = k === 0 ? rgba(mix(pal.glow, WHITE, 0.6), 0.9) : rgba(pal.glow, 0.55 * (1 - k / len));
          c.fillText(ch, x, y);
        }
      }
    },

    castle(c, v, pal, t) {
      const { w, h } = v;
      glowCircle(c, w * 0.78, h * 0.22, h * 0.22, pal.glow, 0.4);
      c.beginPath();
      c.arc(w * 0.78, h * 0.22, h * 0.07, 0, TAU);
      c.fillStyle = rgba(mix(pal.glow, WHITE, 0.6));
      c.fill();
      ridge(c, v, 0.04, 0.82, 0.08, 6, rgba(mix(pal.sky2, BLACK, 0.3)));
      tiled(v, 0.07, 1500, (x0) => {
        const x = x0 + 600, base = h * 0.84, col = rgba(mix(pal.sky2, BLACK, 0.55));
        c.fillStyle = col;
        const block = (bx, bw, bh) => {
          c.fillRect(bx, base - bh, bw, bh);
          for (let k = 0; k < bw; k += 16) c.fillRect(bx + k, base - bh - 10, 9, 10); // зубцы
        };
        block(x - 160, 320, h * 0.22);
        for (const [tx, th] of [[-200, 0.4], [170, 0.36], [-40, 0.52]]) {
          block(x + tx, 60, h * th);
          c.beginPath();
          c.moveTo(x + tx - 6, base - h * th - 10);
          c.lineTo(x + tx + 30, base - h * th - 70);
          c.lineTo(x + tx + 66, base - h * th - 10);
          c.fill();
        }
        c.fillStyle = rgba(mix(pal.glow, [255, 200, 90], 0.5), reduce ? 0.8 : 0.6 + Math.sin(t * 4) * 0.2);
        for (const [wx, wy] of [[-180, 0.3], [-20, 0.42], [190, 0.27], [-90, 0.12], [60, 0.12]]) c.fillRect(x + wx, base - h * wy, 10, 16);
      });
    },

    aurora(c, v, pal, t) {
      const { w, h } = v;
      c.save();
      c.globalCompositeOperation = "lighter";
      for (let band = 0; band < 3; band++) {
        const col = [pal.glow, pal.neb2, [90, 255, 170]][band];
        const off = v.camX * v.scale * (0.02 + band * 0.01);
        for (let x = 0; x < w; x += 6) {
          const u = (x + off) / 180;
          const y = h * (0.22 + band * 0.1) + Math.sin(u + (reduce ? 0 : t * 0.4) + band) * h * 0.06 + Math.sin(u * 2.7 + band) * h * 0.03;
          const len = h * (0.18 + 0.1 * Math.sin(u * 1.3 + band * 2));
          const g = c.createLinearGradient(0, y, 0, y + len);
          g.addColorStop(0, rgba(col, 0));
          g.addColorStop(0.3, rgba(col, 0.16));
          g.addColorStop(1, rgba(col, 0));
          c.fillStyle = g;
          c.fillRect(x, y, 6, len);
        }
      }
      c.restore();
      ridge(c, v, 0.06, 0.9, 0.08, 8, rgba(mix(pal.sky2, BLACK, 0.55)));
    },
  };

  /** Картинка фона id поверх неба; alpha — для плавной смены одной картинки на другую. */
  function draw(c, id, view, pal, alpha = 1) {
    const fn = BG[id];
    if (!fn || alpha <= 0.01) return;
    c.save();
    c.globalAlpha *= alpha;
    fn(c, view, pal, view.time);
    c.restore();
  }

  /** Частицы эффекта поверх мира, в пикселях экрана. */
  function effect(c, id, view, pal, alpha = 1) {
    if (!id || id === "none" || alpha <= 0.01) return;
    const { w, h, time: t } = view;
    const cam = view.camX * view.scale;
    const T = reduce ? 0 : t;
    c.save();
    c.globalAlpha *= alpha;
    const count = { snow: 90, rain: 120, embers: 60, bubbles: 40, leaves: 30, meteors: 6, confetti: 70, fireflies: 35 }[id] || 0;
    for (let i = 0; i < count; i++) {
      const a = rnd(i, 1), b = rnd(i, 2), sp = rnd(i, 3);
      const wrapX = (x) => ((x % (w + 40)) + w + 40) % (w + 40) - 20;
      const wrapY = (y) => ((y % (h + 40)) + h + 40) % (h + 40) - 20;
      switch (id) {
        case "snow": {
          const x = wrapX(a * w - cam * (0.3 + sp * 0.4) + Math.sin(T + i) * 20), y = wrapY(b * h + T * (30 + sp * 50));
          c.fillStyle = rgba(WHITE, 0.5 + sp * 0.4);
          c.beginPath();
          c.arc(x, y, 1.5 + sp * 2.5, 0, TAU);
          c.fill();
          break;
        }
        case "rain": {
          const x = wrapX(a * w - cam * 0.6 - T * 200), y = wrapY(b * h + T * (700 + sp * 300));
          c.strokeStyle = rgba(mix(pal.glow, WHITE, 0.5), 0.35);
          c.lineWidth = 1.5;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x - 6, y + 18 + sp * 10);
          c.stroke();
          break;
        }
        case "embers": {
          const x = wrapX(a * w - cam * 0.5 + Math.sin(T * 2 + i) * 15), y = wrapY(b * h - T * (40 + sp * 80));
          c.fillStyle = rgba(sp > 0.5 ? [255, 180, 80] : [255, 90, 40], 0.5 + Math.sin(T * 5 + i) * 0.3);
          c.fillRect(x, y, 2 + sp * 3, 2 + sp * 3);
          break;
        }
        case "bubbles": {
          const x = wrapX(a * w - cam * 0.4 + Math.sin(T * 1.5 + i) * 12), y = wrapY(b * h - T * (25 + sp * 40));
          c.strokeStyle = rgba(mix(pal.glow, WHITE, 0.6), 0.55);
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(x, y, 4 + sp * 9, 0, TAU);
          c.stroke();
          c.fillStyle = rgba(WHITE, 0.5);
          c.fillRect(x - 2 - sp * 3, y - 2 - sp * 3, 2, 2);
          break;
        }
        case "leaves": {
          const x = wrapX(a * w - cam * 0.5 - T * 30 + Math.sin(T + i) * 30), y = wrapY(b * h + T * (35 + sp * 30));
          c.save();
          c.translate(x, y);
          c.rotate(T * (1 + sp) + i);
          c.fillStyle = rgba([[230, 120, 40], [200, 60, 50], [240, 190, 60], [120, 180, 60]][i % 4], 0.85);
          c.beginPath();
          c.ellipse(0, 0, 7 + sp * 4, 3.5, 0, 0, TAU);
          c.fill();
          c.restore();
          break;
        }
        case "meteors": {
          const p = ((T * (0.25 + sp * 0.2) + a) % 1.6) / 1.6;
          if (p > 0.6) break;
          const x = w * (0.3 + b * 0.9) - p * w * 0.9, y = h * (b * 0.4) + p * h * 0.6;
          const g = c.createLinearGradient(x, y, x + 120, y - 80);
          g.addColorStop(0, rgba(WHITE, 0.9));
          g.addColorStop(1, rgba(pal.glow, 0));
          c.strokeStyle = g;
          c.lineWidth = 3;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + 120, y - 80);
          c.stroke();
          break;
        }
        case "confetti": {
          const x = wrapX(a * w - cam * 0.5 + Math.sin(T * 2 + i) * 20), y = wrapY(b * h + T * (60 + sp * 60));
          c.save();
          c.translate(x, y);
          c.rotate(T * 3 + i);
          c.fillStyle = rgba([[255, 79, 154], [255, 179, 31], [34, 199, 240], [126, 224, 58], [139, 92, 255]][i % 5], 0.9);
          c.fillRect(-4, -2, 8, 4);
          c.restore();
          break;
        }
        case "fireflies": {
          const x = wrapX(a * w - cam * 0.35 + Math.sin(T * 0.7 + i * 3) * 40), y = h * (0.3 + b * 0.65) + Math.cos(T * 0.9 + i) * 25;
          const k = 0.4 + Math.sin(T * 3 + i * 2) * 0.4;
          glowCircle(c, x, y, 14, [230, 255, 120], 0.35 * k + 0.1);
          c.fillStyle = rgba([240, 255, 170], k + 0.2);
          c.fillRect(x - 1.5, y - 1.5, 3, 3);
          break;
        }
      }
    }
    c.restore();
  }

  /** Затемнение по краям (триггер «Затемнение»): amount 0…1. */
  function darken(c, w, h, amount) {
    if (amount <= 0.01) return;
    const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, `rgba(0,0,0,${amount * 0.35})`);
    g.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, amount)})`);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  /** Крупная надпись по центру сверху (триггер «Надпись»). */
  function message(c, w, h, text, alpha) {
    if (!text || alpha <= 0.01) return;
    c.save();
    c.globalAlpha = alpha;
    c.font = `900 ${Math.round(Math.min(48, w / Math.max(6, text.length * 0.75)))}px Unbounded, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    c.lineWidth = 8;
    c.strokeStyle = "#1d1340";
    c.strokeText(text, w / 2, h * 0.22);
    c.fillStyle = "#fff";
    c.fillText(text, w / 2, h * 0.22);
    c.restore();
  }

  return { BGS, EFFECTS, draw, effect, darken, message };
})();
