"use strict";

// Объекты уровня из редактора: блоки, стекло, эффекты, декор и триггеры. Один код рисует их в редакторе (edview.js) и в матче (course.js).
// Объект привязан к ячейке: { k — вид, c — номер ячейки, x, y — сдвиг от её стрелки, s — размер, v — цвет, текст или сила, r — поворот 0/90/180/270 }.
// На игру блоки и декор не влияют. Триггер срабатывает, когда игрок проходит свою ячейку: цвет, зум и наклон
// держатся до следующего такого же триггера, вспышка и тряска — разовые. Список видов есть и на сервере (LevelGenerator.EditorObjects).
const levelobj = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const OUTLINE = "#1d1340";
  const TAU = Math.PI * 2;

  /** Цвета, из которых выбирает автор. */
  const COLORS = ["#ffffff", "#ff4f9a", "#ffb31f", "#7ee03a", "#22c7f0", "#8b5cff", "#ff3b5c", "#1d1340"];

  // Вкладки палитры с объектами, по порядку (вкладки ячеек добавляет levels.js)
  const CATS = [
    ["blocks", "Блоки", "b-gem"],
    ["shapes", "Формы", "step"],
    ["slopes", "Склоны", "ramp"],
    ["glass", "Стекло", "g-block"],
    ["fx", "Эффекты", "fx-boom"],
    ["deco", "Декор", "d-gear"],
    ["triggers", "Триггеры", "t-color"],
    ["anim", "Анимация групп", "t-move"],
  ];

  // cat — вкладка редактора; color — цвет нового объекта; r — радиус для клика; v — значение нового объекта;
  // old — вид из прошлых версий: рисуется в старых уровнях, но в палитре его нет
  const B = (name, color = "#22c7f0") => ({ cat: "blocks", name, color, r: 34 });
  /** Триггер: v — значение нового триггера (если не цвет). */
  const T = (cat, name, color, hint, ui, v) => ({ cat, name, color, r: 28, hint, ui, ...(v !== undefined ? { v } : {}) });
  const KINDS = {
    block: B("Блок"),
    "b-gem": B("Пирамида", "#8b5cff"),
    "b-inset": B("Утопленный", "#22c7f0"),
    "b-grid": B("Сетка", "#7ee03a"),
    "b-panel": B("Панели", "#22c7f0"),
    "b-brick": B("Кирпич", "#ff8a3d"),
    "b-stone": B("Камень", "#9a93b0"),
    "b-metal": B("Металл", "#b7c3d6"),
    "b-crate": B("Ящик", "#c98a4b"),
    "b-hazard": B("Опасность", "#ffb31f"),
    "b-tech": B("Схема", "#22c7f0"),
    "b-dark": B("Тёмный", "#ff4f9a"),
    "b-frame": B("Рамка", "#ffffff"),
    "b-checker": B("Шашки", "#ff4f9a"),
    "b-studs": B("Кнопки", "#ff3b5c"),
    "b-ice": B("Лёд", "#9fe8ff"),
    "b-lava": B("Лава", "#ff6a1f"),
    "b-wood": B("Доски", "#c98a4b"),
    "b-gold": B("Золото", "#ffc93d"),
    "b-dots": B("Точки", "#8b5cff"),
    "b-stripes": B("Полосы", "#2fd39a"),
    "b-diamond": B("Ромбы", "#22c7f0"),
    "b-neon": B("Неон", "#ff4f9a"),

    half: { cat: "shapes", name: "Полублок", color: "#22c7f0", r: 34 },
    small: { cat: "shapes", name: "Кубик", color: "#22c7f0", r: 20 },
    slab: { cat: "shapes", name: "Плита", color: "#8b5cff", r: 62 },
    pillar: { cat: "shapes", name: "Колонна", color: "#8b5cff", r: 62 },
    plank: { cat: "shapes", name: "Балка", color: "#c98a4b", r: 62 },
    step: { cat: "shapes", name: "Ступени", color: "#7ee03a", r: 34 },
    cross: { cat: "shapes", name: "Крест", color: "#ffb31f", r: 34 },
    "s-circle": { cat: "shapes", name: "Круг", color: "#22c7f0", r: 34 },
    "s-semi": { cat: "shapes", name: "Полукруг", color: "#7ee03a", r: 34 },
    "s-hex": { cat: "shapes", name: "Шестиугольник", color: "#8b5cff", r: 34 },
    "s-octa": { cat: "shapes", name: "Восьмиугольник", color: "#ff8a3d", r: 34 },
    "s-ring": { cat: "shapes", name: "Бублик", color: "#ff4f9a", r: 34 },
    "s-arch": { cat: "shapes", name: "Арка", color: "#9a93b0", r: 34 },

    ramp: { cat: "slopes", name: "Рампа", color: "#22c7f0", r: 34 },
    ramp2: { cat: "slopes", name: "Пологая", color: "#22c7f0", r: 62 },
    "ramp-half": { cat: "slopes", name: "Малая", color: "#22c7f0", r: 34 },
    wedge: { cat: "slopes", name: "Клин", color: "#ff4f9a", r: 34 },
    curve: { cat: "slopes", name: "Дуга", color: "#7ee03a", r: 34 },

    "g-block": { cat: "glass", name: "Стекло", color: "#9fe8ff", r: 34 },
    "g-half": { cat: "glass", name: "Полустекло", color: "#9fe8ff", r: 34 },
    "g-pane": { cat: "glass", name: "Витрина", color: "#9fe8ff", r: 62 },
    "g-ramp": { cat: "glass", name: "Стекл. рампа", color: "#9fe8ff", r: 34 },
    "g-tile": { cat: "glass", name: "Окно", color: "#ffd36b", r: 34 },
    "g-crack": { cat: "glass", name: "Трещины", color: "#9fe8ff", r: 34 },
    "g-shards": { cat: "glass", name: "Осколки", color: "#9fe8ff", r: 40 },
    "g-orb": { cat: "glass", name: "Шар", color: "#9fe8ff", r: 34 },
    "g-gem": { cat: "glass", name: "Алмаз", color: "#c86bff", r: 34 },
    "g-tube": { cat: "glass", name: "Колба", color: "#2fd39a", r: 46 },

    "fx-boom": { cat: "fx", name: "Взрыв", color: "#ff6a1f", r: 42 },
    "fx-bang": { cat: "fx", name: "Бах!", color: "#ffb31f", r: 46, v: "БАХ!" },
    "fx-spark": { cat: "fx", name: "Искра", color: "#ffffff", r: 34 },
    "fx-fire": { cat: "fx", name: "Огонь", color: "#ff6a1f", r: 38 },
    "fx-smoke": { cat: "fx", name: "Дым", color: "#b9b4c9", r: 42 },
    "fx-bolt": { cat: "fx", name: "Молния", color: "#ffe14a", r: 42 },
    "fx-debris": { cat: "fx", name: "Обломки", color: "#9a93b0", r: 46 },
    "fx-confetti": { cat: "fx", name: "Конфетти", color: "#ff4f9a", r: 42 },
    "fx-beam": { cat: "fx", name: "Луч", color: "#22c7f0", r: 62 },
    "fx-ring": { cat: "fx", name: "Волна", color: "#22c7f0", r: 46 },
    "fx-portal": { cat: "fx", name: "Воронка", color: "#8b5cff", r: 42 },
    "fx-glitch": { cat: "fx", name: "Глитч", color: "#2fd39a", r: 40 },
    "fx-laser": { cat: "fx", name: "Лазер", color: "#ff3b5c", r: 62 },

    text: { cat: "deco", name: "Текст", color: "#ffffff", r: 40, v: "Текст" },
    star: { cat: "deco", name: "Звезда", color: "#ffb31f", r: 32 },
    crystal: { cat: "deco", name: "Кристалл", color: "#ff4f9a", r: 32 },
    lamp: { cat: "deco", name: "Лампа", color: "#ffb31f", r: 30 },
    "d-gear": { cat: "deco", name: "Шестерня", color: "#b7c3d6", r: 34 },
    "d-arrow": { cat: "deco", name: "Указатель", color: "#7ee03a", r: 34 },
    "d-sign": { cat: "deco", name: "Знак", color: "#ffb31f", r: 40 },
    "d-flag": { cat: "deco", name: "Флаг", color: "#ff3b5c", r: 46 },
    "d-chain": { cat: "deco", name: "Цепь", color: "#b7c3d6", r: 46 },
    "d-pipe": { cat: "deco", name: "Труба", color: "#7ee03a", r: 62 },
    "d-grass": { cat: "deco", name: "Трава", color: "#7ee03a", r: 34 },
    "d-heart": { cat: "deco", name: "Сердце", color: "#ff3b5c", r: 30 },
    "d-moon": { cat: "deco", name: "Месяц", color: "#ffe14a", r: 32 },
    "d-tree": { cat: "deco", name: "Ёлка", color: "#2fd39a", r: 46 },
    "d-cactus": { cat: "deco", name: "Кактус", color: "#7ee03a", r: 46 },
    "d-skull": { cat: "deco", name: "Череп", color: "#f3eefe", r: 32 },
    "d-eye": { cat: "deco", name: "Глаз", color: "#22c7f0", r: 32 },
    "d-coin": { cat: "deco", name: "Монета", color: "#ffc93d", r: 30 },
    "d-key": { cat: "deco", name: "Ключ", color: "#ffc93d", r: 34 },
    "d-torch": { cat: "deco", name: "Факел", color: "#ff8a3d", r: 46 },
    "d-bush": { cat: "deco", name: "Куст", color: "#7ee03a", r: 36 },
    "d-mushroom": { cat: "deco", name: "Гриб", color: "#ff3b5c", r: 32 },
    "d-planet": { cat: "deco", name: "Планета", color: "#ff8a3d", r: 40 },
    cloud: { cat: "deco", name: "Облако", color: "#ffffff", r: 44, old: true },
    ring: { cat: "deco", name: "Кольцо", color: "#7ee03a", r: 40, old: true },

    // Триггеры: ui — какие настройки у него в панели (их собирает levels.js, выполняет trigrun.js):
    //   color — цвет в v (строка — подпись кнопки «без цвета»), opts — выбор из списка в v, text — текст в v (макс. длина),
    //   p, q — числа [подпись, мин, макс, шаг, по умолчанию, единица], d — длительность (по умолчанию), e — плавность, gr — группа
    "t-color": T("triggers", "Цвет мира", "#ff4f9a", "весь мир плавно уходит в этот цвет до следующего такого триггера", { color: "Цвет дизайна", d: 0.6, e: true }),
    "t-bg": T("triggers", "Цвет фона", "#3d7bff", "небо и туманности уходят в этот цвет", { color: "Цвет дизайна", d: 0.6, e: true }),
    "t-ground": T("triggers", "Цвет стен", "#7ee03a", "пол и потолок коридора уходят в этот цвет", { color: "Цвет дизайна", d: 0.6, e: true }),
    "t-bgimg": T("triggers", "Картинка фона", "#2fd39a", "за коридором появляется картинка", { opts: "bg", d: 1 }, "city"),
    "t-effect": T("triggers", "Эффект фона", "#ffffff", "по экрану летят частицы", { opts: "effect", d: 1 }, "snow"),
    "t-dark": T("triggers", "Затемнение", "#8a8399", "края экрана темнеют", { p: ["Темнота", 0, 0.95, 0.05, 0.5, "%"], d: 0.6, e: true }),
    "t-flash": T("triggers", "Вспышка", "#ffffff", "экран вспыхивает этим цветом", { color: true, p: ["Сила", 0.1, 1, 0.05, 1, "%"] }),
    "t-shake": T("triggers", "Тряска", "#ffb31f", "камера вздрагивает; с длительностью — трясётся всё это время", { opts: "shake", d: 0 }, "0.6"),
    "t-zoom": T("triggers", "Зум", "#22c7f0", "камера приближается или отдаляется до следующего зума", { p: ["Зум", 0.4, 2.5, 0.05, 1.25, "×"], d: 0.6, e: true }),
    "t-tilt": T("triggers", "Наклон", "#7ee03a", "камера наклоняется до следующего наклона", { p: ["Наклон", -45, 45, 1, 8, "°"], d: 0.6, e: true }),
    "t-offset": T("triggers", "Сдвиг камеры", "#22c7f0", "камера смещается до следующего сдвига", { p: ["По X", -600, 600, 10, 0, ""], q: ["По Y", -400, 400, 10, 0, ""], d: 0.6, e: true }),
    "t-msg": T("triggers", "Надпись", "#ffe14a", "крупная надпись вверху экрана", { text: 40, d: 2 }, "Вперёд!"),
    "t-camspin": T("triggers", "Вращение камеры", "#ff8a3d", "камера крутится без остановки; 0 — перестать", { p: ["Скорость", -360, 360, 5, 30, "°/с"] }),
    "t-camreset": T("triggers", "Сброс камеры", "#c9c3dc", "зум, наклон, сдвиг и вращение камеры возвращаются как были", { d: 0.6, e: true }),
    "t-hue": T("triggers", "Радуга мира", "#c86bff", "цвета мира переливаются по кругу; 0 — перестать", { p: ["Скорость", -720, 720, 5, 60, "°/с"] }),
    "t-letterbox": T("triggers", "Кинорамка", "#1d1340", "сверху и снизу появляются чёрные полосы; 0 — убрать", { p: ["Высота", 0, 0.35, 0.01, 0.12, "%"], d: 0.6, e: true }),
    "t-invert": T("triggers", "Инверсия", "#ffffff", "цвета всей сцены выворачиваются наизнанку", { opts: "toggle2", d: 0.3, e: true }, "on"),

    "t-move": T("anim", "Движение", "#7ee03a", "объекты группы сдвигаются", { gr: true, p: ["По X", -6000, 6000, 5, 120, ""], q: ["По Y", -3000, 3000, 5, 0, ""], d: 0.5, e: true }),
    "t-oscill": T("anim", "Качание", "#2fd39a", "объекты группы ходят туда-обратно, время — один полный ход; размах 0 — перестать", { gr: true, p: ["Размах X", -2000, 2000, 5, 0, ""], q: ["Размах Y", -2000, 2000, 5, 80, ""], d: 2 }),
    "t-orbit": T("anim", "Орбита", "#3d7bff", "объекты группы летают по кругу; радиус 0 — перестать", { gr: true, p: ["Радиус", 0, 2000, 5, 80, ""], q: ["Скорость", -720, 720, 5, 90, "°/с"] }),
    "t-rotate": T("anim", "Вращение", "#ff8a3d", "объекты группы поворачиваются, каждый вокруг себя", { gr: true, p: ["Угол", -1440, 1440, 5, 90, "°"], d: 0.5, e: true }),
    "t-spin": T("anim", "Кружение", "#ffb31f", "объекты группы крутятся без остановки; 0 — перестать", { gr: true, p: ["Скорость", -720, 720, 5, 90, "°/с"] }),
    "t-scale": T("anim", "Масштаб", "#22c7f0", "объекты группы растут или сжимаются", { gr: true, p: ["Масштаб", 0.1, 5, 0.05, 1.5, "×"], d: 0.5, e: true }),
    "t-alpha": T("anim", "Прозрачность", "#c9c3dc", "объекты группы бледнеют или проявляются", { gr: true, p: ["Видимость", 0, 1, 0.05, 0.3, "%"], d: 0.5, e: true }),
    "t-toggle": T("anim", "Вкл/выкл", "#2fd39a", "объекты группы появляются или исчезают", { gr: true, opts: "toggle", d: 0 }, "off"),
    "t-gcolor": T("anim", "Цвет группы", "#c86bff", "объекты группы перекрашиваются", { gr: true, color: true, d: 0.5, e: true }),
    "t-pulse": T("anim", "Пульс", "#ff3b5c", "объекты группы вспыхивают цветом и возвращаются", { gr: true, color: true, d: 0.6 }),
    "t-stop": T("anim", "Стоп", "#8a8399", "анимации группы замирают там, где они сейчас", { gr: true }),
  };

  /** Списки выбора для триггеров: [значение, подпись]. */
  const LISTS = {
    shake: [["0.3", "Слабо"], ["0.6", "Средне"], ["1", "Сильно"]],
    toggle: [["on", "Показать"], ["off", "Спрятать"]],
    toggle2: [["on", "Включить"], ["off", "Выключить"]],
    bg: bgart.BGS,
    effect: bgart.EFFECTS,
  };
  /** Выбор из списка у триггера k или null. */
  const optionsOf = (k) => (KINDS[k].ui && typeof KINDS[k].ui.opts === "string" ? LISTS[KINDS[k].ui.opts] : null);
  /** Для старого кода: у каких триггеров выбор из списка. */
  const OPTIONS = Object.fromEntries(Object.keys(KINDS).filter((k) => optionsOf(k)).map((k) => [k, optionsOf(k)]));

  /** Виды, у которых значение — текст, а не цвет. */
  const TEXTS = new Set(["text", "fx-bang", "t-msg"]);

  const isTrigger = (k) => k.startsWith("t-");
  /** У каких видов значение — цвет: у объектов — кроме текстовых, у триггеров — если так сказано в ui. */
  const colored = (k) => (isTrigger(k) ? !!(KINDS[k].ui && KINDS[k].ui.color) : !TEXTS.has(k));
  const radius = (o) => KINDS[o.k].r * (isTrigger(o.k) ? 1 : (o.s || 1) * Math.max(o.w || 1, o.h || 1));
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
  const alpha = (hex, a) => {
    const [r, g, b] = hexRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
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

  /** Вертикальный градиент цвета: светлее сверху, темнее снизу. */
  function grad(c, color, h, top = 0.25, bottom = -0.45) {
    const g = c.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, shade(color, top));
    g.addColorStop(1, shade(color, bottom));
    return g;
  }

  function poly(c, pts) {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
  }

  function strokeLines(c, segs, style, width) {
    c.beginPath();
    for (const [x1, y1, x2, y2] of segs) {
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
    }
    c.strokeStyle = style;
    c.lineWidth = width;
    c.stroke();
  }

  /** Блок: заливка с бликом сверху и рамкой внутри. */
  function block(c, w, h, color) {
    c.beginPath();
    c.rect(-w / 2, -h / 2, w, h);
    outlined(c, grad(c, color, h));
    const p = Math.min(8, Math.min(w, h) / 4);
    c.strokeStyle = "rgba(255,255,255,.45)";
    c.lineWidth = 3;
    c.strokeRect(-w / 2 + p, -h / 2 + p, w - p * 2, h - p * 2);
  }

  /** Квадрат 60×60 с рисунком внутри: pattern рисует поверх заливки, обводка сверху всего. */
  function tile(c, fill, pattern) {
    c.save();
    c.beginPath();
    c.rect(-30, -30, 60, 60);
    c.fillStyle = fill;
    c.fill();
    c.clip();
    pattern();
    c.restore();
    c.beginPath();
    c.rect(-30, -30, 60, 60);
    c.lineWidth = 4;
    c.strokeStyle = OUTLINE;
    c.stroke();
  }

  /** Фаска: светлый верх и левый край, тёмный низ и правый. */
  function bevel(c, x, y, w, h, d, light = "rgba(255,255,255,.4)", dark = "rgba(0,0,0,.3)") {
    c.fillStyle = light;
    poly(c, [[x, y], [x + w, y], [x + w - d, y + d], [x + d, y + d], [x + d, y + h - d], [x, y + h]]);
    c.fill();
    c.fillStyle = dark;
    poly(c, [[x + w, y + h], [x, y + h], [x + d, y + h - d], [x + w - d, y + h - d], [x + w - d, y + d], [x + w, y]]);
    c.fill();
  }

  const BLOCKS = {
    block: (c, col) => block(c, 60, 60, col),
    "b-gem": (c, col) => tile(c, col, () => {
      // пирамида: четыре грани к центру
      for (const [pts, k] of [
        [[[-30, -30], [30, -30], [0, 0]], 0.35], [[[-30, -30], [-30, 30], [0, 0]], 0.05],
        [[[30, -30], [30, 30], [0, 0]], -0.3], [[[-30, 30], [30, 30], [0, 0]], -0.5],
      ]) {
        poly(c, pts);
        c.fillStyle = shade(col, k);
        c.fill();
      }
      strokeLines(c, [[-30, -30, 30, 30], [30, -30, -30, 30]], "rgba(0,0,0,.25)", 2);
    }),
    "b-inset": (c, col) => tile(c, grad(c, col, 60), () => {
      bevel(c, -30, -30, 60, 60, 6);
      c.fillStyle = shade(col, -0.35);
      c.fillRect(-16, -16, 32, 32);
      bevel(c, -16, -16, 32, 32, 5, "rgba(0,0,0,.35)", "rgba(255,255,255,.3)");
    }),
    "b-grid": (c, col) => tile(c, grad(c, col, 60), () => {
      const s = [];
      for (const v of [-10, 10]) s.push([v, -30, v, 30], [-30, v, 30, v]);
      strokeLines(c, s, "rgba(0,0,0,.35)", 3);
      strokeLines(c, s.map(([a, b, d, e]) => [a + 2, b + 2, d + 2, e + 2]), "rgba(255,255,255,.22)", 1.5);
    }),
    "b-panel": (c, col) => tile(c, shade(col, -0.15), () => {
      for (const x of [-30, 0]) for (const y of [-30, 0]) {
        c.fillStyle = shade(col, x + y === -30 ? 0.1 : -0.05);
        c.fillRect(x, y, 30, 30);
        bevel(c, x, y, 30, 30, 5);
      }
    }),
    "b-brick": (c, col) => tile(c, col, () => {
      const s = [[-30, -15, 30, -15], [-30, 0, 30, 0], [-30, 15, 30, 15]];
      for (let row = 0; row < 4; row++) {
        const y = -30 + row * 15, off = row % 2 ? 0 : 15;
        for (let x = -30 + off; x < 30; x += 30) s.push([x, y, x, y + 15]);
      }
      c.fillStyle = "rgba(255,255,255,.18)";
      for (let row = 0; row < 4; row++) c.fillRect(-30, -30 + row * 15, 60, 4);
      strokeLines(c, s, shade(col, -0.55), 3);
    }),
    "b-stone": (c, col) => tile(c, grad(c, col, 60, 0.15, -0.35), () => {
      c.beginPath();
      c.moveTo(-30, -6); c.lineTo(-12, -10); c.lineTo(-4, 4); c.lineTo(14, 2); c.lineTo(30, 12);
      c.moveTo(-4, 4); c.lineTo(-10, 30);
      c.moveTo(-12, -10); c.lineTo(-6, -30);
      c.moveTo(14, 2); c.lineTo(20, -18); c.lineTo(30, -22);
      c.strokeStyle = shade(col, -0.6);
      c.lineWidth = 3;
      c.lineJoin = "round";
      c.stroke();
      c.fillStyle = "rgba(255,255,255,.2)";
      c.fillRect(-26, -26, 10, 6);
      c.fillRect(6, 10, 12, 5);
    }),
    "b-metal": (c, col) => tile(c, grad(c, col, 60, 0.4, -0.35), () => {
      bevel(c, -30, -30, 60, 60, 5);
      c.fillStyle = shade(col, -0.55);
      for (const x of [-19, 19]) for (const y of [-19, 19]) {
        c.beginPath();
        c.arc(x, y, 3.5, 0, TAU);
        c.fill();
      }
      strokeLines(c, [[-14, -14, 14, -14]], "rgba(255,255,255,.5)", 2);
    }),
    "b-crate": (c, col) => tile(c, col, () => {
      strokeLines(c, [[-30, -10, 30, -10], [-30, 10, 30, 10]], shade(col, -0.45), 2);
      c.lineWidth = 7;
      c.strokeStyle = shade(col, -0.3);
      c.strokeRect(-26, -26, 52, 52);
      strokeLines(c, [[-24, -24, 24, 24]], shade(col, -0.3), 7);
      strokeLines(c, [[-24, -24, 24, 24]], shade(col, 0.2), 2);
      c.strokeStyle = shade(col, -0.6);
      c.lineWidth = 2;
      c.strokeRect(-23, -23, 46, 46);
    }),
    "b-hazard": (c, col) => tile(c, col, () => {
      c.fillStyle = OUTLINE;
      for (let x = -90; x < 60; x += 24) poly(c, [[x, 30], [x + 12, 30], [x + 72, -30], [x + 60, -30]]), c.fill();
      bevel(c, -30, -30, 60, 60, 4, "rgba(255,255,255,.3)", "rgba(0,0,0,.3)");
    }),
    "b-tech": (c, col) => tile(c, shade(col, -0.7), () => {
      c.strokeStyle = col;
      c.lineWidth = 3;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(-30, -14); c.lineTo(-10, -14); c.lineTo(-2, -22); c.lineTo(30, -22);
      c.moveTo(-30, 8); c.lineTo(4, 8); c.lineTo(14, -2); c.lineTo(14, -10);
      c.moveTo(-14, 30); c.lineTo(-14, 20); c.lineTo(20, 20); c.lineTo(30, 10);
      c.stroke();
      c.fillStyle = shade(col, 0.5);
      for (const [x, y] of [[-10, -14], [14, -10], [-14, 20], [4, 8]]) {
        c.beginPath();
        c.arc(x, y, 3.5, 0, TAU);
        c.fill();
      }
    }),
    "b-dark": (c, col) => tile(c, "#120c2a", () => {
      c.shadowColor = col;
      c.shadowBlur = 10;
      c.strokeStyle = col;
      c.lineWidth = 3;
      c.strokeRect(-24, -24, 48, 48);
      c.shadowBlur = 0;
      c.fillStyle = alpha(col.startsWith("#") ? col : "#ffffff", 0.12);
      c.fillRect(-24, -24, 48, 48);
    }),
    "b-frame": (c, col) => {
      c.beginPath();
      c.rect(-30, -30, 60, 60);
      c.rect(-18, 18, 36, -36);
      outlined(c, grad(c, col, 60, 0.1, -0.4));
    },
    "b-checker": (c, col) => tile(c, shade(col, 0.15), () => {
      c.fillStyle = shade(col, -0.4);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) c.fillRect(-30 + i * 15, -30 + j * 15, 15, 15);
    }),
    "b-studs": (c, col) => tile(c, grad(c, col, 60), () => {
      for (const x of [-14, 14]) for (const y of [-14, 14]) {
        c.beginPath();
        c.arc(x, y + 2, 9, 0, TAU);
        c.fillStyle = shade(col, -0.45);
        c.fill();
        c.beginPath();
        c.arc(x, y, 9, 0, TAU);
        c.fillStyle = shade(col, 0.2);
        c.fill();
        c.strokeStyle = "rgba(0,0,0,.3)";
        c.lineWidth = 1.5;
        c.stroke();
      }
    }),
  };

  /** Стекло: прозрачная заливка, светлая кромка и косой блик. path рисует контур. */
  function glass(c, color, path, extra) {
    path();
    c.fillStyle = alpha(color, 0.28);
    c.fill();
    c.save();
    c.clip();
    c.fillStyle = "rgba(255,255,255,.35)";
    poly(c, [[-70, 40], [-50, 40], [10, -70], [-10, -70]]);
    c.fill();
    poly(c, [[-38, 40], [-32, 40], [28, -70], [22, -70]]);
    c.fill();
    if (extra) extra();
    c.restore();
    path();
    c.lineWidth = 4;
    c.strokeStyle = OUTLINE;
    c.lineJoin = "round";
    c.stroke();
    path();
    c.lineWidth = 2;
    c.strokeStyle = alpha(color, 0.9);
    c.stroke();
  }

  const rect = (c, w, h) => () => {
    c.beginPath();
    c.rect(-w / 2, -h / 2, w, h);
  };

  /** Огненный шар со звёздными лучами: взрыв и «Бах». */
  function burst(c, r, color, spikes, inner, t) {
    c.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i * Math.PI) / spikes + t * 0.3;
      const rr = i % 2 ? r * inner : r * (0.85 + ((i * 37) % 7) / 40);
      c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath();
  }

  /** Блоки, формы, склоны, стекло, эффекты и декор: k → рисунок. */
  const DRAW = {
    ...BLOCKS,
    half: (c, col) => block(c, 60, 30, col),
    small: (c, col) => block(c, 30, 30, col),
    slab: (c, col) => block(c, 120, 30, col),
    pillar: (c, col) => block(c, 34, 120, col),
    plank: (c, col) => {
      c.beginPath();
      c.rect(-60, -7, 120, 14);
      outlined(c, grad(c, col, 14), 3);
      strokeLines(c, [[-30, -7, -30, 7], [0, -7, 0, 7], [30, -7, 30, 7]], "rgba(0,0,0,.3)", 2);
    },
    step: (c, col) => {
      poly(c, [[-30, 30], [-30, 10], [-10, 10], [-10, -10], [10, -10], [10, -30], [30, -30], [30, 30]]);
      outlined(c, grad(c, col, 60));
      strokeLines(c, [[-26, 14, -14, 14], [-6, -6, 6, -6], [14, -26, 26, -26]], "rgba(255,255,255,.5)", 3);
    },
    cross: (c, col) => {
      poly(c, [[-10, -30], [10, -30], [10, -10], [30, -10], [30, 10], [10, 10], [10, 30], [-10, 30], [-10, 10], [-30, 10], [-30, -10], [-10, -10]]);
      outlined(c, grad(c, col, 60));
    },

    ramp: (c, col) => { poly(c, [[-30, 30], [30, -30], [30, 30]]); outlined(c, grad(c, col, 60)); },
    ramp2: (c, col) => { poly(c, [[-60, 30], [60, -30], [60, 30]]); outlined(c, grad(c, col, 60)); },
    "ramp-half": (c, col) => { poly(c, [[-30, 15], [30, -15], [30, 15]]); outlined(c, grad(c, col, 30)); },
    wedge: (c, col) => { poly(c, [[-30, 30], [0, -30], [30, 30]]); outlined(c, grad(c, col, 60)); },
    curve: (c, col) => {
      c.beginPath();
      // выпуклый склон: четверть круга от левого нижнего угла к правому верхнему
      c.moveTo(-30, 30);
      c.quadraticCurveTo(-30, -30, 30, -30);
      c.lineTo(30, 30);
      c.closePath();
      outlined(c, grad(c, col, 60));
    },

    "g-block": (c, col) => glass(c, col, rect(c, 60, 60)),
    "g-half": (c, col) => glass(c, col, rect(c, 60, 30)),
    "g-pane": (c, col) => glass(c, col, rect(c, 16, 120)),
    "g-ramp": (c, col) => glass(c, col, () => poly(c, [[-30, 30], [30, -30], [30, 30]])),
    "g-tile": (c, col) => glass(c, col, rect(c, 60, 60), () => {
      strokeLines(c, [[0, -30, 0, 30], [-30, 0, 30, 0]], OUTLINE, 5);
      strokeLines(c, [[0, -30, 0, 30], [-30, 0, 30, 0]], shade(col, -0.2), 2);
    }),
    "g-crack": (c, col) => glass(c, col, rect(c, 60, 60), () => {
      c.beginPath();
      for (const [x, y] of [[-30, -20], [30, -8], [-12, 30], [22, 30], [-30, 14], [8, -30]]) {
        c.moveTo(2, -2);
        c.lineTo((x + 2) / 2 + 3, (y - 2) / 2 - 2);
        c.lineTo(x, y);
      }
      c.strokeStyle = "rgba(255,255,255,.85)";
      c.lineWidth = 1.5;
      c.stroke();
    }),
    "g-shards": (c, col, t) => {
      const shards = [[-20, -14, 0.3], [12, -20, -0.5], [22, 8, 0.9], [-6, 16, -0.2], [-26, 14, 1.4]];
      shards.forEach(([x, y, a], i) => {
        const f = reduce ? 0 : Math.sin(t * 1.6 + i) * 3;
        c.save();
        c.translate(x, y + f);
        c.rotate(a + (reduce ? 0 : Math.sin(t + i) * 0.15));
        glass(c, col, () => poly(c, [[-9, 8], [0, -11], [10, 6]]));
        c.restore();
      });
    },

    "fx-boom": (c, col, t) => {
      const k = reduce ? 1 : 1 + Math.sin(t * 9) * 0.06;
      c.scale(k, k);
      burst(c, 40, col, 9, 0.55, reduce ? 0 : t);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 40);
      g.addColorStop(0, "#fffbe0");
      g.addColorStop(0.35, "#ffe14a");
      g.addColorStop(1, col);
      outlined(c, g, 3);
      burst(c, 20, col, 7, 0.5, reduce ? 0 : -t * 1.5);
      c.fillStyle = "rgba(255,255,255,.85)";
      c.fill();
    },
    "fx-bang": (c, col, t, o) => {
      const k = reduce ? 1 : 1 + Math.sin(t * 6) * 0.04;
      c.scale(k, k);
      burst(c, 46, col, 12, 0.72, 0);
      outlined(c, col, 4);
      burst(c, 36, col, 12, 0.75, 0.1);
      c.fillStyle = "#fff6c9";
      c.fill();
      c.font = "900 18px Unbounded, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = 5;
      c.strokeStyle = OUTLINE;
      const text = ((o && o.v) || KINDS["fx-bang"].v).slice(0, 8);
      c.strokeText(text, 0, 1);
      c.fillStyle = "#ff3b5c";
      c.fillText(text, 0, 1);
    },
    "fx-spark": (c, col, t) => {
      const twinkle = (x, y, r, ph) => {
        const k = reduce ? 1 : 0.6 + Math.abs(Math.sin(t * 3 + ph)) * 0.4;
        c.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4, rr = (i % 2 ? r * 0.22 : r) * k;
          c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        c.closePath();
        outlined(c, col, 3);
      };
      twinkle(-4, 0, 30, 0);
      twinkle(20, -20, 12, 1.7);
      twinkle(18, 20, 9, 3.1);
    },
    "fx-fire": (c, col, t) => {
      for (const [k, fill] of [[1, col], [0.62, "#ffe14a"], [0.3, "#fffbe0"]]) {
        const w = reduce ? 0 : Math.sin(t * 11 + k * 5) * 4 * k;
        c.beginPath();
        c.moveTo(0, 32);
        c.bezierCurveTo(-30 * k, 30, -26 * k, 0, -10 * k + w, -14 * k);
        c.bezierCurveTo(-4 * k, -22 * k, 0, -26 * k, w * 1.5, -36 * k);
        c.bezierCurveTo(10 * k, -20 * k, 28 * k, -4 * k, 24 * k, 12);
        c.bezierCurveTo(22 * k, 26, 10 * k, 32, 0, 32);
        if (k === 1) outlined(c, fill, 3);
        else {
          c.fillStyle = fill;
          c.fill();
        }
      }
    },
    "fx-smoke": (c, col, t) => {
      for (let i = 0; i < 4; i++) {
        const p = reduce ? i / 4 : ((t * 0.35 + i / 4) % 1);
        const r = 10 + p * 16;
        c.globalAlpha = 0.85 * (1 - p * 0.8);
        c.beginPath();
        c.arc(Math.sin(i * 2.1 + p * 3) * 8, 26 - p * 58, r, 0, TAU);
        outlined(c, shade(col, 0.15 - i * 0.08), 3);
      }
      c.globalAlpha = 1;
    },
    "fx-bolt": (c, col, t) => {
      c.globalAlpha = reduce ? 1 : 0.55 + Math.abs(Math.sin(t * 13)) * 0.45;
      poly(c, [[6, -42], [-16, 2], [-2, 2], [-10, 42], [16, -6], [2, -6], [12, -42]]);
      c.shadowColor = col;
      c.shadowBlur = 12;
      outlined(c, col, 3);
      c.shadowBlur = 0;
      c.globalAlpha = 1;
    },
    "fx-debris": (c, col, t) => {
      const rocks = [[0, -30, 9], [26, -10, 7], [20, 22, 10], [-18, 24, 6], [-28, -6, 8]];
      rocks.forEach(([x, y, r], i) => {
        c.save();
        const a = reduce ? 0 : t * 0.4;
        c.rotate(a);
        c.translate(x, y);
        c.rotate(i + (reduce ? 0 : t * (i % 2 ? 1.2 : -0.9)));
        poly(c, [[-r, -r * 0.4], [-r * 0.2, -r], [r, -r * 0.5], [r * 0.7, r * 0.8], [-r * 0.6, r]]);
        outlined(c, shade(col, (i % 3) * 0.1 - 0.1), 3);
        c.restore();
      });
    },
    "fx-confetti": (c, col, t) => {
      const cols = [col, "#ffb31f", "#22c7f0", "#7ee03a", "#ffffff"];
      for (let i = 0; i < 14; i++) {
        const x = ((i * 53) % 70) - 35;
        const y = reduce ? ((i * 29) % 70) - 35 : (((i * 29 + t * 40) % 80) + 80) % 80 - 40;
        c.save();
        c.translate(x, y);
        c.rotate(i + (reduce ? 0 : t * (2 + (i % 3))));
        c.fillStyle = cols[i % cols.length];
        c.fillRect(-4, -2.5, 8, 5);
        c.strokeStyle = OUTLINE;
        c.lineWidth = 1;
        c.strokeRect(-4, -2.5, 8, 5);
        c.restore();
      }
    },
    "fx-beam": (c, col, t) => {
      const k = reduce ? 1 : 0.8 + Math.sin(t * 2.5) * 0.2;
      const g = c.createLinearGradient(0, -60, 0, 60);
      g.addColorStop(0, alpha(col, 0.85 * k));
      g.addColorStop(1, alpha(col, 0));
      poly(c, [[-8, -60], [8, -60], [30, 60], [-30, 60]]);
      c.fillStyle = g;
      c.fill();
      c.fillStyle = "rgba(255,255,255,.7)";
      c.fillRect(-3, -60, 6, 70 * k);
      c.beginPath();
      c.rect(-12, -64, 24, 8);
      outlined(c, shade(col, -0.3), 3);
    },

    star: (c, col, t) => {
      c.rotate(reduce ? 0 : t * 0.6);
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? 13.5 : 30;
        c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.closePath();
      outlined(c, col);
    },
    crystal: (c, col) => {
      poly(c, [[0, -32], [18, -6], [0, 32], [-18, -6]]);
      outlined(c, col);
      c.beginPath();
      c.moveTo(0, -32);
      c.lineTo(-6, -6);
      c.lineTo(0, 32);
      c.fillStyle = "rgba(255,255,255,.45)";
      c.fill();
    },
    lamp: (c, col, t) => {
      const k = reduce ? 1 : 0.85 + Math.sin(t * 7) * 0.08 + Math.sin(t * 2.3) * 0.07;
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 70 * k);
      g.addColorStop(0, alpha(col, 0.55));
      g.addColorStop(1, alpha(col, 0));
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, 70 * k, 0, TAU);
      c.fill();
      c.beginPath();
      c.arc(0, 0, 12, 0, TAU);
      outlined(c, shade(col, 0.5), 3);
    },
    "d-gear": (c, col, t) => {
      c.rotate(reduce ? 0 : t * 0.8);
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i * TAU) / 10, d = TAU / 40;
        c.lineTo(Math.cos(a - d * 1.6) * 24, Math.sin(a - d * 1.6) * 24);
        c.lineTo(Math.cos(a - d) * 32, Math.sin(a - d) * 32);
        c.lineTo(Math.cos(a + d) * 32, Math.sin(a + d) * 32);
        c.lineTo(Math.cos(a + d * 1.6) * 24, Math.sin(a + d * 1.6) * 24);
      }
      c.closePath();
      c.moveTo(9, 0);
      c.arc(0, 0, 9, 0, TAU, true);
      outlined(c, grad(c, col, 60, 0.3, -0.35), 3);
    },
    "d-arrow": (c, col) => {
      poly(c, [[-30, -10], [4, -10], [4, -24], [30, 0], [4, 24], [4, 10], [-30, 10]]);
      outlined(c, grad(c, col, 48));
    },
    "d-sign": (c, col) => {
      c.beginPath();
      c.rect(-3, 4, 6, 36);
      outlined(c, "#8a8399", 3);
      poly(c, [[0, -38], [30, 14], [-30, 14]]);
      outlined(c, col);
      c.font = "900 30px Unbounded, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = OUTLINE;
      c.fillText("!", 0, -2);
    },
    "d-flag": (c, col, t) => {
      c.beginPath();
      c.rect(-24, -44, 6, 88);
      outlined(c, "#d8d2e6", 3);
      const w = reduce ? 0 : Math.sin(t * 5) * 5;
      c.beginPath();
      c.moveTo(-18, -42);
      c.quadraticCurveTo(4, -48 + w, 26, -36);
      c.lineTo(26, -8);
      c.quadraticCurveTo(4, -20 - w, -18, -14);
      c.closePath();
      outlined(c, col, 3);
    },
    "d-chain": (c, col, t) => {
      c.rotate(reduce ? 0 : Math.sin(t * 1.8) * 0.12);
      for (let i = 0; i < 5; i++) {
        const y = -38 + i * 19;
        c.beginPath();
        if (i % 2) c.ellipse(0, y, 3.5, 12, 0, 0, TAU);
        else c.ellipse(0, y, 8, 12, 0, 0, TAU);
        c.lineWidth = 7;
        c.strokeStyle = OUTLINE;
        c.stroke();
        c.lineWidth = 3.5;
        c.strokeStyle = col;
        c.stroke();
      }
    },
    "d-pipe": (c, col) => {
      c.beginPath();
      c.rect(-12, -60, 24, 120);
      const g = c.createLinearGradient(-12, 0, 12, 0);
      g.addColorStop(0, shade(col, -0.3));
      g.addColorStop(0.35, shade(col, 0.4));
      g.addColorStop(1, shade(col, -0.5));
      outlined(c, g, 3);
      for (const y of [-56, 44]) {
        c.beginPath();
        c.rect(-17, y, 34, 12);
        outlined(c, g, 3);
      }
    },
    "d-grass": (c, col, t) => {
      const sway = reduce ? 0 : Math.sin(t * 2.2) * 4;
      c.beginPath();
      [[-24, 22], [-14, 34], [-4, 26], [6, 38], [16, 28], [26, 20]].forEach(([x, h], i) => {
        c.moveTo(x - 6, 30);
        c.quadraticCurveTo(x + sway * 0.5, 30 - h * 0.6, x + sway + (i % 2 ? 3 : -3), 30 - h);
        c.quadraticCurveTo(x + 2, 30 - h * 0.5, x + 6, 30);
      });
      outlined(c, grad(c, col, 60, 0.3, -0.3), 3);
    },
    "d-heart": (c, col, t) => {
      const k = reduce ? 1 : 1 + Math.max(0, Math.sin(t * 4)) * 0.08;
      c.scale(k, k);
      c.beginPath();
      c.moveTo(0, 26);
      c.bezierCurveTo(-34, 2, -24, -30, 0, -12);
      c.bezierCurveTo(24, -30, 34, 2, 0, 26);
      outlined(c, col);
      c.beginPath();
      c.ellipse(-11, -10, 5, 3, -0.6, 0, TAU);
      c.fillStyle = "rgba(255,255,255,.6)";
      c.fill();
    },
    "d-moon": (c, col) => {
      c.beginPath();
      c.arc(0, 0, 30, 0.45 * Math.PI, 1.55 * Math.PI);
      c.arc(14, 0, 24, 1.62 * Math.PI, 0.38 * Math.PI, true);
      c.closePath();
      outlined(c, col);
    },
    text: (c, col, t, o) => {
      c.font = "900 36px Unbounded, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineJoin = "round";
      c.lineWidth = 8;
      c.strokeStyle = OUTLINE;
      const text = ((o && o.v) || KINDS.text.v).slice(0, 40);
      c.strokeText(text, 0, 0);
      c.fillStyle = "#fff";
      c.fillText(text, 0, 0);
    },
    cloud: (c, col) => {
      // сначала общий контур, потом заливка поверх: стыки кругов не видны
      c.beginPath();
      for (const [x, y, r] of [[-22, 6, 18], [0, -8, 24], [24, 6, 17]]) {
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, TAU);
      }
      c.lineWidth = 7;
      c.strokeStyle = OUTLINE;
      c.stroke();
      c.fillStyle = col;
      c.fill();
    },
    ring: (c, col, t) => {
      const k = reduce ? 1 : 1 + Math.sin(t * 3) * 0.06;
      c.lineWidth = 14 * k;
      c.strokeStyle = OUTLINE;
      c.beginPath();
      c.arc(0, 0, 32 * k, 0, TAU);
      c.stroke();
      c.lineWidth = 8 * k;
      c.strokeStyle = col;
      c.stroke();
    },
  };

  // ---------- Новые блоки, формы, стекло, эффекты и декор ----------
  const regular = (c, n, r, turn = 0) => {
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a = turn + (i * TAU) / n;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
  };

  Object.assign(DRAW, {
    "b-ice": (c, col) => tile(c, grad(c, col, 60, 0.5, -0.15), () => {
      c.fillStyle = "rgba(255,255,255,.55)";
      poly(c, [[-30, -30], [-6, -30], [-30, -6]]);
      c.fill();
      strokeLines(c, [[-18, 12, 4, -10], [4, -10, 22, 4], [4, -10, 8, -28]], "rgba(255,255,255,.7)", 1.5);
      bevel(c, -30, -30, 60, 60, 4, "rgba(255,255,255,.5)", "rgba(0,60,120,.25)");
    }),
    "b-lava": (c, col, t) => tile(c, shade(col, -0.55), () => {
      // светящиеся трещины переливаются
      const k = reduce ? 1 : 0.7 + Math.sin(t * 3) * 0.3;
      c.lineJoin = "round";
      c.beginPath();
      c.moveTo(-30, -8); c.lineTo(-10, -2); c.lineTo(0, -18); c.lineTo(18, -10); c.lineTo(30, -16);
      c.moveTo(-10, -2); c.lineTo(-4, 16); c.lineTo(14, 22); c.lineTo(30, 14);
      c.moveTo(-4, 16); c.lineTo(-22, 30);
      c.strokeStyle = shade(col, 0.4);
      c.lineWidth = 6 * k;
      c.shadowColor = col;
      c.shadowBlur = 10;
      c.stroke();
      c.strokeStyle = "#ffe9a8";
      c.lineWidth = 2;
      c.stroke();
    }),
    "b-wood": (c, col) => tile(c, col, () => {
      for (let i = 0; i < 4; i++) {
        c.fillStyle = shade(col, i % 2 ? -0.12 : 0.08);
        c.fillRect(-30, -30 + i * 15, 60, 15);
      }
      strokeLines(c, [[-30, -15, 30, -15], [-30, 0, 30, 0], [-30, 15, 30, 15]], shade(col, -0.55), 2);
      c.fillStyle = shade(col, -0.6);
      for (const [x, y] of [[-24, -23], [24, -23], [-24, 22], [24, 22], [-24, -8], [24, 7]]) c.fillRect(x - 1.5, y - 1.5, 3, 3);
    }),
    "b-gold": (c, col, t) => tile(c, grad(c, col, 60, 0.45, -0.35), () => {
      bevel(c, -30, -30, 60, 60, 7, "rgba(255,255,220,.6)", "rgba(120,70,0,.4)");
      // блик пробегает по блоку
      const x = reduce ? 0 : ((t * 40) % 140) - 70;
      c.fillStyle = "rgba(255,255,255,.45)";
      poly(c, [[x - 10, 30], [x, 30], [x + 30, -30], [x + 20, -30]]);
      c.fill();
    }),
    "b-dots": (c, col) => tile(c, grad(c, col, 60), () => {
      c.fillStyle = shade(col, -0.45);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        c.beginPath();
        c.arc(-22.5 + i * 15, -22.5 + j * 15, 4, 0, TAU);
        c.fill();
      }
    }),
    "b-stripes": (c, col) => tile(c, shade(col, 0.1), () => {
      c.fillStyle = shade(col, -0.35);
      for (let i = 0; i < 4; i++) c.fillRect(-30 + i * 15, -30, 7, 60);
      bevel(c, -30, -30, 60, 60, 4);
    }),
    "b-diamond": (c, col) => tile(c, shade(col, -0.3), () => {
      for (const [x, y] of [[0, 0], [-30, -30], [30, -30], [-30, 30], [30, 30]]) {
        poly(c, [[x, y - 15], [x + 15, y], [x, y + 15], [x - 15, y]]);
        c.fillStyle = shade(col, 0.2);
        c.fill();
      }
      strokeLines(c, [[-30, 0, 0, -30], [0, -30, 30, 0], [30, 0, 0, 30], [0, 30, -30, 0]], "rgba(0,0,0,.3)", 2);
    }),
    "b-neon": (c, col, t) => tile(c, "#0f0a24", () => {
      const k = reduce ? 1 : 0.6 + Math.abs(Math.sin(t * 2.5)) * 0.4;
      c.shadowColor = col;
      c.shadowBlur = 14 * k;
      c.strokeStyle = col;
      c.lineWidth = 4;
      c.strokeRect(-22, -22, 44, 44);
      c.strokeRect(-10, -10, 20, 20);
      c.shadowBlur = 0;
    }),

    "s-circle": (c, col) => { c.beginPath(); c.arc(0, 0, 30, 0, TAU); outlined(c, grad(c, col, 60)); },
    "s-semi": (c, col) => { c.beginPath(); c.arc(0, 15, 30, Math.PI, 0); c.closePath(); outlined(c, grad(c, col, 30)); },
    "s-hex": (c, col) => { regular(c, 6, 31); outlined(c, grad(c, col, 60)); },
    "s-octa": (c, col) => { regular(c, 8, 32, Math.PI / 8); outlined(c, grad(c, col, 60)); },
    "s-ring": (c, col) => {
      c.beginPath();
      c.arc(0, 0, 30, 0, TAU);
      c.arc(0, 0, 14, 0, TAU, true);
      outlined(c, grad(c, col, 60));
    },
    "s-arch": (c, col) => {
      c.beginPath();
      c.moveTo(-30, 30);
      c.lineTo(-30, -2);
      c.arc(0, -2, 30, Math.PI, 0);
      c.lineTo(30, 30);
      c.lineTo(14, 30);
      c.lineTo(14, -2);
      c.arc(0, -2, 14, 0, Math.PI, true);
      c.lineTo(-14, 30);
      c.closePath();
      outlined(c, grad(c, col, 60));
    },

    "g-orb": (c, col) => glass(c, col, () => { c.beginPath(); c.arc(0, 0, 30, 0, TAU); }),
    "g-gem": (c, col) => glass(c, col, () => poly(c, [[-30, -8], [-16, -26], [16, -26], [30, -8], [0, 30]]), () => {
      strokeLines(c, [[-30, -8, 30, -8], [-16, -26, -8, -8], [16, -26, 8, -8], [-8, -8, 0, 30], [8, -8, 0, 30]], "rgba(255,255,255,.5)", 1.5);
    }),
    "g-tube": (c, col, t) => glass(c, col, () => {
      c.beginPath();
      c.roundRect(-14, -44, 28, 88, 14);
    }, () => {
      // жидкость с пузырьками
      c.fillStyle = alpha(col, 0.55);
      c.fillRect(-14, 0, 28, 44);
      c.fillStyle = "rgba(255,255,255,.6)";
      for (let i = 0; i < 4; i++) {
        const p = reduce ? i / 4 : (t * 0.6 + i / 4) % 1;
        c.beginPath();
        c.arc(-5 + (i % 2) * 9, 40 - p * 40, 2.5, 0, TAU);
        c.fill();
      }
    }),

    "fx-ring": (c, col, t) => {
      for (let i = 0; i < 3; i++) {
        const p = reduce ? (i + 1) / 4 : (t * 0.8 + i / 3) % 1;
        c.globalAlpha = 1 - p;
        c.beginPath();
        c.arc(0, 0, 8 + p * 38, 0, TAU);
        c.lineWidth = 6 * (1 - p) + 1;
        c.strokeStyle = col;
        c.stroke();
      }
      c.globalAlpha = 1;
    },
    "fx-portal": (c, col, t) => {
      c.rotate(reduce ? 0 : -t * 2);
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        for (let k = 0; k <= 30; k++) {
          const a = (k / 30) * Math.PI * 1.6 + (i * TAU) / 4, r = 4 + (k / 30) * 36;
          c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        c.lineWidth = 5;
        c.strokeStyle = i % 2 ? shade(col, 0.4) : col;
        c.stroke();
      }
      c.beginPath();
      c.arc(0, 0, 8, 0, TAU);
      c.fillStyle = "#0f0a24";
      c.fill();
    },
    "fx-glitch": (c, col, t) => {
      const step = reduce ? 0 : Math.floor(t * 10);
      for (let i = 0; i < 7; i++) {
        const r = (k) => (((Math.sin((i + step * 3.1) * 12.9 + k * 78.2) * 43758.5) % 1) + 1) % 1;
        c.fillStyle = [col, "#ff3b5c", "#22c7f0", "#ffffff"][i % 4];
        c.globalAlpha = 0.5 + r(3) * 0.5;
        c.fillRect(-36 + r(1) * 50, -30 + r(2) * 56, 10 + r(4) * 30, 3 + r(5) * 8);
      }
      c.globalAlpha = 1;
    },
    "fx-laser": (c, col, t) => {
      const k = reduce ? 1 : 0.7 + Math.sin(t * 20) * 0.3;
      c.fillStyle = alpha(col, 0.35 * k);
      c.fillRect(-60, -9 * k, 120, 18 * k);
      c.fillStyle = col;
      c.fillRect(-60, -4, 120, 8);
      c.fillStyle = "#fff";
      c.fillRect(-60, -1.5, 120, 3);
      for (const x of [-60, 60]) {
        c.beginPath();
        c.arc(x, 0, 9, 0, TAU);
        outlined(c, shade(col, -0.3), 3);
      }
    },

    "d-tree": (c, col) => {
      c.fillStyle = "#6b4a2b";
      c.fillRect(-5, 26, 10, 18);
      for (const [y, w2] of [[-44, 16], [-24, 24], [-2, 32]]) {
        poly(c, [[0, y], [w2, y + 30], [-w2, y + 30]]);
        outlined(c, grad(c, col, 60, 0.2, -0.3), 3);
      }
    },
    "d-cactus": (c, col) => {
      c.beginPath();
      c.roundRect(-9, -40, 18, 84, 9);
      c.roundRect(-28, -12, 12, 30, 6);
      c.roundRect(16, -24, 12, 26, 6);
      c.rect(-20, 10, 12, 8);
      c.rect(8, -6, 12, 8);
      outlined(c, grad(c, col, 80, 0.2, -0.3), 3);
    },
    "d-skull": (c, col) => {
      c.beginPath();
      c.arc(0, -6, 26, Math.PI * 0.85, Math.PI * 0.15);
      c.lineTo(14, 26);
      c.lineTo(-14, 26);
      c.closePath();
      outlined(c, col, 3);
      c.fillStyle = OUTLINE;
      for (const x of [-10, 10]) {
        c.beginPath();
        c.ellipse(x, -4, 7, 8, 0, 0, TAU);
        c.fill();
      }
      poly(c, [[0, 6], [-4, 13], [4, 13]]);
      c.fill();
      strokeLines(c, [[-6, 20, -6, 26], [0, 20, 0, 26], [6, 20, 6, 26]], OUTLINE, 2);
    },
    "d-eye": (c, col, t) => {
      const blink = reduce ? 1 : Math.min(1, Math.abs(Math.cos(t * 0.8)) * 8);
      const look = reduce ? 0 : Math.sin(t * 1.3) * 8;
      c.save();
      c.scale(1, Math.max(0.08, blink));
      c.beginPath();
      c.ellipse(0, 0, 30, 20, 0, 0, TAU);
      outlined(c, "#ffffff", 3);
      c.beginPath();
      c.arc(look, 0, 12, 0, TAU);
      c.fillStyle = col;
      c.fill();
      c.beginPath();
      c.arc(look, 0, 5, 0, TAU);
      c.fillStyle = OUTLINE;
      c.fill();
      c.restore();
    },
    "d-coin": (c, col, t) => {
      c.scale(reduce ? 1 : Math.max(0.12, Math.abs(Math.cos(t * 2.5))), 1);
      c.beginPath();
      c.arc(0, 0, 26, 0, TAU);
      outlined(c, grad(c, col, 52, 0.4, -0.3), 3);
      c.beginPath();
      c.arc(0, 0, 17, 0, TAU);
      c.strokeStyle = shade(col, -0.35);
      c.lineWidth = 3;
      c.stroke();
      c.font = "900 20px Unbounded, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = shade(col, -0.45);
      c.fillText("★", 0, 1);
    },
    "d-key": (c, col) => {
      c.beginPath();
      c.arc(-16, 0, 14, 0, TAU);
      c.arc(-16, 0, 6, 0, TAU, true);
      c.rect(-4, -4, 36, 8);
      c.rect(20, 4, 5, 10);
      c.rect(28, 4, 4, 7);
      outlined(c, grad(c, col, 30, 0.4, -0.3), 3);
    },
    "d-torch": (c, col, t) => {
      c.beginPath();
      c.moveTo(-7, -6);
      c.lineTo(7, -6);
      c.lineTo(4, 44);
      c.lineTo(-4, 44);
      c.closePath();
      outlined(c, "#8b5a2b", 3);
      const g = c.createRadialGradient(0, -22, 0, 0, -22, 48);
      g.addColorStop(0, alpha(col, 0.45));
      g.addColorStop(1, alpha(col, 0));
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, -22, 48, 0, TAU);
      c.fill();
      for (const [k, fill] of [[1, col], [0.55, "#ffe14a"]]) {
        const w = reduce ? 0 : Math.sin(t * 13 + k * 3) * 3;
        c.beginPath();
        c.moveTo(-10 * k, -6);
        c.quadraticCurveTo(-14 * k, -24 * k - 6, w, -40 * k - 6);
        c.quadraticCurveTo(14 * k, -24 * k - 6, 10 * k, -6);
        c.closePath();
        c.fillStyle = fill;
        c.fill();
      }
    },
    "d-bush": (c, col) => {
      c.beginPath();
      for (const [x, y, r] of [[-20, 8, 15], [0, -4, 20], [20, 8, 15], [-8, 12, 14], [10, 12, 14]]) {
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, TAU);
      }
      c.lineWidth = 7;
      c.strokeStyle = OUTLINE;
      c.stroke();
      c.fillStyle = col;
      c.fill();
      c.fillStyle = "rgba(255,255,255,.25)";
      c.beginPath();
      c.arc(-4, -10, 7, 0, TAU);
      c.fill();
    },
    "d-mushroom": (c, col) => {
      c.beginPath();
      c.roundRect(-8, 0, 16, 28, 6);
      outlined(c, "#f3eefe", 3);
      c.beginPath();
      c.arc(0, 2, 28, Math.PI, 0);
      c.closePath();
      outlined(c, col, 3);
      c.fillStyle = "#fff";
      for (const [x, y, r] of [[-14, -8, 5], [6, -16, 6], [16, -4, 4]]) {
        c.beginPath();
        c.arc(x, y, r, 0, TAU);
        c.fill();
      }
    },
    "d-planet": (c, col, t) => {
      c.beginPath();
      c.arc(0, 0, 24, 0, TAU);
      const g = c.createRadialGradient(-8, -8, 2, 0, 0, 24);
      g.addColorStop(0, shade(col, 0.4));
      g.addColorStop(1, shade(col, -0.45));
      outlined(c, g, 3);
      c.save();
      c.rotate(-0.4 + (reduce ? 0 : Math.sin(t * 0.7) * 0.05));
      c.beginPath();
      c.ellipse(0, 0, 40, 10, 0, 0.1 * Math.PI, 0.9 * Math.PI, true);
      c.lineWidth = 5;
      c.strokeStyle = shade(col, 0.5);
      c.stroke();
      c.restore();
    },
  });

  /** Внешний вид настраивается у всего, кроме триггеров: у них только значение. */
  const rotatable = (k) => !isTrigger(k);

  /** Настройки вида по умолчанию: старые уровни их не хранят. */
  const LOOK = { s: 1, r: 0, w: 1, h: 1, fx: false, fy: false, a: 1, z: 0, g: 0 };

  /** Блок или декорация: поворот, растяжение и отражение вокруг центра, затем прозрачность и свечение. */
  function draw(c, o, t) {
    const fn = DRAW[o.k];
    if (!fn) return;
    const s = o.s || 1, color = colorOf(o);
    c.save();
    if (o.g > 0) {
      // свечение — тень цвета объекта; shadowBlur считается в пикселях экрана, поэтому переводим из единиц сцены
      const m = c.getTransform();
      c.shadowColor = color;
      c.shadowBlur = o.g * 40 * s * (Math.hypot(m.a, m.b) || 1);
    }
    if (o.r) c.rotate((o.r * Math.PI) / 180);
    c.scale(s * (o.w || 1) * (o.fx ? -1 : 1), s * (o.h || 1) * (o.fy ? -1 : 1));
    if (o.a != null && o.a < 1) c.globalAlpha *= Math.max(0.1, o.a);
    fn(c, color, t, o);
    c.restore();
  }

  const GLYPHS = {
    "t-bg": "▣", "t-ground": "▤", "t-bgimg": "▲", "t-effect": "❄", "t-dark": "◑", "t-offset": "✥", "t-msg": "T",
    "t-move": "⇄", "t-rotate": "↻", "t-spin": "✣", "t-scale": "⤢", "t-alpha": "◌", "t-toggle": "⏻",
    "t-gcolor": "◆", "t-pulse": "✺", "t-stop": "■",
    "t-oscill": "↕", "t-orbit": "◎", "t-camspin": "⟲", "t-camreset": "⌂", "t-hue": "◈", "t-letterbox": "▭", "t-invert": "◐",
  };

  /** Подпись триггера в редакторе: название и главное значение, у анимаций — группа. */
  function triggerLabel(o) {
    const kind = KINDS[o.k], ui = kind.ui || {};
    const opts = optionsOf(o.k);
    let text = kind.name;
    if (opts) text = (opts.find((p) => p[0] === o.v) || ["", kind.name])[1];
    else if (ui.p) {
      const legacy = (o.k === "t-zoom" || o.k === "t-tilt") && o.v != null && o.v !== "" && Number.isFinite(+o.v);
      const v = legacy ? +o.v : o.p ?? ui.p[4];
      const unit = ui.p[5];
      text = `${kind.name} ${unit === "%" ? Math.round(v * 100) + "%" : unit === "×" ? "×" + v : Math.round(v * 10) / 10 + unit}`;
    } else if (ui.text && o.v) text = `«${String(o.v).slice(0, 12)}»`;
    if (ui.gr) text += ` · гр.${o.gr || "все"}`;
    return text;
  }

  /** Значок триггера в редакторе: кружок с картинкой и подпись значения. В матче триггеры не видны. */
  function drawTrigger(c, o, selected, label = true) {
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
      default: {
        // у новых триггеров значок — знак в кружке
        c.font = "900 17px 'Segoe UI Symbol', 'Noto Sans Symbols 2', sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(GLYPHS[o.k] || "?", 0, 1);
        break;
      }
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
    if (!label) return;
    const text = triggerLabel(o);
    c.font = "900 13px Nunito, sans-serif";
    c.textAlign = "center";
    c.lineJoin = "round";
    c.lineWidth = 4;
    c.strokeStyle = OUTLINE;
    c.strokeText(text, 0, 44);
    c.fillStyle = "#fff";
    c.fillText(text, 0, 44);
  }

  /** Значок вида k для палитры: canvas size×size, объект вписан целиком. */
  function icon(k, size = 44) {
    const cv = document.createElement("canvas");
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = cv.height = Math.round(size * dpr);
    cv.style.width = cv.style.height = size + "px";
    const c = cv.getContext("2d");
    c.scale(dpr, dpr);
    c.translate(size / 2, size / 2);
    const o = create(k, 0, 0, 0);
    const reach = isTrigger(k) ? 30 : k === "text" ? 60 : k === "lamp" ? 22 : KINDS[k].r;
    const s = (size / 2 - 2) / reach;
    c.scale(s, s);
    if (isTrigger(k)) drawTrigger(c, o, false, false);
    else if (k === "text") {
      c.font = "900 44px Unbounded, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = 8;
      c.strokeStyle = OUTLINE;
      c.strokeText("Аа", 0, 2);
      c.fillStyle = "#fff";
      c.fillText("Аа", 0, 2);
    } else draw(c, o, 0);
    return cv;
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
    const o = { k, c, x: Math.round(x), y: Math.round(y), ...LOOK, v: kind.v ?? (colored(k) ? kind.color : null), gr: 0 };
    if (isTrigger(k)) {
      const ui = kind.ui || {};
      // настройки триггера по умолчанию: числа из ui, плавность «плавно»
      o.p = ui.p ? ui.p[4] : 0;
      o.q = ui.q ? ui.q[4] : 0;
      o.d = typeof ui.d === "number" ? ui.d : 0;
      o.e = 1;
      if (ui.color === "Цвет дизайна") o.v = kind.color;
    }
    return o;
  }

  return {
    KINDS, CATS, COLORS, OPTIONS, SPIKE, LOOK, isTrigger, colored, colorOf, optionsOf, rotatable, radius, hexRgb, palette,
    draw, drawTrigger, triggerLabel, icon, create, spikes, wall,
  };
})();
