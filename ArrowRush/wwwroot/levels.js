"use strict";

// Уровни игроков, как в GD: список опубликованных и своих, редактор и публикация.
// Сервер хранит уровни и собирает из ячеек настоящий уровень (LevelEndpoints.cs, LevelGenerator.FromEditor);
// здесь показ, правка и запуск. Опубликовать можно только уровень, который автор прошёл в «Тесте» после последней правки.
const levels = (() => {
  const $ = (id) => document.getElementById(id);

  // как в GameRules.cs: сервер проверяет то же самое
  const MIN_CELLS = 5, MAX_CELLS = 400, MIN_FILL = 0.3, MAX_FILL = 3, NAME_MAX = 32, ABOUT_MAX = 140;
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
  };
  const ARROW_NAMES = ["Влево", "Вверх", "Вправо", "Вниз"];
  // инструменты верхней панели: что делает клик по ячейке на превью
  const TOOLS = [
    { id: "pick", name: "Выбор", color: "var(--muted-room)", hint: "клик выбирает ячейку, протяжка листает уровень" },
    ...[0, 1, 2, 3].map((a) => ({ id: "a" + a, arrow: a, name: ARROW_NAMES[a], color: `var(--a${a})`, hint: "клик или протяжка по ячейкам ставит эту стрелку, «+» в конце добавляет ячейку" })),
    { id: "plain", name: "Обычная", color: "#c3c7d9", hint: "клик убирает особую ячейку" },
    ...Object.entries(SPECIALS).map(([id, s]) => ({ id, special: true, name: s.name, color: s.color, hint: s.hint })),
    { id: "erase", name: "Ластик", color: "#ff3b5c", hint: "клик удаляет ячейку" },
  ];
  const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

  let opts = null;     // { conn, show, screen, onPlay, me }
  let view = "online"; // вкладка списка: online или mine
  let sort = "new";
  let searchTimer = 0;
  let ed = null;       // открытый уровень: { id, name, about, fast, difficulty, theme, cells, verified, published, dirty }
  let sel = 0;         // выбранная ячейка
  let tool = "pick";   // инструмент верхней панели
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
      out.push({ a, f: Math.round((0.6 + Math.random()) * 20) / 20, s: null });
    }
    return out;
  }

  async function edit(id) {
    $("ed-error").textContent = "";
    if (id) {
      try {
        const d = await call("GET", `/${id}`);
        ed = { ...d, cells: d.cells.map((c) => ({ a: c.a, f: c.f, s: c.s || null })), dirty: false };
      } catch (e) {
        $("levels-error").textContent = e.message;
        return;
      }
    } else {
      ed = { id: null, name: "", about: "", fast: false, difficulty: "normal", theme: "auto", cells: randomCells(12), verified: false, published: false, dirty: true };
    }
    sel = 0;
    opts.show("editor");
    edview.reset();
    focused = sel;
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
      const s = ed.cells[i].s;
      if (!s) continue;
      if (i <= busyUntil) return `Ячейка ${i + 1}: внутри участка прошлой особой ячейки`;
      if (i + SPECIALS[s].span >= ed.cells.length) return `Ячейка ${i + 1}: за ней нужно ещё ${SPECIALS[s].span} ячеек`;
      busyUntil = i + SPECIALS[s].span;
    }
    return null;
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

  function toolButton(t) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ed-tool";
    b.dataset.tool = t.id;
    b.style.setProperty("--c", t.color);
    b.title = `${t.name}: ${t.hint}`;
    b.innerHTML = (t.arrow !== undefined ? arrowIcon(t.arrow) : `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICONS[t.id]}</svg>`)
      + `<span>${t.name}</span>`;
    b.addEventListener("click", () => setTool(t.id));
    return b;
  }

  function setTool(id) {
    tool = id;
    renderTools();
    renderSel();
  }

  function renderTools() {
    for (const b of $("ed-tools").children) {
      b.classList.toggle("on", b.dataset.tool === tool);
      b.disabled = locked() && b.dataset.tool !== "pick";
    }
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
    const about = c.s
      ? SPECIALS[c.s].hint
      : zone ? `Эта ячейка в участке «${SPECIALS[zone.kind].name}» с ячейки ${zone.from + 1}` : "Обычная ячейка: держи стрелку, пока ползунок не заполнится";
    $("ed-hint").textContent = tool === "pick" || locked() ? about : `${TOOL[tool].name}: ${TOOL[tool].hint}`;
    for (const id of ["ed-add", "ed-dup", "ed-del", "ed-left", "ed-right", "ed-random"]) $(id).disabled = locked();
    // камера едет только к новой выбранной ячейке: иначе смена инструмента или ввод названия возвращали бы её назад
    if (sel !== focused) edview.focus(sel);
    focused = sel;
  }

  /** Клик по ячейке на превью: выбранный инструмент применяется к ней. */
  function apply(i) {
    const c = ed.cells[i];
    if (!c) return;
    if (tool === "pick" || locked()) return select(i);
    sel = i;
    if (tool === "erase") return removeSel();
    const t = TOOL[tool];
    const want = t.arrow !== undefined ? { a: t.arrow } : t.special ? { s: c.s === tool ? null : tool } : { s: null };
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
      sel++;
    });
  }

  function removeSel() {
    change(() => {
      if (ed.cells.length <= 1) return;
      ed.cells.splice(sel, 1);
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

  const body = () => ({ name: ed.name.trim(), about: (ed.about || "").trim(), fast: ed.fast, difficulty: ed.difficulty, theme: ed.theme, cells: ed.cells });

  async function save() {
    if (problem()) return false;
    try {
      const d = ed.id ? await call("PUT", `/${ed.id}`, body()) : await call("POST", "/", body());
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
    ed = { ...ed, id: null, name: `${ed.name} (копия)`.slice(0, NAME_MAX), published: false, verified: false, dirty: true, cells: ed.cells.map((c) => ({ ...c })) };
    renderEditor();
  }

  function back() {
    if (ed && ed.dirty && !ed.published && !confirm("Выйти без сохранения? Изменения пропадут.")) return;
    open();
  }

  /** Быстрая расстановка: стрелка ставится в выбранную ячейку и курсор идёт дальше, в конце добавляется новая. */
  function onKey(e) {
    if (opts.screen() !== "editor" || !ed || e.target.matches("input, textarea, select")) return;
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
      removeSel();
    } else if (e.code === "Escape") {
      setTool("pick");
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

    $("ed-tools").replaceChildren(...TOOLS.map(toolButton));
    $("ed-theme-btn").addEventListener("click", () => change(() => { ed.theme = next(lobby.themes, ed.theme); }));
    $("ed-pace-btn").addEventListener("click", () => change(() => { ed.fast = next(PACES, ed.fast); }));
    $("ed-diff-btn").addEventListener("click", () => change(() => { ed.difficulty = next(DIFFS, ed.difficulty); }));
    edview.init($("ed-canvas"), {
      get: () => {
        const equipped = (opts.me() || {}).equipped || {};
        return {
          cells: ed.cells, sel, fast: ed.fast, theme: ed.theme, zones: zoneMap, specials: SPECIALS,
          skin: equipped.slider || "classic", hero: equipped.hero || "circle",
          paints: !locked() && (TOOL[tool].arrow !== undefined || tool === "plain"), // протяжка красит ячейки, а не листает
          canAppend: !locked() && ed.cells.length < MAX_CELLS,
        };
      },
      hit: apply,
      append,
    });

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
    addEventListener("keydown", onKey);
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

  return { init, open, play, changed, returnTo };
})();
