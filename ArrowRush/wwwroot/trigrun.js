"use strict";

// Как работают триггеры уровня — одно место и для матча (course.js), и для быстрого теста в редакторе (edview.js).
// Триггер срабатывает, когда игрок проходит его ячейку. Поля триггера (см. LevelObject на сервере):
//   v — цвет, текст или выбор из списка; p, q — числа (сдвиг, угол, сила…); d — длительность в секундах;
//   e — плавность (0 ровно, 1 плавно, 2 с замедлением, 3 с отскоком); gr — группа объектов (0 — все объекты).
// Цвета, камера, затемнение и фон держатся до следующего триггера того же вида и плавно перетекают за d секунд.
// Вспышка, тряска, надпись и пульс — разовые. Анимации двигают, крутят и красят объекты своей группы.
const trigrun = (() => {
  const HEX = /^#[0-9a-f]{6}$/i;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, def) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? def : +v);

  const EASES = [
    (t) => t,
    (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
    (t) => 1 - (1 - t) ** 3,
    (t) => {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    },
  ];

  /** Ключи палитры, которые меняет каждый цветовой триггер. */
  const PAL_KEYS = {
    world: null, // вся палитра
    bg: ["sky", "sky2", "neb", "neb2"],
    ground: ["wall", "wall2"],
  };

  const rgbOf = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const hexOf = (c) => "#" + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
  const mixRgb = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const pick = (pal, keys) => (keys ? Object.fromEntries(keys.map((k) => [k, pal[k]])) : { ...pal });
  const mixPal = (a, b, k) => Object.fromEntries(Object.keys(b).map((key) => [key, mixRgb(a[key] || b[key], b[key], k)]));

  /** Старые зум и наклон хранили число в v. */
  const param = (t, def) => ((t.k === "t-zoom" || t.k === "t-tilt") && t.v != null && t.v !== "" && Number.isFinite(+t.v) ? +t.v : num(t.p, def));
  /** Длительность: у триггеров из прошлых версий её нет — тогда как раньше, мягко за полсекунды. */
  const durOf = (t, def = 0.6) => Math.max(0, num(t.d, def));

  function create(objects) {
    const list = (objects || []).filter((o) => levelobj.isTrigger(o.k)).sort((a, b) => a.c - b.c);
    let next = 0;     // первый ещё не сработавший триггер
    let now = 0;      // секунды с начала
    let instant = false; // перемотка: всё встаёт сразу, разовое не играет
    const scalars = {};  // zoom, tilt, ox, oy, dark → твин
    const pals = {};     // world, bg, ground → твин палитры (null — цвета дизайна)
    const lastBase = {}; // база каждого цветового канала в прошлом кадре: от неё считается новый переход
    let bgimg = { id: "none", prev: "none", start: -1, dur: 0 };
    let effect = { id: "none", prev: "none", start: -1, dur: 0 };
    let msg = null;
    let rumble = { power: 0, end: 0 };
    let events = [];
    const groups = new Map();

    const progress = (tw) => {
      if (!tw.dur) return 1;
      return EASES[tw.ease] ? EASES[tw.ease](clamp((now - tw.start) / tw.dur, 0, 1)) : clamp((now - tw.start) / tw.dur, 0, 1);
    };
    const tween = (from, to, t, def) => ({ from, to, start: now, dur: instant ? 0 : durOf(t, def), ease: clamp(num(t.e, 1), 0, 3) | 0 });
    const scalar = (name, def) => {
      const tw = scalars[name];
      return tw ? tw.from + (tw.to - tw.from) * progress(tw) : def;
    };
    const setScalar = (name, def, to, t, d) => {
      scalars[name] = tween(scalar(name, def), to, t, d);
    };

    /** Текущая палитра канала поверх base (null — канал не трогали). */
    function palNow(name, base) {
      const tw = pals[name];
      if (!tw) return null;
      const keys = PAL_KEYS[name];
      const from = tw.from || pick(base, keys), to = tw.to || pick(base, keys);
      return mixPal(from, to, progress(tw));
    }

    function setPal(name, hex, t) {
      const base = lastBase[name];
      const keys = PAL_KEYS[name];
      const from = base ? palNow(name, base) : pals[name] ? pals[name].to : null;
      const to = HEX.test(hex || "") ? pick(levelobj.palette(hex), keys) : null;
      pals[name] = tween(from, to, t);
    }

    function group(gr) {
      if (!groups.has(gr)) groups.set(gr, { tw: {}, target: {}, spin: 0, spinRot: 0, tints: [], pulse: null });
      return groups.get(gr);
    }
    const LOOK_DEF = { dx: 0, dy: 0, rot: 0, scale: 1, alpha: 1, vis: 1 };
    const gval = (g, key) => {
      const tw = g.tw[key];
      return tw ? tw.from + (tw.to - tw.from) * progress(tw) : LOOK_DEF[key];
    };
    const gset = (g, key, to, t) => {
      g.target[key] = to;
      g.tw[key] = tween(gval(g, key), to, t, 0.5);
    };
    const gtarget = (g, key) => g.target[key] ?? LOOK_DEF[key];

    function fire(t) {
      const hex = HEX.test(t.v || "") ? t.v : null;
      const gr = Math.max(0, num(t.gr, 0) | 0);
      switch (t.k) {
        case "t-color": setPal("world", hex, t); break;
        case "t-bg": setPal("bg", hex, t); break;
        case "t-ground": setPal("ground", hex, t); break;
        case "t-bgimg":
          bgimg = { prev: bgimgNow().id, id: t.v || "none", start: now, dur: instant ? 0 : durOf(t, 1) };
          break;
        case "t-effect":
          effect = { prev: effectNow().id, id: t.v || "none", start: now, dur: instant ? 0 : durOf(t, 1) };
          break;
        case "t-dark": setScalar("dark", 0, clamp(num(t.p, 0.5), 0, 0.95), t); break;
        case "t-zoom": setScalar("zoom", 1, clamp(param(t, 1.25), 0.4, 2.5), t); break;
        case "t-tilt": setScalar("tilt", 0, clamp(param(t, 8), -45, 45), t); break;
        case "t-offset":
          setScalar("ox", 0, clamp(num(t.p, 0), -600, 600), t);
          setScalar("oy", 0, clamp(num(t.q, 0), -400, 400), t);
          break;
        case "t-flash":
          if (!instant) events.push({ type: "flash", rgb: rgbOf(hex || "#ffffff"), power: clamp(num(t.p, 1), 0.1, 1) });
          break;
        case "t-shake": {
          if (instant) break;
          const power = clamp(+t.v || num(t.p, 0.6), 0, 1);
          events.push({ type: "shake", power });
          rumble = { power, end: now + durOf(t, 0) };
          break;
        }
        case "t-msg":
          if (!instant && t.v) msg = { text: String(t.v).slice(0, 40), start: now, dur: durOf(t, 2) || 2 };
          break;
        case "t-move": {
          const g = group(gr);
          gset(g, "dx", gtarget(g, "dx") + num(t.p, 0), t);
          gset(g, "dy", gtarget(g, "dy") + num(t.q, 0), t);
          break;
        }
        case "t-rotate": { const g = group(gr); gset(g, "rot", gtarget(g, "rot") + num(t.p, 90), t); break; }
        case "t-scale": gset(group(gr), "scale", clamp(num(t.p, 1.5), 0.1, 5), t); break;
        case "t-alpha": gset(group(gr), "alpha", clamp(num(t.p, 0.3), 0, 1), t); break;
        case "t-toggle": gset(group(gr), "vis", t.v === "off" ? 0 : 1, t); break;
        case "t-spin": group(gr).spin = clamp(num(t.p, 90), -1440, 1440); break;
        case "t-gcolor": {
          const g = group(gr);
          g.tints.push({ rgb: rgbOf(hex || "#ffffff"), ...tween(0, 1, t, 0.5) });
          // слой, который уже докрасился, перекрывает всё, что под ним
          while (g.tints.length > 1 && progress(g.tints[1]) >= 1) g.tints.shift();
          if (g.tints.length > 4) g.tints.shift();
          break;
        }
        case "t-pulse":
          if (!instant) group(gr).pulse = { rgb: rgbOf(hex || "#ffffff"), start: now, dur: durOf(t, 0.6) || 0.6 };
          break;
        case "t-stop": {
          const g = group(gr);
          for (const key of Object.keys(LOOK_DEF)) {
            const v = gval(g, key);
            g.target[key] = v;
            g.tw[key] = { from: v, to: v, start: now, dur: 0, ease: 0 };
          }
          g.spin = 0;
          break;
        }
      }
    }

    function bgimgNow() { return bgimg; }
    function effectNow() { return effect; }

    /** Игрок дошёл до ячейки reached (прошёл все ячейки до неё): сработали новые триггеры; dt — секунды кадра. Возвращает разовые события. */
    function update(reached, dt) {
      now += dt;
      for (const g of groups.values()) g.spinRot += g.spin * dt;
      while (next < list.length && list[next].c < reached) fire(list[next++]);
      const out = events;
      events = [];
      return out;
    }

    /** Перемотка к ячейке cell без анимаций: смена игрока в наблюдении или старт теста с середины. */
    function seek(cell) {
      instant = true;
      while (next < list.length && list[next].c < cell) fire(list[next++]);
      instant = false;
    }

    /** Палитра мира поверх палитры дизайна base: цвет мира, затем фон и стены. */
    function palette(base) {
      lastBase.world = base;
      let pal = { ...base };
      const w = palNow("world", base);
      if (w) Object.assign(pal, w);
      lastBase.bg = lastBase.ground = pal;
      const bgPal = palNow("bg", pal), ground = palNow("ground", pal);
      if (bgPal) pal = { ...pal, ...bgPal };
      if (ground) pal = { ...pal, ...ground };
      return pal;
    }

    const fade = (x) => (x.dur ? clamp((now - x.start) / x.dur, 0, 1) : 1);

    /** Камера, затемнение, картинка фона, эффект, надпись и тряска на этот кадр. */
    function view() {
      let message = null;
      if (msg) {
        const p = (now - msg.start) / msg.dur;
        if (p >= 1) msg = null;
        else message = { text: msg.text, alpha: Math.min(1, p * 6, (1 - p) * 4) };
      }
      return {
        zoom: scalar("zoom", 1),
        tilt: (scalar("tilt", 0) * Math.PI) / 180,
        ox: scalar("ox", 0),
        oy: scalar("oy", 0),
        dark: scalar("dark", 0),
        bg: { id: bgimg.id, prev: bgimg.prev, k: fade(bgimg) },
        effect: { id: effect.id, prev: effect.prev, k: fade(effect) },
        message,
        rumble: now < rumble.end ? rumble.power : 0,
      };
    }

    /** Как сейчас выглядит объект o с учётом анимаций его группы и «всех объектов» (группа 0). null — спрятан. */
    function look(o) {
      if (!groups.size) return LOOK_NONE;
      const gs = [groups.get(0), o.gr > 0 ? groups.get(o.gr) : null].filter(Boolean);
      if (!gs.length) return LOOK_NONE;
      let dx = 0, dy = 0, rot = 0, scale = 1, alpha = 1;
      let color = null;
      for (const g of gs) {
        dx += gval(g, "dx");
        dy += gval(g, "dy");
        rot += gval(g, "rot") + g.spinRot;
        scale *= gval(g, "scale");
        alpha *= gval(g, "alpha") * gval(g, "vis");
        if (g.tints.length || g.pulse) {
          let c = color || rgbOf(levelobj.colorOf(o));
          for (const tint of g.tints) c = mixRgb(c, tint.rgb, progress(tint));
          if (g.pulse) {
            const p = (now - g.pulse.start) / g.pulse.dur;
            if (p >= 1) g.pulse = null;
            else c = mixRgb(c, g.pulse.rgb, 1 - p);
          }
          color = c;
        }
      }
      if (alpha <= 0.01) return null;
      return { dx, dy, rot, scale, alpha, color: color ? hexOf(color) : null };
    }

    return { update, seek, palette, view, look };
  }

  const LOOK_NONE = { dx: 0, dy: 0, rot: 0, scale: 1, alpha: 1, color: null };

  /** Нарисовать объект o через levelobj с учётом look (ctx уже стоит в точке объекта). */
  function drawObject(ctx, o, look, time) {
    if (look === LOOK_NONE) {
      levelobj.draw(ctx, o, time);
      return;
    }
    ctx.save();
    ctx.translate(look.dx, look.dy);
    if (look.rot) ctx.rotate((look.rot * Math.PI) / 180);
    if (look.scale !== 1) ctx.scale(look.scale, look.scale);
    if (look.alpha < 1) ctx.globalAlpha *= look.alpha;
    levelobj.draw(ctx, look.color && levelobj.colored(o.k) ? { ...o, v: look.color } : o, time);
    ctx.restore();
  }

  return { create, drawObject };
})();
