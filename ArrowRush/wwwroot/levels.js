"use strict";

// Уровни игроков, как в GD: список опубликованных и своих, редактор и публикация.
// Сервер хранит уровни и собирает из ячеек настоящий уровень (LevelEndpoints.cs, LevelGenerator.FromEditor);
// здесь показ, правка и запуск. Опубликовать можно только уровень, который автор прошёл в «Тесте» после последней правки.
const levels = (() => {
  const $ = (id) => document.getElementById(id);

  // как в GameRules.cs: сервер проверяет то же самое
  const MIN_CELLS = 5, MAX_CELLS = 400, MIN_FILL = 0.3, MAX_FILL = 3, NAME_MAX = 32, ABOUT_MAX = 140;
  const MAX_OBJECTS = 400, OBJECT_REACH = 2000;
  const ROT = [-90, 0, 90, 180]; // стрелка 0..3 → поворот значка #arrow (он смотрит вверх)
  const KEYS = { ArrowLeft: 0, KeyA: 0, ArrowUp: 1, KeyW: 1, ArrowRight: 2, KeyD: 2, ArrowDown: 3, KeyS: 3 };
  const PACES = [[false, "Обычный"], [true, "Быстрый"]];
  const DIFFS = [["easy", "Лёгкая"], ["normal", "Нормальная"], ["hard", "Сложная"]];
  const SORTS = [["new", "Новые"], ["popular", "Популярные"], ["liked", "По лайкам"]];

  // особые ячейки: span — сколько ячеек за ней меняется (как LevelGenerator.EditorSpecials)
  const ev = (kind) => course.eventInfo[kind].color;
  const SPECIALS = {
    chart: { name: "Чарт", color: "#f2ad16", span: 10, hint: "Следующие 10 ячеек становятся такой же стрелкой, как сам чарт" },
    swam: { name: "Свам", color: "#39e6ff", span: 6, hint: "Прилетает НЛО: следующие 6 ячеек — пилы, через них прыгают любой стрелкой" },
    over: { name: "Овердрайв", color: ev("over"), span: 6, hint: "Следующие 6 ячеек заполняются быстрее, космос в огне" },
    storm: { name: "Шторм", color: ev("storm"), span: 6, hint: "Следующие 6 ячеек в темноте: дальние видно только при молнии" },
    flip: { name: "Переворот", color: ev("flip"), span: 6, hint: "Следующие 6 ячеек мир вверх ногами, стрелки те же" },
    rainbow: { name: "Радуга", color: ev("rainbow"), span: 6, hint: "Каждая вторая из следующих 6 ячеек — каменная стена: 10 нажатий любой стрелкой" },
    rast: { name: "Раст", color: ev("rast"), span: 0, tag: "+40", hint: "Добавляет 40 ячеек из двух стрелок, сзади догоняет чёрная дыра" },
    cloud: { name: "Кловд", color: ev("cloud"), span: 0, tag: "+8", hint: "Добавляет 8 летящих стрелок: гусеница уклоняется, ↑ — потолок, ↓ — пол" },
  };

  // значки инструментов (24×24): стрелки берутся из #arrow, остальное здесь
  const ICONS = {
    pick: '<path d="M9 3.5a1.5 1.5 0 0 1 3 0V10h.5V8.5a1.5 1.5 0 0 1 3 0V10h.5V9.5a1.5 1.5 0 0 1 3 0V15c0 3.9-2.6 6.5-6.3 6.5-2.4 0-4-1-5.4-3L4 13.6a1.5 1.5 0 0 1 2.4-1.8L9 14.6z"/>',
    plain: '<path fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zm0 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 1 1 0-11z"/>',
    chart: '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3l-6.1 3.3 1.4-6.8-5.1-4.7 6.9-.8z"/>',
    swam: '<path d="M12 4.5a5 5 0 0 0-5 5H5.5C3.5 9.5 2 10.8 2 12.3S3.5 15 5.5 15h13c2 0 3.5-1.2 3.5-2.7s-1.5-2.8-3.5-2.8H17a5 5 0 0 0-5-5zM7.5 16.5 5.5 21h2.3l1.8-4.5zm9 0 1.8 4.5h2.2l-2-4.5z"/>',
    over: '<use href="#flame"/>',
    storm: '<use href="#bolt"/>',
    flip: '<use href="#mirror"/>',
    rainbow: '<path fill-rule="evenodd" d="M1.5 19a10.5 10.5 0 0 1 21 0h-3.5a7 7 0 0 0-14 0zM7 19a5 5 0 0 1 10 0h-2a3 3 0 0 0-6 0z"/>',
    rast: '<path fill-rule="evenodd" d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19zm0 5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 1 1 0-9z"/>',
    cloud: '<path d="M2.5 16a3 3 0 1 0 6 0 3 3 0 1 0-6 0zM7.5 13.5a3.3 3.3 0 1 0 6.6 0 3.3 3.3 0 1 0-6.6 0zM13 10.5a4 4 0 1 0 8 0 4 4 0 1 0-8 0z"/>',
    erase: '<path d="M14.6 3.2a1.6 1.6 0 0 1 2.2 0l4 4a1.6 1.6 0 0 1 0 2.2L12 18.2H6.8l-3.6-3.6a1.6 1.6 0 0 1 0-2.2zM4 20h16v2H4z"/>',
    "o-wall": '<path d="M3 4h8v4H3zM13 4h8v4h-8zM3 10h4v4H3zM9 10h8v4H9zM19 10h2v4h-2zM3 16h8v4H3zM13 16h8v4h-8z"/>',
    "o-spike": '<path d="M2 20 6 9l4 11zM8 20l4-15 4 15zM14 20l4-11 4 11z"/>',
    "o-fake": '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20zm-.2 4.5c2.6 0 4.2 1.4 4.2 3.4 0 1.6-.9 2.4-2 3.1-.8.5-1 .8-1 1.6v.4h-2.6v-.6c0-1.4.5-2.1 1.6-2.8.9-.6 1.3-.9 1.3-1.6 0-.7-.6-1.2-1.5-1.2-1 0-1.6.6-1.7 1.5H7.5c.1-2.2 1.7-3.8 4.3-3.8zm-1.5 10.2h3v2.8h-3z"/>',
    "o-none": '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20zm0 3a7 7 0 0 1 5.6 11.2L7.8 6.4A7 7 0 0 1 12 5zM6.4 7.8l9.8 9.8A7 7 0 0 1 6.4 7.8z"/>',
    "obj-block": '<path d="M3 3h18v18H3z"/>',
    "obj-half": '<path d="M3 11h18v9H3z"/>',
    "obj-ramp": '<path d="M3 21 21 3v18z"/>',
    "obj-pillar": '<path d="M8 2h8v20H8z"/>',
    "obj-text": '<path d="M3 3h18v5h-3V6.5h-4.5V18H16v3H8v-3h2.5V6.5H6V8H3z"/>',
    "obj-star": '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3l-6.1 3.3 1.4-6.8-5.1-4.7 6.9-.8z"/>',
    "obj-cloud": '<path d="M7 19a5 5 0 0 1-.6-10A6 6 0 0 1 18 9.5a4.8 4.8 0 0 1-.5 9.5z"/>',
    "obj-ring": '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20zm0 4.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 1 1 0-11z"/>',
    "obj-crystal": '<path d="M12 1.5 18 9l-6 13.5L6 9z"/>',
    "obj-lamp": '<path d="M12 2a7 7 0 0 1 4 12.7V17H8v-2.3A7 7 0 0 1 12 2zM8.5 18.5h7V20a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z"/>',
    "obj-t-color": '<path d="M12 2.5S5 10.3 5 14.5a7 7 0 0 0 14 0C19 10.3 12 2.5 12 2.5z"/>',
    "obj-t-flash": '<path d="M11 1h2v6h-2zM11 17h2v6h-2zM1 11h6v2H1zM17 11h6v2h-6zM4.2 5.6l1.4-1.4 4.2 4.2-1.4 1.4zM14.2 15.6l1.4-1.4 4.2 4.2-1.4 1.4zM4.2 18.4l4.2-4.2 1.4 1.4-4.2 4.2zM14.2 8.4l4.2-4.2 1.4 1.4-4.2 4.2z"/>',
    "obj-t-shake": '<path d="M1 12 5 4l4 16 4-16 4 16 4-8 2 1-4 9-4-14-4 14-4-14-2.6 5z"/>',
    "obj-t-zoom": '<path fill-rule="evenodd" d="M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-2 2-5.4-5.4A8 8 0 1 1 10 2zm0 3a5 5 0 1 0 0 10 5 5 0 1 0 0-10zM9 7h2v2h2v2h-2v2H9v-2H7V9h2z"/>',
    "obj-t-tilt": '<path d="M3 18.5 19.5 2 22 4.5 5.5 21H3zM2 22h20v1H2z"/>',
  };
  const ARROW_NAMES = ["Влево", "Вверх", "Вправо", "Вниз"];

  // быстрый тест в превью считает как матч: числа из GameRules.cs и Difficulties
  const QUICK = {
    spikeFast: 0.6, spikeGrace: 0.3, wallHits: 10, wallLives: 10, wallLife: 0.9, overdrive: 0.6,
    swamIntro: 1.8, swamCell: 0.9, jump: 0.75, clearFrom: 0.12, clearTo: 0.88,
  };
  const QUICK_DIFF = {
    easy: { idle: 0.2, wrong: 0.7, stun: 0.35 },
    normal: { idle: 0.35, wrong: 1.2, stun: 0.5 },
    hard: { idle: 0.55, wrong: 1.7, stun: 0.7 },
  };

  // вкладки палитры снизу, как в GD: [id, название, значок — инструмент, чей значок рисуется на вкладке]
  const CATS = [
    ["cells", "Стрелки", "a1"],
    ["special", "Особые ячейки", "chart"],
    ["obstacles", "Препятствия", "o-spike"],
    ...levelobj.CATS.map(([id, name, k]) => [id, name, "obj-" + k]),
  ];
  // препятствия на ячейке, как LevelGenerator.EditorObstacles
  const OBSTACLES = {
    wall: { name: "Стена", color: "#8a8399", hint: "ячейку ломают 10 нажатиями любой стрелки" },
    spike: { name: "Шипы", color: "#ff3b5c", hint: "ячейка проходит сама, пока ничего не нажато; нажатие — удар" },
    fake: { name: "Обман", color: "#d36bff", hint: "издалека видна противоположная стрелка, настоящая открывается, когда до неё дошёл" },
  };

  // инструменты: что делает клик по превью. mode — для edview: cell, object, pick или erase.
  // «Выбор» и «Ластик» — это режимы «Правка» и «Удалить» слева, в палитре их нет
  const TOOLS = [
    { id: "pick", mode: "pick", name: "Правка", color: "var(--muted-room)", hint: "клик выбирает ячейку или объект, объект можно тащить, протяжка по пустому месту листает уровень" },
    ...[0, 1, 2, 3].map((a) => ({ id: "a" + a, cat: "cells", arrow: a, name: ARROW_NAMES[a], color: `var(--a${a})`, hint: "клик или протяжка по ячейкам ставит эту стрелку, «+» в конце добавляет ячейку" })),
    { id: "plain", cat: "cells", name: "Обычная", color: "#c3c7d9", hint: "клик убирает особую ячейку" },
    ...Object.entries(SPECIALS).map(([id, s]) => ({ id, cat: "special", special: true, name: s.name, color: s.color, hint: s.hint })),
    ...Object.entries(OBSTACLES).map(([id, s]) => ({ id: "o-" + id, cat: "obstacles", obstacle: id, name: s.name, color: s.color, hint: "клик по ячейке: " + s.hint })),
    { id: "o-none", cat: "obstacles", obstacle: null, name: "Убрать", color: "#c3c7d9", hint: "клик убирает препятствие с ячейки" },
    ...Object.entries(levelobj.KINDS).filter(([, s]) => !s.old).map(([k, s]) => ({
      id: "obj-" + k, cat: s.cat, object: k, name: s.name, color: s.color,
      hint: levelobj.isTrigger(k) ? `клик ставит триггер к ближайшей ячейке: ${s.hint}` : "клик ставит объект туда, куда нажал; в «Правке» его можно тащить",
    })),
    { id: "erase", mode: "erase", name: "Удалить", color: "#ff3b5c", hint: "клик удаляет объект или ячейку" },
  ];
  for (const t of TOOLS) t.mode ??= t.object ? "object" : "cell";
  const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
  const ROWS = 3;      // строк в сетке палитры
  const GRID = 30;     // шаг сетки объектов, в единицах сцены

  let opts = null;     // { conn, show, screen, onPlay, me }
  let view = "online"; // вкладка списка: online или mine
  let sort = "new";
  let searchTimer = 0;
  let ed = null;       // открытый уровень: { id, name, about, fast, difficulty, theme, cells, objects, verified, published, dirty }
  let sel = 0;         // выбранная ячейка
  let selObj = null;   // выбранный объект (блок, декор, триггер) или null
  let cat = "cells";   // вкладка палитры
  let tool = "pick";   // что сейчас делает клик: pick в «Правке», erase в «Удалить», иначе buildTool
  let buildTool = "a1"; // что выбрано в палитре для режима «Строить»
  let page = 0;        // страница палитры
  let swipe = false;   // «Протяжка»: объекты ставятся один за другим, пока ведёшь мышью
  let snap = true;     // «Сетка»: объекты встают по клеткам GRID×GRID
  let focused = -1;    // к какой ячейке последний раз ехала камера превью
  let zoneMap = new Map(); // участки особых ячеек, см. zones()

  async function call(method, path, body) {
    const res = await fetch("/api/levels" + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || "Сервер недоступен");
    return data;
  }

  const arrowIcon = (a) => `<svg viewBox="0 0 24 24" style="rotate:${ROT[a]}deg" aria-hidden="true"><use href="#arrow"/></svg>`;
  const themeOf = (id) => lobby.themes.find((t) => t[0] === id) || lobby.themes[0];
  const label = (items, key) => (items.find((i) => i[0] === key) || items[0])[1];

  /** Сыграть уровень. back — куда вернёт «В меню» на итогах. */
  async function play(id, bot, back, errorEl) {
    music.unlock();
    opts.onPlay({ id, bot, back });
    try {
      await opts.conn.invoke("PlayLevel", id, bot);
    } catch (e) {
      const msg = String((e && e.message) || "").split("HubException: ")[1];
      if (errorEl) errorEl.textContent = msg || "Не удалось запустить уровень";
    }
  }

  // ---------- Список ----------

  function open() {
    opts.show("levels");
    setView(view);
  }

  function setView(v) {
    view = v;
    const tabs = [...document.querySelectorAll("#levels-tabs .tab")];
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === v));
    $("levels-tabs").dataset.active = tabs.findIndex((t) => t.dataset.view === v);
    $("levels-online-bar").hidden = v !== "online";
    $("levels-mine-bar").hidden = v !== "mine";
    load();
  }

  async function load() {
    $("levels-error").textContent = "";
    const q = $("levels-search").value.trim();
    const wanted = view;
    try {
      const list = view === "mine"
        ? await call("GET", "/mine")
        : await call("GET", `/?sort=${sort}&q=${encodeURIComponent(q)}`);
      if (wanted === view) renderList(list);
    } catch (e) {
      $("levels-error").textContent = e.message;
    }
  }

  function renderList(list) {
    const ul = $("levels-list");
    ul.replaceChildren(...list.map(row));
    $("levels-empty").hidden = list.length > 0;
    $("levels-empty").textContent = view === "mine"
      ? "У тебя пока нет уровней. Нажми «Новый уровень» и собери первый."
      : $("levels-search").value.trim() ? "Ничего не нашлось" : "Пока никто не выложил уровень. Будь первым!";
  }

  function row(l) {
    const li = document.createElement("li");
    li.className = "level-row glass";
    const [, themeName, swatch] = themeOf(l.theme);

    const tile = document.createElement("div");
    tile.className = "level-tile";
    tile.style.background = swatch;
    tile.title = `Дизайн: ${themeName}`;
    tile.innerHTML = `<b>${l.cells}</b><span>ячеек</span>`;

    const main = document.createElement("div");
    main.className = "level-main";
    const name = document.createElement("div");
    name.className = "level-name";
    name.textContent = l.name;
    const sub = document.createElement("div");
    sub.className = "level-sub";
    sub.textContent = `${l.mine ? "мой" : l.author} · ${label(PACES, l.fast)} · ${label(DIFFS, l.difficulty)}`;
    main.append(name, sub);
    if (l.about) {
      const about = document.createElement("div");
      about.className = "level-about";
      about.textContent = l.about;
      main.appendChild(about);
    }
    const stats = document.createElement("div");
    stats.className = "level-stats";
    if (l.published) {
      const rate = l.plays ? Math.round((l.clears / l.plays) * 100) : 0;
      stats.innerHTML = `<span title="Сыграли">▶ ${l.plays}</span><span title="Прошли">✓ ${rate}%</span><span title="Лайки">♥ ${l.likes}</span>`;
    } else {
      stats.innerHTML = l.verified
        ? `<span class="level-badge ok">Пройден — можно публиковать</span>`
        : `<span class="level-badge">Черновик</span>`;
    }
    main.appendChild(stats);

    const buttons = document.createElement("div");
    buttons.className = "level-buttons";
    const btn = (text, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn small " + cls;
      b.textContent = text;
      b.addEventListener("click", fn);
      buttons.appendChild(b);
      return b;
    };
    const err = $("levels-error");
    btn("Играть", "primary", () => play(l.id, false, "levels", err));
    btn("С ботом", "ghost", () => play(l.id, true, "levels", err));
    if (l.mine) {
      btn(l.published ? "Открыть" : "Изменить", "ghost", () => edit(l.id));
      btn("Удалить", "ghost", async () => {
        if (!confirm(`Удалить уровень «${l.name}»? Вернуть его будет нельзя.`)) return;
        try {
          await call("DELETE", `/${l.id}`);
          load();
        } catch (e) {
          err.textContent = e.message;
        }
      });
    } else {
      const like = btn(`♥ ${l.likes}`, l.liked ? "primary like" : "ghost like", async () => {
        try {
          const r = await call("POST", `/${l.id}/like`);
          l.liked = r.liked;
          l.likes = r.likes;
          like.textContent = `♥ ${r.likes}`;
          like.className = "btn small like " + (r.liked ? "primary" : "ghost");
        } catch (e) {
          err.textContent = e.message;
        }
      });
      like.title = "Лайк";
    }

    li.append(tile, main, buttons);
    return li;
  }

  // ---------- Редактор ----------

  function randomCells(n, from = []) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const prev = [...from, ...out];
      let a;
      do a = Math.floor(Math.random() * 4);
      // как у генератора: не больше двух одинаковых подряд
      while (prev.length >= 2 && a === prev[prev.length - 1].a && a === prev[prev.length - 2].a);
      out.push({ a, f: Math.round((0.6 + Math.random()) * 20) / 20, s: null, o: null });
    }
    return out;
  }

  async function edit(id) {
    quickTest(false);
    $("ed-error").textContent = "";
    if (id) {
      try {
        const d = await call("GET", `/${id}`);
        ed = { ...d, cells: d.cells.map((c) => ({ a: c.a, f: c.f, s: c.s || null, o: c.o || null })), objects: (d.objects || []).map(cleanObj), dirty: false };
      } catch (e) {
        $("levels-error").textContent = e.message;
        return;
      }
    } else {
      ed = { id: null, name: "", about: "", fast: false, difficulty: "normal", theme: "auto", cells: randomCells(12), objects: [], verified: false, published: false, dirty: true };
    }
    sel = 0;
    selObj = null;
    opts.show("editor");
    edview.reset();
    focused = sel;
    codeConfirmed = false;
    toggleCode(false);
    renderEditor();
    if (!id) $("ed-name").focus();
  }

  /** Что меняет каждая особая ячейка: номер ячейки → { kind, from } для ячеек её участка. */
  function zones() {
    const z = new Map();
    ed.cells.forEach((c, i) => {
      if (!c.s) return;
      for (let k = 1; k <= SPECIALS[c.s].span && i + k < ed.cells.length; k++) z.set(i + k, { kind: c.s, from: i });
    });
    return z;
  }

  /** Те же правила, что на сервере (LevelEndpoints.Validate); null — всё в порядке. */
  function problem() {
    if (!ed.name.trim()) return "Назови уровень";
    if (ed.cells.length < MIN_CELLS) return `Нужно хотя бы ${MIN_CELLS} ячеек`;
    if (ed.cells.length > MAX_CELLS) return `Не больше ${MAX_CELLS} ячеек`;
    let busyUntil = -1;
    for (let i = 0; i < ed.cells.length; i++) {
      const { s, o } = ed.cells[i];
      if (o && i <= busyUntil) return `Ячейка ${i + 1}: препятствие внутри участка особой ячейки`;
      if (!s) continue;
      if (i <= busyUntil) return `Ячейка ${i + 1}: внутри участка прошлой особой ячейки`;
      if (i + SPECIALS[s].span >= ed.cells.length) return `Ячейка ${i + 1}: за ней нужно ещё ${SPECIALS[s].span} ячеек`;
      busyUntil = i + SPECIALS[s].span;
    }
    if (ed.objects.length > MAX_OBJECTS) return `Не больше ${MAX_OBJECTS} объектов`;
    return null;
  }

  // ---------- Объекты: блоки, декор, триггеры ----------

  /** Объект в том виде, в каком его хранит сервер (LevelObject). Старые зум и наклон хранили число в v — оно переезжает в p. */
  const cleanObj = (o) => (o.k === "t-zoom" || o.k === "t-tilt") && o.v != null && o.v !== "" && Number.isFinite(+o.v)
    ? cleanObj({ ...o, p: +o.v, v: null, d: o.d || 0.6 })
    : ({
    k: o.k, c: o.c, x: o.x, y: o.y, v: o.v ?? null,
    s: o.s ?? 1, r: o.r || 0, w: o.w ?? 1, h: o.h ?? 1, fx: !!o.fx, fy: !!o.fy, a: o.a ?? 1, z: o.z ? 1 : 0, g: o.g || 0,
    // группа объекта и настройки триггера (trigrun.js)
    gr: o.gr || 0, p: o.p ?? 0, q: o.q ?? 0, d: o.d ?? 0, e: o.e ?? 1,
  });
  const clampReach = (v) => Math.round(Math.max(-OBJECT_REACH, Math.min(OBJECT_REACH, v)));

  /** Ячейки вставили: объекты остаются у своих ячеек. */
  function cellsInserted(at, n) {
    for (const ob of ed.objects) if (ob.c >= at) ob.c += n;
  }

  /** Ячейку удалили: объекты за ней сдвигаются, а её объекты переходят к соседке слева. */
  function cellRemoved(at) {
    for (const ob of ed.objects) if (ob.c > at || (ob.c === at && at > 0)) ob.c--;
  }

  /** Клик по превью инструментом объекта: новый объект у ячейки c, сдвинутый на x, y от её стрелки. */
  function placeObj(c, x, y) {
    if (locked()) return;
    if (ed.objects.length >= MAX_OBJECTS) {
      $("ed-error").textContent = `Не больше ${MAX_OBJECTS} объектов`;
      return;
    }
    const k = TOOL[tool].object;
    const ob = levelobj.create(k, c, levelobj.isTrigger(k) ? 0 : clampReach(x), clampReach(y));
    change(() => {
      ed.objects.push(ob);
      selObj = ob;
    });
  }

  function pickObj(ob) {
    if (selObj === ob) return;
    selObj = ob;
    renderObj();
    renderTools(); // «Поворот» и «Копия» работают с выбранным объектом
  }

  function eraseObj(ob) {
    change(() => {
      ed.objects.splice(ed.objects.indexOf(ob), 1);
      if (selObj === ob) selObj = null;
    });
  }

  /** «Поворот»: выбранный объект на 90° по часовой (точный угол — ползунком в панели). */
  function rotateObj() {
    if (!selObj || !levelobj.rotatable(selObj.k)) return;
    const ob = selObj;
    change(() => { ob.r = wrapAngle(Math.round((ob.r || 0) / 90) * 90 + 90); });
    renderObj(true);
  }

  /** Ширина объекта вида k размера s, округлённая до клеток сетки: шаг «Протяжки» и «Копии». */
  const swipeStep = (k, s = 1) => Math.max(GRID, Math.round((levelobj.KINDS[k].r * s * 1.8) / GRID) * GRID);

  /** «Копия»: такой же объект правее на свою ширину (по сетке — на целые клетки). */
  function cloneObj() {
    if (!selObj || locked()) return;
    if (ed.objects.length >= MAX_OBJECTS) {
      $("ed-error").textContent = `Не больше ${MAX_OBJECTS} объектов`;
      return;
    }
    const ob = { ...selObj };
    if (!levelobj.isTrigger(ob.k)) ob.x = clampReach(ob.x + swipeStep(ob.k, ob.s || 1));
    change(() => {
      ed.objects.push(ob);
      selObj = ob;
    });
  }

  // Настройки вида: [свойство, подпись, мин, макс, шаг, как показать]. Двойной клик по подписи — вернуть по умолчанию.
  const LOOK_SLIDERS = [
    ["s", "Размер", 0.25, 4, 0.05, (v) => `×${v.toFixed(2)}`],
    ["w", "Ширина", 0.25, 4, 0.05, (v) => `×${v.toFixed(2)}`],
    ["h", "Высота", 0.25, 4, 0.05, (v) => `×${v.toFixed(2)}`],
    ["r", "Поворот", -180, 180, 1, (v) => `${Math.round(v)}°`],
    ["a", "Прозрачность", 0.1, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
    ["g", "Свечение", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
  ];
  const LOOK_KEYS = ["s", "w", "h", "r", "a", "g", "fx", "fy", "z"];
  const EASES = [[0, "Ровно"], [1, "Плавно"], [2, "Замедление"], [3, "Отскок"]];
  const MAX_GROUP = 99; // как GameRules.EditorMaxGroup
  let styleClip = null; // «Копировать стиль»: вид и цвет, которые вставит «Вставить стиль»
  let objShown = null;  // какой объект сейчас в панели: панель не пересобирается, пока его правят

  /** Поворот в пределах −180…180. */
  const wrapAngle = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

  /** Как показать число с единицей из описания триггера. */
  const showUnit = (unit) => (v) => (unit === "%" ? `${Math.round(v * 100)}%` : unit === "×" ? `×${(+v).toFixed(2)}` : `${Math.round(v * 10) / 10}${unit}`);

  /** Маленькая картинка фона для выбора в триггере «Картинка фона». */
  function bgPreview(id) {
    const cv = document.createElement("canvas");
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = 92, h = 52;
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = w + "px";
    cv.style.height = h + "px";
    const c = cv.getContext("2d");
    c.scale(dpr, dpr);
    const pal = course.themes.violet;
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgb(${pal.sky.join(",")})`);
    g.addColorStop(1, `rgb(${pal.sky2.join(",")})`);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    bgart.draw(c, id, { w, h, camX: 0, scale: 0.1, time: 1 }, pal);
    return cv;
  }

  /**
   * Свойства выбранного объекта на половине превью, в две колонки. У блоков и декора: цвет (палитра) или текст,
   * вид (размер, растяжение, поворот, прозрачность, свечение), отражение, слой, группа, положение и стиль.
   * У триггеров — их настройки из levelobj (ui): цвет, выбор, текст, числа, длительность, плавность, группа.
   * Панель собирается, только когда выбран другой объект или force: пока тянешь ползунок или цвет, она живёт сама.
   */
  function renderObj(force = false) {
    const box = $("ed-obj");
    if (selObj && !ed.objects.includes(selObj)) selObj = null;
    box.hidden = !selObj;
    if (!selObj) {
      objShown = null;
      return;
    }
    if (selObj === objShown && !force) return;
    objShown = selObj;
    const ob = selObj, kind = levelobj.KINDS[ob.k], trigger = levelobj.isTrigger(ob.k), ui = kind.ui || {};
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined && text !== null) e.textContent = text;
      return e;
    };
    const button = (cls, text, fn, on) => {
      const b = el("button", cls + (on ? " on" : ""), text);
      b.type = "button";
      b.disabled = locked();
      b.addEventListener("click", fn);
      return b;
    };
    /** Правка, после которой панель остаётся как есть. */
    const set = (fn) => change(fn);
    const section = (title) => el("div", "ed-obj-sec", title);

    /** Ползунок: значение ob[key] (по умолчанию def), подпись дважды кликнуть — сбросить. */
    function slider(key, name, min, max, step, show, def) {
      const row = el("label", "ed-obj-slider");
      const title = el("span", null, name);
      title.title = "Двойной клик — по умолчанию";
      const range = el("input");
      Object.assign(range, { type: "range", min, max, step, disabled: locked() });
      const out = el("b");
      const sync = () => {
        const v = ob[key] ?? def;
        range.value = v;
        out.textContent = show(+v);
      };
      range.addEventListener("input", () => {
        set(() => { ob[key] = +range.value; });
        out.textContent = show(+range.value);
      });
      title.addEventListener("dblclick", (e) => {
        e.preventDefault();
        if (locked()) return;
        set(() => { ob[key] = def; });
        sync();
      });
      sync();
      row.append(title, range, out);
      return row;
    }

    /** Выбор одного из вариантов: chips [значение, подпись]; render(подпись, значение) может вернуть свою кнопку. */
    function choice(key, items, def, cls = "ed-obj-toggles", make) {
      const row = el("div", cls);
      const current = () => ob[key] ?? def;
      const buttons = items.map(([v, text]) => {
        const b = button("ed-chip", make ? null : text, () => {
          set(() => { ob[key] = v; });
          buttons.forEach((x, i) => x.classList.toggle("on", items[i][0] === v));
        }, current() === v);
        if (make) b.append(...make(v, text));
        return b;
      });
      row.append(...buttons);
      return row;
    }

    function numberInput(key, label, min, max, step, hint) {
      const wrap = el("label", "ed-obj-num", label);
      const input = el("input", "ed-input");
      Object.assign(input, { type: "number", min, max, step, value: Math.round(ob[key] || 0), disabled: locked() });
      if (hint) wrap.title = hint;
      input.addEventListener("input", () => {
        if (input.value === "" || !Number.isFinite(+input.value)) return;
        set(() => { ob[key] = Math.max(min, Math.min(max, Math.round(+input.value))); });
      });
      wrap.append(input);
      return wrap;
    }

    const head = el("div", "ed-obj-head");
    const close = button("ed-code-x", "×", () => pickObj(null));
    close.disabled = false;
    close.setAttribute("aria-label", "Снять выбор");
    head.append(el("b", null, kind.name), el("span", null, `у ячейки ${ob.c + 1}`), close);
    const rows = [head];
    if (trigger) rows.push(el("p", "ed-obj-hint", `Срабатывает, когда игрок проходит ячейку ${ob.c + 1}: ${kind.hint}.`));

    const left = el("div", "ed-obj-col"), right = el("div", "ed-obj-col");

    // ---- левая колонка: цвет, выбор из списка или текст
    if (levelobj.colored(ob.k)) {
      left.append(section("Цвет"));
      const picker = colorpick.create({
        value: ob.v,
        none: typeof ui.color === "string" ? ui.color : null,
        onInput: (v) => set(() => { ob.v = v; }),
      });
      if (locked()) picker.el.classList.add("off");
      left.append(picker.el);
    }
    const opts = levelobj.optionsOf(ob.k);
    if (opts && ui.opts === "bg") {
      left.append(section("Картинка"), choice("v", opts, kind.v, "ed-obj-bgs", (v, text) => [bgPreview(v), el("span", null, text)]));
    } else if (opts) {
      left.append(section(ui.opts === "effect" ? "Эффект" : "Вариант"), choice("v", opts, kind.v));
    }
    if (ui.text || (!trigger && !levelobj.colored(ob.k))) {
      // текст, надпись «Бах!», надпись триггера
      left.append(section("Текст"));
      const input = el("input", "ed-input");
      input.maxLength = ui.text || (ob.k === "text" ? 40 : 8);
      input.value = ob.v || "";
      input.disabled = locked();
      input.addEventListener("input", () => set(() => { ob.v = input.value; }));
      left.append(input);
    }

    if (trigger) {
      // ---- триггер: числа, длительность, плавность, группа
      const params = left.childElementCount ? right : left;
      if (ui.gr) {
        params.append(section("Группа"), numberInput("gr", "Группа", 0, MAX_GROUP, 1, "Какие объекты меняет триггер; 0 — все объекты уровня"));
        params.append(el("p", "ed-obj-hint", "Группу объекту задаёшь в его настройках. 0 — все объекты уровня."));
      }
      if (ui.p || ui.q || ui.d !== undefined) params.append(section("Настройки"));
      for (const key of ["p", "q"]) {
        if (!ui[key]) continue;
        const [name, min, max, step, def, unit] = ui[key];
        params.append(slider(key, name, min, max, step, showUnit(unit), def));
      }
      if (ui.d !== undefined) params.append(slider("d", ob.k === "t-msg" ? "Показ" : "Время", 0, ob.k === "t-msg" ? 10 : 5, 0.05, (v) => `${v.toFixed(2)} с`, ui.d));
      if (ui.e) params.append(section("Плавность"), choice("e", EASES, 1));
    } else {
      // ---- блоки и декор: вид, отражение, слой, группа, положение, стиль
      right.append(section("Вид"));
      for (const [key, name, min, max, step, show] of LOOK_SLIDERS) right.append(slider(key, name, min, max, step, show, levelobj.LOOK[key]));

      const toggles = el("div", "ed-obj-toggles");
      const toggle = (key, text, hint) => {
        const b = button("ed-chip", text, () => {
          set(() => { ob[key] = !ob[key]; });
          b.classList.toggle("on", !!ob[key]);
        }, !!ob[key]);
        b.title = hint;
        return b;
      };
      toggles.append(toggle("fx", "⇋ Отразить", "Отразить по горизонтали"), toggle("fy", "⇵ Отразить", "Отразить по вертикали"));
      right.append(toggles);

      const layer = choice("z", [[0, "За дорогой"], [1, "Перед дорогой"]], 0);
      layer.prepend(el("span", null, "Слой"));
      right.append(layer);

      const place = el("div", "ed-obj-pos");
      place.append(
        numberInput("gr", "Группа", 0, MAX_GROUP, 1, "Номер группы: её двигают, крутят и красят триггеры анимации; 0 — без группы"),
        numberInput("x", "X", -OBJECT_REACH, OBJECT_REACH, GRID),
        numberInput("y", "Y", -OBJECT_REACH, OBJECT_REACH, GRID),
      );
      right.append(section("Группа и положение от стрелки ячейки"), place);

      const style = el("div", "ed-obj-toggles");
      style.append(
        button("ed-chip", "Копировать стиль", () => {
          styleClip = Object.fromEntries(LOOK_KEYS.map((k) => [k, ob[k] ?? levelobj.LOOK[k]]));
          if (levelobj.colored(ob.k)) styleClip.v = ob.v;
          renderObj(true);
        }),
        button("ed-chip", "Вставить стиль", () => {
          const clip = { ...styleClip };
          if (!levelobj.colored(ob.k)) delete clip.v;
          set(() => Object.assign(ob, clip));
          renderObj(true);
        }),
        button("ed-chip", "Сбросить вид", () => {
          set(() => Object.assign(ob, levelobj.LOOK));
          renderObj(true);
        }),
      );
      style.children[1].disabled = locked() || !styleClip;
      (left.childElementCount ? left : right).append(section("Стиль"), style);
    }

    const cols = el("div", "ed-obj-cols");
    cols.append(left);
    if (right.childElementCount) cols.append(right);
    else cols.classList.add("one");
    rows.push(cols, button("btn ghost small", "Удалить объект", () => eraseObj(ob)));
    const scroll = box.scrollTop;
    box.replaceChildren(...rows);
    box.scrollTop = scroll;
  }

  const locked = () => ed.published;

  function change(fn) {
    if (locked()) return;
    fn();
    ed.dirty = true;
    ed.verified = false;
    renderEditor();
  }

  /** Следующее значение по кругу: карточки слева меняют темп, сложность и дизайн нажатием. */
  const next = (items, value) => items[(items.findIndex((i) => i[0] === value) + 1) % items.length][0];

  // ---------- Палитра снизу: режимы, вкладки, сетка по страницам ----------

  /** Значок инструмента: стрелка, свой SVG или нарисованный объект. */
  function toolIcon(t) {
    if (t.object) return levelobj.icon(t.object, 40);
    const span = document.createElement("span");
    span.className = "ed-tool-svg";
    span.innerHTML = t.arrow !== undefined ? arrowIcon(t.arrow) : `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICONS[t.id]}</svg>`;
    return span;
  }

  const toolButtons = new Map(); // id → кнопка: значки объектов рисуются один раз
  const emptySlots = [];

  function toolButton(t) {
    if (toolButtons.has(t.id)) return toolButtons.get(t.id);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ed-tool";
    b.dataset.tool = t.id;
    b.style.setProperty("--c", t.color);
    b.title = `${t.name}: ${t.hint}`;
    b.setAttribute("aria-label", t.name);
    b.append(toolIcon(t));
    b.addEventListener("click", () => setTool(t.id));
    toolButtons.set(t.id, b);
    return b;
  }

  /** Выбор в палитре: режим «Строить» с этим инструментом. */
  function setTool(id) {
    if (locked()) return;
    buildTool = id;
    tool = id;
    renderTools();
    renderSel();
  }

  /** Режим слева: «Строить», «Правка» или «Удалить». */
  function setMode(mode) {
    if (locked() && mode !== "edit") return;
    tool = mode === "edit" ? "pick" : mode === "delete" ? "erase" : buildTool;
    renderTools();
    renderSel();
  }

  const modeOf = () => (tool === "pick" ? "edit" : tool === "erase" ? "delete" : "build");

  function setCat(id) {
    cat = id;
    page = 0;
    renderTools();
  }

  const catTools = () => TOOLS.filter((t) => t.cat === cat);

  /** Сколько столбцов влезает в сетку по ширине; строк всегда ROWS. */
  function columns() {
    const cell = 50 + 6; // кнопка и промежуток, как в style.css
    return Math.max(3, Math.floor(($("ed-tools").clientWidth + 6) / cell));
  }

  function renderTools() {
    const mode = modeOf();
    for (const b of $("ed-modes").children) {
      b.classList.toggle("on", b.dataset.mode === mode);
      b.disabled = locked() && b.dataset.mode !== "edit";
    }
    for (const b of $("ed-cats").children) b.classList.toggle("on", b.dataset.cat === cat);

    const cols = columns(), list = catTools(), per = cols * ROWS;
    $("ed-tools").style.gridTemplateColumns = `repeat(${cols}, 50px)`;
    const pages = Math.max(1, Math.ceil(list.length / per));
    page = Math.min(page, pages - 1);
    const shown = list.slice(page * per, page * per + per).map(toolButton);
    for (const b of shown) {
      b.classList.toggle("on", mode === "build" && b.dataset.tool === buildTool);
      b.disabled = locked();
    }
    // пустые клетки добивают страницу до полной сетки, как в GD
    while (emptySlots.length < per) {
      const e = document.createElement("i");
      e.className = "ed-tool empty";
      emptySlots.push(e);
    }
    const all = [...shown, ...emptySlots.slice(0, per - shown.length)];
    const box = $("ed-tools");
    if (all.length !== box.children.length || all.some((b, i) => box.children[i] !== b)) box.replaceChildren(...all);
    $("ed-page-prev").disabled = page === 0;
    $("ed-page-next").disabled = page >= pages - 1;
    $("ed-dots").replaceChildren(...Array.from({ length: pages }, (_, i) => {
      const d = document.createElement("i");
      if (i === page) d.className = "on";
      return d;
    }));

    $("ed-swipe").classList.toggle("on", swipe);
    $("ed-snap").classList.toggle("on", snap);
    $("ed-swipe").disabled = $("ed-snap").disabled = locked();
    $("ed-rotate").disabled = locked() || !selObj || !levelobj.rotatable(selObj.k);
    $("ed-clone").disabled = locked() || !selObj;
  }

  function flipPage(d) {
    page += d;
    renderTools();
  }

  function renderEditor() {
    if (locked()) tool = "pick";
    zoneMap = zones();
    if (document.activeElement !== $("ed-name")) $("ed-name").value = ed.name;
    if (document.activeElement !== $("ed-about")) $("ed-about").value = ed.about || "";
    $("ed-name").disabled = $("ed-about").disabled = locked();
    const [, themeName, swatch] = themeOf(ed.theme);
    $("ed-theme-swatch").style.background = swatch;
    $("ed-theme-name").textContent = themeName;
    $("ed-pace-name").textContent = label(PACES, ed.fast);
    $("ed-diff-name").textContent = label(DIFFS, ed.difficulty);
    $("ed-theme-btn").disabled = $("ed-pace-btn").disabled = $("ed-diff-btn").disabled = locked();
    renderTools();
    renderSel();
    renderObj();
    edview.show();

    const issue = problem();
    $("ed-error").textContent = locked() ? "" : issue || "";
    $("ed-count").textContent = `${ed.cells.length} / ${MAX_CELLS}`;
    $("ed-status").textContent = ed.published
      ? "Опубликован — менять нельзя, но можно сделать копию"
      : ed.dirty ? "Есть несохранённые изменения"
      : ed.verified ? "Пройден — можно публиковать"
      : "Черновик: пройди его в «Тесте», чтобы опубликовать";
    $("ed-status").className = "ed-status" + (ed.verified || ed.published ? " ok" : "");
    $("ed-save").hidden = $("ed-publish").hidden = locked();
    $("ed-copy").hidden = !locked();
    $("ed-save").disabled = !!issue || !ed.dirty;
    $("ed-test").disabled = !!issue;
    $("ed-publish").disabled = !ed.verified || ed.dirty;
    $("ed-publish").title = ed.verified ? "" : "Сначала пройди уровень сам — кнопка «Тест»";
  }

  function select(i) {
    sel = Math.max(0, Math.min(ed.cells.length - 1, i));
    renderSel();
  }

  /** Всё, что зависит от выбранной ячейки: подпись, заполнение, подсказка. Превью само читает sel каждый кадр. */
  function renderSel() {
    const c = ed.cells[sel];
    $("ed-sel").textContent = `Ячейка ${sel + 1} из ${ed.cells.length} · ${ARROW_NAMES[c.a].toLowerCase()}`;
    $("ed-fill-row").hidden = ed.fast;
    $("ed-fill").value = c.f;
    $("ed-fill").disabled = locked();
    $("ed-fill-val").textContent = `${c.f.toFixed(2)} с`;
    const zone = zoneMap.get(sel);
    const about = c.o ? `${OBSTACLES[c.o].name}: ${OBSTACLES[c.o].hint}`
      : c.s ? SPECIALS[c.s].hint
      : zone ? `Эта ячейка в участке «${SPECIALS[zone.kind].name}» с ячейки ${zone.from + 1}` : "Обычная ячейка: держи стрелку, пока ползунок не заполнится";
    $("ed-hint").textContent = tool === "pick" || locked() ? about : `${TOOL[tool].name}: ${TOOL[tool].hint}`;
    for (const id of ["ed-add", "ed-dup", "ed-del", "ed-left", "ed-right", "ed-random"]) $(id).disabled = locked();
    // камера едет только к новой выбранной ячейке: иначе смена инструмента или ввод названия возвращали бы её назад
    if (sel !== focused) edview.focus(sel);
    focused = sel;
    if (!$("ed-code").hidden) checkCode(); // «Вставить после ячейки N» и запрет у опубликованного
  }

  /** Клик по ячейке на превью: выбранный инструмент применяется к ней. */
  function apply(i) {
    const c = ed.cells[i];
    if (!c) return;
    if (tool === "pick" || locked()) {
      pickObj(null);
      return select(i);
    }
    sel = i;
    if (tool === "erase") return removeSel();
    const t = TOOL[tool];
    // особая ячейка и препятствие на одной ячейке не уживаются: новое заменяет старое
    const want = t.arrow !== undefined ? { a: t.arrow }
      : t.special ? (c.s === tool ? { s: null } : { s: tool, o: null })
      : t.obstacle !== undefined ? (t.obstacle ? { o: t.obstacle, s: null } : { o: null }) // не переключается: протяжкой красят
      : { s: null };
    if (Object.entries(want).every(([k, v]) => c[k] === v)) return select(i);
    change(() => Object.assign(c, want));
  }

  /** «+» в конце превью: новая ячейка со стрелкой или особой ячейкой выбранного инструмента. */
  function append() {
    if (locked() || ed.cells.length >= MAX_CELLS) return;
    const t = TOOL[tool];
    const last = ed.cells[ed.cells.length - 1];
    const cell = { ...randomCells(1, ed.cells)[0], f: last ? last.f : 1 };
    if (t.arrow !== undefined) cell.a = t.arrow;
    if (t.special) cell.s = tool;
    if (t.obstacle) cell.o = t.obstacle;
    change(() => {
      ed.cells.push(cell);
      sel = ed.cells.length - 1;
    });
  }

  /** Новая ячейка после выбранной: стрелка случайная, заполнение как у соседки. */
  function insertAfter(cell) {
    change(() => {
      if (ed.cells.length >= MAX_CELLS) return;
      ed.cells.splice(sel + 1, 0, cell || { ...randomCells(1, ed.cells.slice(0, sel + 1))[0], f: ed.cells[sel] ? ed.cells[sel].f : 1 });
      cellsInserted(sel + 1, 1);
      sel++;
    });
  }

  function removeSel() {
    change(() => {
      if (ed.cells.length <= 1) return;
      ed.cells.splice(sel, 1);
      cellRemoved(sel);
      sel = Math.min(sel, ed.cells.length - 1);
    });
  }

  function moveSel(dir) {
    const to = sel + dir;
    if (to < 0 || to >= ed.cells.length) return;
    change(() => {
      [ed.cells[sel], ed.cells[to]] = [ed.cells[to], ed.cells[sel]];
      sel = to;
    });
  }

  const body = () => ({
    name: ed.name.trim(), about: (ed.about || "").trim(), fast: ed.fast, difficulty: ed.difficulty, theme: ed.theme, cells: ed.cells,
    objects: ed.objects.map((ob) => cleanObj({ ...ob, c: Math.min(ob.c, ed.cells.length - 1) })),
  });

  async function save() {
    if (problem()) return false;
    try {
      const d = ed.id ? await call("PUT", `/${ed.id}`, body()) : await call("POST", "/", body());
      if (!ed.id) {
        // у нового уровня появился номер: код переезжает к нему
        storeCode(loadCode(null), d.id);
        storeCode("", null);
      }
      ed.id = d.id;
      ed.verified = d.verified;
      ed.published = d.published;
      ed.dirty = false;
      $("ed-error").textContent = "";
      renderEditor();
      return true;
    } catch (e) {
      $("ed-error").textContent = e.message;
      return false;
    }
  }

  async function test() {
    if (ed.dirty && !(await save())) return;
    play(ed.id, false, "editor", $("ed-error"));
  }

  // ---------- Быстрый тест ----------
  // Прямо в превью, как в GD: с выбранной ячейки, без сохранения и сервера. Для публикации не засчитывается.

  let quick = false;

  /** Ячейки, как их соберёт сервер (LevelGenerator.FromEditor), без «Раста» и «Кловда»: те только помечены. */
  function playable() {
    const out = ed.cells.map((c) => ({
      a: c.a,
      f: c.o === "spike" ? (ed.fast ? QUICK.spikeFast : c.f) : ed.fast ? 0 : c.f,
      wall: c.o === "wall", spike: c.o === "spike", fake: c.o === "fake",
      note: c.s === "rast" || c.s === "cloud" ? SPECIALS[c.s].name : null,
    }));
    ed.cells.forEach((c, i) => {
      if (!c.s) return;
      for (let k = 1; k <= SPECIALS[c.s].span && i + k < out.length; k++) {
        const p = out[i + k];
        p.zone = c.s;
        if (c.s === "chart") p.a = c.a;
        else if (c.s === "over") p.f = Math.round(p.f * QUICK.overdrive * 100) / 100;
        else if (c.s === "swam") Object.assign(p, { ufo: true, f: k === 1 ? QUICK.swamIntro : QUICK.swamCell });
        else if (c.s === "rainbow" && k % 2 === 0) p.wall = true;
      }
    });
    return out;
  }

  function quickTest(on = !quick) {
    if (on === quick) return;
    quick = on;
    if (on) {
      pickObj(null);
      toggleCode(false);
      if (document.activeElement) document.activeElement.blur(); // стрелки идут в тест, а не в поле ввода
      edview.play({
        cells: playable(), from: sel, fast: ed.fast, objects: ed.objects,
        rules: { ...QUICK, ...(QUICK_DIFF[ed.difficulty] || QUICK_DIFF.normal) },
        onEnd: () => quickTest(false),
      });
    } else {
      edview.stop();
    }
    document.body.toggleAttribute("data-edtest", on);
    $("screen-editor").classList.toggle("testing", on);
    renderQuick();
  }

  function renderQuick() {
    const b = $("ed-quick");
    b.classList.toggle("on", quick);
    b.innerHTML = quick
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg><span>Стоп</span>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#play"/></svg><span>Быстрый тест</span>';
  }

  /** Экранные стрелки на телефоне (app.js). */
  function press(a) {
    if (quick) edview.press(a);
  }

  function release(a) {
    if (quick) edview.release(a);
  }

  async function publish() {
    if (!confirm("После публикации уровень увидят все, а менять его будет нельзя. Опубликовать?")) return;
    try {
      const d = await call("POST", `/${ed.id}/publish`);
      ed.published = d.published;
      renderEditor();
    } catch (e) {
      $("ed-error").textContent = e.message;
    }
  }

  function copy() {
    const code = loadCode();
    ed = {
      ...ed, id: null, name: `${ed.name} (копия)`.slice(0, NAME_MAX), published: false, verified: false, dirty: true,
      cells: ed.cells.map((c) => ({ ...c })), objects: ed.objects.map((ob) => ({ ...ob })),
    };
    selObj = null;
    storeCode(code); // код переезжает в копию
    renderEditor();
  }

  // ---------- Код уровня ----------
  // Текст кода хранится только в этом браузере, у каждого уровня свой: на сервер уходят уже собранные ячейки.

  const CODE_LIMITS = { maxCells: MAX_CELLS, minFill: MIN_FILL, maxFill: MAX_FILL };
  const codeKey = (id) => "arrowrush.code." + (id || "new");
  let codeConfirmed = false; // заменить уровень кодом спрашиваем один раз за открытие уровня

  function loadCode(id = ed.id) {
    try {
      return localStorage.getItem(codeKey(id)) || "";
    } catch {
      return "";
    }
  }

  function storeCode(text, id = ed.id) {
    try {
      if (text) localStorage.setItem(codeKey(id), text);
      else localStorage.removeItem(codeKey(id));
    } catch { /* хранилище недоступно — код живёт до закрытия панели */ }
  }

  function toggleCode(on = $("ed-code").hidden) {
    $("ed-code").hidden = !on;
    $("ed-code-btn").classList.toggle("on", on);
    if (!on) return;
    $("ed-code-src").value = loadCode();
    checkCode();
    $("ed-code-src").focus();
  }

  /** Проверка на лету: сколько ячеек получится или где ошибка. Возвращает ячейки, если код можно применить. */
  function checkCode() {
    const src = $("ed-code-src").value;
    const r = src.trim() ? levelcode.compile(src, CODE_LIMITS) : null;
    const status = $("ed-code-status");
    status.classList.toggle("bad", !!(r && r.error));
    status.textContent = !r ? "Напиши код или нажми «Пример»"
      : r.error ? `Строка ${r.line}: ${r.error}`
      : `Получится ${r.cells.length} яч.`;
    const ok = !!r && !r.error && !locked();
    $("ed-code-replace").disabled = !ok;
    $("ed-code-insert").disabled = !ok || ed.cells.length + r.cells.length > MAX_CELLS;
    $("ed-code-insert").textContent = `Вставить после ячейки ${sel + 1}`;
    return ok ? r.cells : null;
  }

  function runCode(replace) {
    const cells = checkCode();
    if (!cells) return;
    if (replace && !codeConfirmed && ed.cells.length > 1 && !confirm(`Заменить все ${ed.cells.length} ячеек уровнем из кода?`)) return;
    if (replace) codeConfirmed = true;
    focused = -1; // камера едет к тому, что получилось
    change(() => {
      if (replace) {
        ed.cells = cells;
        for (const ob of ed.objects) ob.c = Math.min(ob.c, cells.length - 1); // объекты остаются, пока есть их ячейки
        sel = 0;
      } else {
        ed.cells.splice(sel + 1, 0, ...cells);
        cellsInserted(sel + 1, cells.length);
        sel += cells.length;
      }
    });
  }

  /** back — на сколько знаков вернуть курсор: у «{  }» он встаёт между скобками. */
  function insertIntoCode(text, back = 0) {
    const src = $("ed-code-src");
    src.focus();
    src.setRangeText(text, src.selectionStart, src.selectionEnd, "end");
    src.selectionStart = src.selectionEnd = src.selectionEnd - back;
    src.dispatchEvent(new Event("input"));
  }

  function initCode() {
    $("ed-code-help").replaceChildren(...levelcode.HELP.map(([syntax, what]) => {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = syntax;
      li.append(code, " — " + what);
      return li;
    }));
    $("ed-code-keys").replaceChildren(...["←", "↑", "→", "↓", "?", "{ }"].map((k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = k;
      b.title = "Вставить в код";
      b.addEventListener("click", () => (k === "{ }" ? insertIntoCode("{  }", 2) : insertIntoCode(k + " ")));
      return b;
    }));
    $("ed-code-btn").addEventListener("click", () => toggleCode());
    $("ed-code-close").addEventListener("click", () => toggleCode(false));
    $("ed-code-help-btn").addEventListener("click", () => { $("ed-code-help").hidden = !$("ed-code-help").hidden; });
    $("ed-code-example").addEventListener("click", () => {
      const src = $("ed-code-src");
      if (src.value.trim() && !confirm("Заменить твой код примером?")) return;
      src.value = levelcode.EXAMPLE;
      src.dispatchEvent(new Event("input"));
    });
    $("ed-code-src").addEventListener("input", () => {
      storeCode($("ed-code-src").value);
      checkCode();
    });
    $("ed-code-src").addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runCode(true);
      }
    });
    $("ed-code-replace").addEventListener("click", () => runCode(true));
    $("ed-code-insert").addEventListener("click", () => runCode(false));
  }

  function back() {
    quickTest(false);
    if (ed && ed.dirty && !ed.published && !confirm("Выйти без сохранения? Изменения пропадут.")) return;
    open();
  }

  /** Быстрая расстановка: стрелка ставится в выбранную ячейку и курсор идёт дальше, в конце добавляется новая. */
  function onKey(e) {
    if (opts.screen() !== "editor" || !ed) return;
    if (quick) {
      // в тесте клавиши играют: стрелки — в уровень, Esc и Enter — назад в редактор
      if (e.code === "Escape" || e.code === "Enter") quickTest(false);
      else if (KEYS[e.code] !== undefined) edview.press(KEYS[e.code]);
      else return;
      e.preventDefault();
      return;
    }
    if (e.target.matches("input, textarea, select")) return;
    if (e.code === "Enter" && !e.repeat && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); // иначе Enter ещё и нажмёт кнопку в фокусе
      quickTest(true);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
      e.preventDefault();
      if (!locked()) save();
      return;
    }
    const a = KEYS[e.code];
    if (a !== undefined && e.shiftKey && (a === 0 || a === 2)) {
      e.preventDefault();
      select(sel + (a === 0 ? -1 : 1));
    } else if (a !== undefined && !e.ctrlKey && !e.metaKey && !e.altKey && !locked()) {
      e.preventDefault();
      change(() => {
        ed.cells[sel].a = a;
        if (sel === ed.cells.length - 1 && ed.cells.length < MAX_CELLS) ed.cells.push({ a, f: ed.cells[sel].f, s: null });
        sel = Math.min(sel + 1, ed.cells.length - 1);
      });
    } else if ((e.code === "Delete" || e.code === "Backspace") && !locked()) {
      e.preventDefault();
      if (selObj) eraseObj(selObj);
      else removeSel();
    } else if (e.code === "Escape") {
      pickObj(null);
      setMode("edit");
    } else if (e.code === "KeyB" && !e.ctrlKey && !e.metaKey) {
      setMode("build");
    } else if (e.code === "KeyX" && !e.ctrlKey && !e.metaKey) {
      setMode("delete");
    } else if (e.code === "KeyR" && !e.ctrlKey && !e.metaKey) {
      rotateObj();
    } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyD") {
      e.preventDefault();
      cloneObj();
    }
  }

  // ---------- Запуск ----------

  function init(o) {
    opts = o;
    for (const t of document.querySelectorAll("#levels-tabs .tab")) t.addEventListener("click", () => setView(t.dataset.view));
    const sortChips = () => $("levels-sort").replaceChildren(...SORTS.map(([key, text]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ed-chip" + (key === sort ? " on" : "");
      b.textContent = text;
      b.addEventListener("click", () => {
        sort = key;
        sortChips();
        load();
      });
      return b;
    }));
    sortChips();
    $("levels-search").addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(load, 300);
    });
    $("btn-level-new").addEventListener("click", () => edit(null));

    $("ed-theme-btn").addEventListener("click", () => change(() => { ed.theme = next(lobby.themes, ed.theme); }));
    $("ed-pace-btn").addEventListener("click", () => change(() => { ed.fast = next(PACES, ed.fast); }));
    $("ed-diff-btn").addEventListener("click", () => change(() => { ed.difficulty = next(DIFFS, ed.difficulty); }));
    edview.init($("ed-canvas"), {
      get: () => {
        const equipped = (opts.me() || {}).equipped || {};
        return {
          cells: ed.cells, sel, fast: ed.fast, theme: ed.theme, zones: zoneMap, specials: SPECIALS,
          skin: equipped.slider || "classic", hero: equipped.hero || "circle",
          // протяжка красит ячейки, а не листает: стрелки, «Обычная» и препятствия
          paints: !locked() && (TOOL[tool].arrow !== undefined || tool === "plain" || TOOL[tool].obstacle !== undefined),
          canAppend: !locked() && ed.cells.length < MAX_CELLS,
          objects: ed.objects, selObj, mode: TOOL[tool].mode, locked: locked(),
          // «Протяжка» ставит объекты подряд (триггеры — по одному), «Сетка» ровняет их по клеткам
          swipe: swipe && !levelobj.isTrigger(TOOL[tool].object || "t-"), grid: snap ? GRID : 0,
          swipeStep: TOOL[tool].object ? swipeStep(TOOL[tool].object) : GRID,
        };
      },
      hit: apply,
      append,
      place: placeObj,
      pickObj,
      eraseObj,
      moved: () => {
        change(() => {}); // объект перетащили: уровень изменился
        renderObj(true);  // и в панели новое положение и ячейка
      },
    });
    // вкладки — значки, как в GD; название во всплывающей подсказке
    $("ed-cats").replaceChildren(...CATS.map(([id, text, iconTool]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ed-cat";
      b.dataset.cat = id;
      b.title = text;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-label", text);
      const t = TOOL[iconTool];
      b.style.setProperty("--c", t.color);
      b.append(t.object ? levelobj.icon(t.object, 28) : toolIcon(t));
      b.addEventListener("click", () => setCat(id));
      return b;
    }));
    for (const b of $("ed-modes").children) b.addEventListener("click", () => setMode(b.dataset.mode));
    $("ed-page-prev").addEventListener("click", () => flipPage(-1));
    $("ed-page-next").addEventListener("click", () => flipPage(1));
    $("ed-tools").addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaY) < 4 && Math.abs(e.deltaX) < 4) return;
      e.preventDefault();
      const d = Math.sign(e.deltaY || e.deltaX);
      if (!(d < 0 ? $("ed-page-prev") : $("ed-page-next")).disabled) flipPage(d);
    }, { passive: false });
    $("ed-swipe").addEventListener("click", () => { swipe = !swipe; renderTools(); });
    $("ed-snap").addEventListener("click", () => { snap = !snap; renderTools(); });
    $("ed-rotate").addEventListener("click", rotateObj);
    $("ed-clone").addEventListener("click", cloneObj);
    // ширина сетки меняется с окном: на страницу влезает другое число кнопок
    new ResizeObserver(() => { if (ed) renderTools(); }).observe($("ed-tools"));

    $("ed-name").maxLength = NAME_MAX;
    $("ed-about").maxLength = ABOUT_MAX;
    $("ed-name").addEventListener("input", () => change(() => { ed.name = $("ed-name").value; }));
    $("ed-about").addEventListener("input", () => change(() => { ed.about = $("ed-about").value; }));
    $("ed-fill").min = MIN_FILL;
    $("ed-fill").max = MAX_FILL;
    $("ed-fill").addEventListener("input", () => change(() => { ed.cells[sel].f = +$("ed-fill").value; }));
    $("ed-add").addEventListener("click", () => insertAfter());
    $("ed-dup").addEventListener("click", () => insertAfter({ ...ed.cells[sel] , s: null }));
    $("ed-del").addEventListener("click", removeSel);
    $("ed-left").addEventListener("click", () => moveSel(-1));
    $("ed-right").addEventListener("click", () => moveSel(1));
    $("ed-random").addEventListener("click", () => change(() => {
      ed.cells.push(...randomCells(Math.min(10, MAX_CELLS - ed.cells.length), ed.cells));
    }));
    $("ed-save").addEventListener("click", save);
    $("ed-test").addEventListener("click", test);
    $("ed-publish").addEventListener("click", publish);
    $("ed-copy").addEventListener("click", copy);
    $("btn-editor-back").addEventListener("click", back);
    initCode();
    addEventListener("keydown", onKey);
    $("ed-quick").addEventListener("click", () => quickTest());
    renderQuick();
    addEventListener("keyup", (e) => {
      if (quick && KEYS[e.code] !== undefined) edview.release(KEYS[e.code]);
    });
    addEventListener("blur", () => edview.releaseAll()); // ушёл в другое окно — всё отпущено
  }

  /** Сервер сообщил, что уровень пройден автором: обновляем открытый список или редактор. */
  async function changed() {
    if (opts.screen() === "levels") load();
    if (ed && ed.id && !ed.dirty) {
      try {
        const d = await call("GET", `/${ed.id}`);
        ed.verified = d.verified;
        ed.published = d.published;
        if (opts.screen() === "editor") renderEditor();
      } catch { /* уровень удалили */ }
    }
  }

  /** Вернуться туда, откуда запускали уровень. */
  function returnTo(where) {
    if (where === "editor" && ed) {
      opts.show("editor");
      renderEditor(); // заодно снова запускает превью
      changed(); // прохождение могло засчитаться, пока шли итоги
    } else {
      open();
    }
  }

  return { init, open, play, changed, returnTo, press, release };
})();
