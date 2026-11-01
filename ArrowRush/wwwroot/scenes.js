"use strict";

// Особые стили уровня: сцены, которые course.js может выбрать на весь матч вместо космоса со стенами.
// Всё нарисовано кодом. Неподвижное рисуется один раз в отдельный холст и едет слоями
// с разной скоростью, живое (свет, волны, руки) — каждый кадр.
// У сцены три части: back — фон, world — предметы в координатах мира (под траекторией),
// front — то, что закрывает траекторию снизу и сверху.
// view: { w, h, camX, camY, scale, time, beat, heat }.
const scenes = (() => {
  const VIEW_H = 720;
  const TAU = Math.PI * 2;

  // палитры для порталов, колец и искр; ключи те же, что у тем в course.js
  const palettes = {
    lighthouse: { sky: [200, 19, 60], sky2: [255, 46, 74], neb: [255, 90, 60], neb2: [200, 20, 60], wall: [125, 15, 52], wall2: [255, 120, 80], glow: [255, 214, 196] },
    abyss: { sky: [155, 0, 0], sky2: [58, 0, 0], neb: [255, 40, 20], neb2: [10, 10, 230], wall: [2, 2, 142], wall2: [80, 200, 255], glow: [120, 215, 255] },
    horror: { sky: [28, 10, 6], sky2: [10, 4, 2], neb: [190, 110, 50], neb2: [150, 20, 30], wall: [50, 24, 14], wall2: [255, 30, 60], glow: [255, 60, 80] },
  };

  // ---------- Слои ----------

  const cache = new Map();
  let cacheH = 0;

  /** Холст слоя шириной W единиц; рисуется один раз на высоту экрана. */
  function layer(key, W, h, paint) {
    if (h !== cacheH) { cache.clear(); cacheH = h; }
    let img = cache.get(key);
    if (!img) {
      const k = Math.min(1.25, (h * (devicePixelRatio || 1)) / VIEW_H);
      img = document.createElement("canvas");
      img.width = Math.ceil(W * k);
      img.height = Math.ceil(VIEW_H * k);
      const c = img.getContext("2d");
      c.scale(k, k);
      paint(c, W, seeded(key.length * 7919 + 13));
      cache.set(key, img);
    }
    return img;
  }

  /** Слой повторяется по горизонтали; parallax — его скорость относительно мира. */
  function tile(ctx, img, W, v, parallax, each) {
    const tw = W * v.scale;
    let x = -((((v.camX * parallax * v.scale) % tw) + tw) % tw);
    for (; x < v.w; x += tw) {
      ctx.drawImage(img, x, 0, tw + 1, v.h);
      if (each) each(x);
    }
  }

  function seeded(seed) {
    return () => {
      seed = (seed * 16807) % 2147483647;
      return (seed & 0xffffff) / 0x1000000;
    };
  }

  /** Точки кривой Безье. */
  function bezier(a, b, c, d, n = 40) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([
        u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
        u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
      ]);
    }
    return pts;
  }

  /** Сужающаяся лента с рваным краем: щупальца и корни. */
  function tentacle(c, pts, width, color, rand) {
    c.fillStyle = color;
    c.strokeStyle = color;
    c.lineCap = "round";
    for (let i = 1; i < pts.length; i++) {
      const k = i / pts.length;
      const w = width * (1 - k * 0.74);
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(bx, by);
      c.stroke();
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      for (let j = 0; j < 3; j++) {
        const side = rand() < 0.5 ? -1 : 1;
        const nx = (-dy / len) * side, ny = (dx / len) * side;
        const t = rand(), x = ax + dx * t, y = ay + dy * t, h = w / 2 + 6 + rand() * 18;
        c.beginPath();
        c.moveTo(x - dx * 0.1, y - dy * 0.1);
        c.lineTo(x + nx * h, y + ny * h);
        c.lineTo(x + dx * 0.1, y + dy * 0.1);
        c.fill();
      }
    }
  }

  // ---------- Маяк ----------

  function paintClouds(c, W, rand) {
    const shades = ["#a50f2c", "#d3222d", "#f5492c", "#ff7a45"];
    for (const [cx, cy, s] of [[640, 300, 0.8], [1520, 190, 1.2], [2300, 330, 0.9]]) {
      shades.forEach((shade, j) => {
        c.fillStyle = shade;
        for (let i = 0; i < 30; i++) {
          const x = cx + (rand() - 0.5) * 540 * s - j * 18;
          const y = cy + (rand() - 0.5) * 210 * s - j * 14;
          const r = (46 + rand() * 88) * s * (1 - j * 0.2);
          c.beginPath();
          c.arc(x, y, r, 0, TAU);
          c.fill();
          // рваный блочный край, как в цифровой картинке
          if (i % 3 === 0) {
            const bx = Math.round((x + r * 0.6) / 18) * 18, by = Math.round((y + r * 0.4) / 18) * 18;
            c.fillRect(bx, by, 36 + rand() * 90, 18);
          }
        }
      });
    }
    c.fillStyle = "rgba(122,12,44,.6)";
    for (let i = 0; i < 16; i++) {
      c.beginPath();
      c.ellipse(320 + rand() * 2200, 80 + rand() * 340, 60 + rand() * 170, 5 + rand() * 11, 0, 0, TAU);
      c.fill();
    }
  }

  function paintShore(c, W, rand) {
    const wave = (x) => 556 + 22 * Math.sin((TAU * x * 2) / W) + 12 * Math.sin((TAU * x * 5) / W);
    c.fillStyle = "#8e1132";
    c.beginPath();
    c.moveTo(0, 620);
    for (let x = 0; x <= W; x += 16) c.lineTo(x, wave(x));
    c.lineTo(W, 620);
    c.fill();
    for (let x = 40; x < W - 40; x += 26 + rand() * 90) {
      const y = wave(x) + 4, h = 30 + rand() * 42;
      c.fillStyle = "#6e0c2c";
      for (let t = 0; t < 3; t++) {
        c.beginPath();
        c.moveTo(x, y - h + t * h * 0.28);
        c.lineTo(x - h * 0.26 - t * 3, y - h * 0.44 + t * h * 0.28);
        c.lineTo(x + h * 0.26 + t * 3, y - h * 0.44 + t * h * 0.28);
        c.fill();
      }
      if (rand() < 0.1) {
        c.fillStyle = "#5c0a28";
        c.fillRect(x + 20, y - 14, 34, 18);
        c.fillStyle = "#ffb13b";
        c.fillRect(x + 26, y - 9, 6, 6);
        c.fillRect(x + 40, y - 9, 6, 6);
      }
    }
  }

  const LAMP = [560, 150];

  function paintIsland(c) {
    c.fillStyle = "#7d0f34";
    c.beginPath();
    c.moveTo(250, 610);
    for (const [x, y] of [[330, 580], [400, 572], [400, 548], [450, 548], [450, 520], [500, 520], [510, 500], [620, 500], [640, 530], [690, 540], [720, 580], [800, 610], [880, 622]]) c.lineTo(x, y);
    c.lineTo(250, 622);
    c.fill();
    c.fillStyle = "#971539";
    c.fillRect(420, 556, 22, 40);
    c.fillRect(466, 528, 18, 26);

    const body = c.createLinearGradient(520, 0, 610, 0);
    body.addColorStop(0, "#e23a56");
    body.addColorStop(0.55, "#a21a40");
    body.addColorStop(1, "#6f0f33");
    c.fillStyle = body;
    c.beginPath();
    c.moveTo(516, 505);
    c.lineTo(606, 505);
    c.lineTo(586, 198);
    c.lineTo(534, 198);
    c.fill();
    c.fillStyle = "rgba(60,8,40,.5)";
    for (const y of [270, 355, 440]) c.fillRect(523 + (y - 198) * -0.03, y, 80 - (505 - y) * -0.03, 8);
    c.fillRect(556, 300, 11, 26);
    c.fillRect(554, 385, 13, 28);

    c.fillStyle = "#5e0d30";
    c.fillRect(522, 186, 78, 14);
    c.fillRect(534, 122, 54, 66);
    c.fillStyle = "#ffe0ec";
    c.fillRect(540, 128, 42, 54);
    c.fillStyle = "#5e0d30";
    c.fillRect(558, 128, 5, 54);
    c.fillStyle = "#47082c";
    c.beginPath();
    c.moveTo(528, 124);
    c.lineTo(561, 88);
    c.lineTo(594, 124);
    c.fill();

    // растяжки и флажки
    c.strokeStyle = "#5e0d30";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(586, 210);
    c.lineTo(520, 480);
    c.moveTo(450, 530);
    c.lineTo(300, 610);
    c.stroke();
    c.fillStyle = "#5e0d30";
    for (let i = 0; i < 4; i++) {
      const x = 330 + i * 28, y = 594 - i * 15;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + 14, y - 7);
      c.lineTo(x + 10, y + 12);
      c.fill();
    }
  }

  function paintNear(c, W, rand) {
    const dark = "#2b0a2e";
    c.fillStyle = dark;
    c.beginPath();
    c.moveTo(0, 720);
    for (let x = 0; x <= W; x += 12) c.lineTo(x, 672 + 12 * Math.sin((TAU * x * 3) / W) + 5 * Math.sin((TAU * x * 8) / W));
    c.lineTo(W, 720);
    c.fill();

    // причал
    c.fillStyle = "#3d1038";
    c.beginPath();
    c.moveTo(520, 720);
    c.lineTo(760, 620);
    c.lineTo(1230, 620);
    c.lineTo(1420, 720);
    c.fill();
    c.strokeStyle = dark;
    c.lineWidth = 3;
    for (let i = 1; i < 6; i++) {
      const y = 620 + i * i * 3.8, k = (y - 620) / 100;
      c.beginPath();
      c.moveTo(760 - 240 * k, y);
      c.lineTo(1230 + 190 * k, y);
      c.stroke();
    }
    c.fillStyle = dark;
    for (const [x, y, w] of [[720, 590, 38], [1250, 590, 38], [1680, 560, 70], [190, 610, 34]]) {
      c.fillRect(x, y, w, 140);
      c.beginPath();
      c.ellipse(x + w / 2, y, w / 2, 8, 0, 0, TAU);
      c.fill();
    }
    // тростник
    c.strokeStyle = dark;
    c.lineCap = "round";
    for (let i = 0; i < 26; i++) {
      const x = 40 + rand() * (W - 160), lean = (rand() < 0.5 ? -1 : 1) * (40 + rand() * 90), h = 70 + rand() * 96;
      c.lineWidth = 3 + rand() * 4;
      c.beginPath();
      c.moveTo(x, 716);
      c.quadraticCurveTo(x + lean * 0.1, 716 - h, x + lean, 716 - h * 0.82);
      c.stroke();
    }
  }

  function backLighthouse(ctx, v) {
    const { w, h, scale, time, beat } = v;
    let g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#6d0d2c");
    g.addColorStop(0.28, "#c8133c");
    g.addColorStop(0.76, "#ff2e4a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // солнце с бликом
    const sx = w * 0.68, sy = h * 0.27;
    ctx.globalCompositeOperation = "lighter";
    g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 300 * scale);
    g.addColorStop(0, `rgba(255,120,120,${0.5 + beat * 0.2})`);
    g.addColorStop(1, "rgba(255,40,70,0)");
    ctx.fillStyle = g;
    ctx.fillRect(sx - 300 * scale, sy - 300 * scale, 600 * scale, 600 * scale);
    ctx.fillStyle = "rgba(255,200,205,.5)";
    ctx.beginPath();
    ctx.arc(sx, sy, 36 * scale, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255,190,190,.7)";
    ctx.fillRect(sx - 230 * scale, sy - 1.5, 460 * scale, 3);
    ctx.globalCompositeOperation = "source-over";

    tile(ctx, layer("clouds", 2800, h, paintClouds), 2800, v, 0.05);
    tile(ctx, layer("shore", 2400, h, paintShore), 2400, v, 0.1);

    // море с бегущими бликами
    const sea = h * 0.79;
    g = ctx.createLinearGradient(0, sea, 0, h);
    g.addColorStop(0, "#d9163c");
    g.addColorStop(1, "#5c0c30");
    ctx.fillStyle = g;
    ctx.fillRect(0, sea, w, h - sea);
    ctx.fillStyle = "rgba(255,150,140,.32)";
    for (let i = 0; i < 26; i++) {
      const y = sea + ((i * 37) % 100) / 100 * (h - sea);
      const len = (40 + (i * 53) % 130) * scale;
      const x = (((i * 211 - v.camX * 0.12) * scale + Math.sin(time + i) * 18) % (w + len) + w + len) % (w + len) - len;
      ctx.fillRect(x, y, len, 2);
    }

    tile(ctx, layer("island", 2000, h, paintIsland), 2000, v, 0.2, (x) => {
      const lx = x + LAMP[0] * scale, ly = LAMP[1] * scale;
      if (lx < -900 * scale || lx > w + 900 * scale) return;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, 120 * scale);
      glow.addColorStop(0, `rgba(255,225,240,${0.8 + beat * 0.2})`);
      glow.addColorStop(1, "rgba(255,120,160,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(lx - 120 * scale, ly - 120 * scale, 240 * scale, 240 * scale);
      // луч маяка ходит над водой
      ctx.translate(lx, ly);
      ctx.rotate(Math.PI + Math.sin(time * 0.6) * 0.14);
      const len = 820 * scale;
      const beam = ctx.createLinearGradient(0, 0, len, 0);
      beam.addColorStop(0, "rgba(255,220,235,.6)");
      beam.addColorStop(1, "rgba(255,160,190,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(0, -14 * scale);
      ctx.lineTo(len, -42 * scale);
      ctx.lineTo(len, 42 * scale);
      ctx.lineTo(0, 14 * scale);
      ctx.fill();
      ctx.restore();
    });
  }

  function frontLighthouse(ctx, v) {
    tile(ctx, layer("near", 2200, v.h, paintNear), 2200, v, 0.8);
  }

  // ---------- Красно-синий мир ----------

  const BLUE = "#0a0ae6", DEEP = "#02028e";

  /** Ветви, свисающие сверху. */
  function branch(c, x, y, angle, len, width, rand, depth = 0) {
    const ex = x + Math.cos(angle) * len, ey = y + Math.sin(angle) * len;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + (rand() - 0.5) * len * 0.5, (y + ey) / 2, ex, ey);
    c.stroke();
    if (depth > 3 || width < 2) return;
    for (let i = 0; i < 2; i++) branch(c, ex, ey, angle + (rand() - 0.5) * 1.3, len * 0.72, width * 0.62, rand, depth + 1);
  }

  function paintAbyss(c, W, rand) {
    // щупальца; края слоя сходятся на высоте 640
    tentacle(c, bezier([0, 640], [340, 640], [640, 470], [980, 300]), 70, DEEP, rand);
    tentacle(c, bezier([980, 300], [1120, 230], [1120, 96], [930, 130]), 26, DEEP, rand);
    tentacle(c, bezier([930, 130], [850, 150], [850, 215], [920, 205], 18), 10, DEEP, rand);
    tentacle(c, bezier([W, 640], [W - 300, 640], [W - 360, 400], [W - 640, 470]), 62, DEEP, rand);
    tentacle(c, bezier([W - 640, 470], [W - 780, 505], [W - 790, 300], [W - 650, 240]), 26, DEEP, rand);

    // гриб
    const mx = 1400;
    c.fillStyle = BLUE;
    c.beginPath();
    c.moveTo(mx - 90, 720);
    c.bezierCurveTo(mx - 60, 600, mx - 74, 480, mx - 60, 370);
    c.lineTo(mx + 60, 370);
    c.bezierCurveTo(mx + 74, 480, mx + 70, 600, mx + 110, 720);
    c.fill();
    c.fillStyle = DEEP;
    c.beginPath();
    c.ellipse(mx, 340, 340, 136, -0.05, 0, TAU);
    c.fill();
    tentacle(c, bezier([mx + 300, 330], [mx + 460, 300], [mx + 500, 180], [mx + 420, 90]), 30, DEEP, rand);
    tentacle(c, bezier([mx - 300, 350], [mx - 440, 390], [mx - 520, 470], [mx - 600, 410]), 26, DEEP, rand);
    c.strokeStyle = "#35c8ff";
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(mx, 340, 248, 86, -0.05, 0, TAU);
    c.stroke();
    c.strokeStyle = "rgba(2,2,142,.7)";
    c.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      c.beginPath();
      c.moveTo(mx - 44 + i * 15, 390);
      c.lineTo(mx - 50 + i * 17, 610);
      c.stroke();
    }

    // сверху свисают ветви
    c.strokeStyle = BLUE;
    c.lineCap = "round";
    for (const x of [420, 1160, 1760, 2240]) branch(c, x, -10, Math.PI / 2 + (rand() - 0.5) * 0.5, 120, 26, rand);

    // чёрные нити
    c.fillStyle = "#000";
    for (const x of [1560, 1620, 2100]) c.fillRect(x, 0, 4, 560);
  }

  function backAbyss(ctx, v) {
    const { w, h, scale, time, beat } = v;
    const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, w * 0.68);
    g.addColorStop(0, `rgb(${170 + beat * 60},0,0)`);
    g.addColorStop(1, "#320000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    tile(ctx, layer("abyss", 2600, h, paintAbyss), 2600, v, 0.18);

    // земля: синяя с чёрными волнами, которые текут
    const gy = h * 0.8;
    ctx.fillStyle = BLUE;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 24; x += 24) ctx.lineTo(x, gy + Math.sin(x * 0.012 + v.camX * 0.002) * 7 * scale);
    ctx.lineTo(w, h);
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineCap = "round";
    const flow = v.camX * 0.0016 + time * 0.5;
    for (let j = 0; j < 6; j++) {
      const k = (j + 1) / 6;
      ctx.lineWidth = (3 + k * k * 24 + beat * 3) * scale;
      ctx.setLineDash([(240 + j * 90) * scale, (130 + j * 40) * scale]);
      ctx.lineDashOffset = v.camX * (0.2 + k * 0.5) * scale;
      ctx.beginPath();
      const base = gy + (h - gy) * (0.1 + k * k * 0.92);
      for (let x = -30; x <= w + 30; x += 18) {
        ctx.lineTo(x, base + Math.sin(x * (0.0085 / scale) * (1.2 - k * 0.6) + flow + j * 1.7) * (8 + k * 24) * scale);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ---------- Хоррор ----------

  function paintCurtain(c, W, rand) {
    for (let x = 0; x < W; x += 5) {
      const fold = 0.5 + 0.5 * Math.sin((TAU * x * 11) / W) * Math.sin((TAU * x * 4) / W + 1);
      c.fillStyle = `rgb(${24 + fold * 96},${10 + fold * 42},${5 + fold * 15})`;
      c.fillRect(x, 0, 6, VIEW_H);
    }
    // корявые сучья
    c.lineCap = "round";
    for (let i = 0; i < 24; i++) {
      const x = 120 + rand() * (W - 240), up = rand() < 0.5;
      c.strokeStyle = rand() < 0.5 ? "rgba(150,100,60,.6)" : "rgba(16,6,3,.8)";
      c.lineWidth = 2 + rand() * 5;
      c.beginPath();
      c.moveTo(x, up ? -6 : 726);
      c.bezierCurveTo(x + (rand() - 0.5) * 230, up ? 110 : 610, x + (rand() - 0.5) * 230, up ? 190 : 530, x + (rand() - 0.5) * 160, up ? 150 + rand() * 90 : 570 - rand() * 90);
      c.stroke();
    }
  }

  function backHorror(ctx, v) {
    const { w, h, beat } = v;
    tile(ctx, layer("curtain", 1500, h, paintCurtain), 1500, v, 0.14);
    // свет только посередине, по краям — темнота
    const g = ctx.createRadialGradient(w * 0.42, h * 0.46, h * 0.08, w * 0.42, h * 0.46, w * 0.62);
    g.addColorStop(0, `rgba(10,4,2,${0.12 - beat * 0.1})`);
    g.addColorStop(0.55, "rgba(10,4,2,.52)");
    g.addColorStop(1, "rgba(4,1,1,.94)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /** Рука с нарисованными костями; растёт снизу вверх, flip — сверху вниз. */
  function hand(ctx, x, y, flip, size, grip) {
    const purple = "#6a35d8";
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, flip ? -size : size);
    ctx.fillStyle = purple;
    ctx.beginPath();
    ctx.moveTo(-26, 340);
    ctx.bezierCurveTo(-30, 180, -44, 90, -48, 30);
    ctx.quadraticCurveTo(-46, -22, 0, -24);
    ctx.quadraticCurveTo(46, -22, 50, 30);
    ctx.bezierCurveTo(44, 90, 34, 180, 30, 340);
    ctx.fill();
    ctx.strokeStyle = purple;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const tips = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * (0.34 - grip * 0.14);
      const len = (i === 0 || i === 4 ? 56 : 76) * (1 - grip * 0.24);
      const bx = (i - 2) * 21, by = -14;
      const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
      ctx.lineWidth = 19;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      tips.push([bx, by, ex, ey]);
    }
    // кости — рваные жёлтые и голубые черты
    for (const [ax, ay, bx, by] of tips) {
      for (const [color, off] of [["#d8ee3a", 0], ["#3fe0d0", 4]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const t = k / 6, zig = (k % 2 ? 3 : -3) + off;
          ctx.lineTo(ax + (bx - ax) * t + zig, 44 * (1 - t) + by * t + ay * 0);
        }
        ctx.stroke();
      }
    }
    ctx.strokeStyle = "#d8ee3a";
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let k = 0; k <= 9; k++) ctx.lineTo(k % 2 ? -7 : 7, 70 + k * 28);
    ctx.stroke();
    ctx.restore();
  }

  function worldHorror(ctx, v, range, midAt) {
    const { left, right } = range;
    const STEP = 34;
    // цепи вдоль коридора
    for (const side of [-1, 1]) {
      for (let k = Math.floor(left / STEP); k * STEP < right; k++) {
        const x = k * STEP;
        const y = midAt(x) + side * (255 + Math.sin(x * 0.0045 + side) * 26);
        const dy = midAt(x + STEP) + side * (255 + Math.sin((x + STEP) * 0.0045 + side) * 26) - y;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.atan2(dy, STEP));
        const flat = k % 2 === 0;
        ctx.fillStyle = flat ? "#c08a78" : "#6a4238";
        ctx.strokeStyle = "#1c0a06";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, 22, flat ? 8 : 3.5, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // тёмные овалы, нанизанные на середину коридора
    const EGG = 1300;
    for (let k = Math.floor((left - 500) / EGG); k * EGG < right + 500; k++) {
      const cx = k * EGG + 300;
      const y = midAt(cx);
      for (let i = -3; i <= 3; i++) {
        const r = (1 - Math.abs(i) / 4) ** 2;
        const x = cx + Math.sign(i) * (i * i * 18 + Math.abs(i) * 70);
        ctx.fillStyle = "#0c0202";
        ctx.strokeStyle = "#5a0c10";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(x, y, 16 + 88 * r, 26 + 150 * r, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        if (i === 0) {
          ctx.fillStyle = "#7a0c14";
          ctx.beginPath();
          ctx.ellipse(x, y, 60, 98, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = "#0c0202";
          ctx.beginPath();
          ctx.arc(x, y, 30 + v.beat * 10, 0, TAU);
          ctx.fill();
        }
      }
    }

    // руки тянутся из темноты и сжимаются в такт
    const HAND = 640;
    for (let k = Math.floor((left - 300) / HAND); k * HAND < right + 300; k++) {
      const x = k * HAND + 120;
      const flip = k % 2 === 0;
      const reach = 262 + Math.sin(v.time * 1.4 + k) * 14;
      hand(ctx, x, midAt(x) + (flip ? -reach : reach), flip, 1.05, Math.min(1, v.beat * 1.2));
    }
  }

  function frontHorror(ctx, v) {
    const { w, h, scale, time, beat } = v;
    // красные трещины — кольца, сжимающиеся на ударах
    ctx.strokeStyle = "#ff1030";
    for (const [k, width] of [[0.4, 5], [0.58, 8]]) {
      ctx.lineWidth = width * scale;
      ctx.beginPath();
      const R = w * k * (1 - beat * 0.035);
      for (let i = 0; i <= 90; i++) {
        const a = (i / 90) * TAU;
        const r = R * (1 + 0.012 * Math.sin(a * 13 + time * 2) + (i % 2 ? 0.004 : -0.004));
        ctx.lineTo(w * 0.5 + Math.cos(a) * r, h * 0.5 + Math.sin(a) * r * 0.86);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  const BACK = { lighthouse: backLighthouse, abyss: backAbyss, horror: backHorror };
  const WORLD = { horror: worldHorror };
  const FRONT = { lighthouse: frontLighthouse, horror: frontHorror };

  return {
    names: Object.keys(BACK),
    palettes,
    back: (name, ctx, v) => BACK[name](ctx, v),
    world: (name, ctx, v, range, midAt) => { if (WORLD[name]) WORLD[name](ctx, v, range, midAt); },
    front: (name, ctx, v) => { if (FRONT[name]) FRONT[name](ctx, v); },
  };
})();
