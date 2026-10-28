"use strict";

// Стрелки: 0 ← 1 ↑ 2 → 3 ↓ (так же, как enum Arrow на сервере)
const KEY_TO_ARROW = {
  ArrowLeft: 0, ArrowUp: 1, ArrowRight: 2, ArrowDown: 3,
  KeyA: 0, KeyW: 1, KeyD: 2, KeyS: 3,
};
const ROTATION = [-90, 0, 90, 180];
const ARROW_CHAR = ["←", "↑", "→", "↓"];

// порядок здесь — порядок карточек в меню; правила режимов присылает сервер в matchStart
const MODES = {
  classic: { name: "Классика", icon: "bar", color: "var(--a1)", desc: "Без особых правил." },
  mirror: { name: "Зеркало", icon: "mirror", color: "var(--a0)", desc: "Жми стрелку, противоположную нарисованной: ← значит →, ↑ значит ↓." },
  blind: { name: "Вслепую", icon: "eye", color: "var(--a3)", desc: "Видна только текущая стрелка, следующие спрятаны." },
  hardcore: { name: "Хардкор", icon: "heart", color: "var(--bad)", desc: "Без пауз за ошибку, но три ошибки — и ты выбыл." },
};
// темп выбирается для любого режима
const PACES = {
  normal: { name: "обычный", desc: "Держи стрелку, пока ползунок не заполнится." },
  fast: { name: "быстрый", desc: "Одно нажатие — один ползунок, но их 20–30." },
};

const SKIN_SLOTS = ["slider", "win", "streak"];
const UNLOCK_TEXT = {
  games: (n) => `Сыграй ${n} ${plural(n, "матч", "матча", "матчей")}`,
  wins: (n) => `Выиграй ${n} ${plural(n, "матч", "матча", "матчей")}`,
  sliders: (n) => `Заполни ${n} ползунков`,
  streak: (n) => `Выиграй ${n} ${plural(n, "раз", "раза", "раз")} подряд`,
};
// превью эффектов на экране скинов: значок (символ или #id из <svg> в index.html) и цвет плитки
const FX_PREVIEW = {
  confetti: ["▰", "var(--a2)"], stars: ["★", "var(--gold)"], snow: ["❄", "var(--a0)"], fireworks: ["✺", "var(--a3)"],
  flame: ["#flame", "var(--a2)"], electric: ["#bolt", "var(--a0)"], rainbow: ["◉", "var(--a1)"],
};

function plural(n, one, few, many) {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return one;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}

const $ = (id) => document.getElementById(id);

// ---------- Состояние клиента ----------

let screen = "";          // пусто до первого show() — тогда и при загрузке поднимается занавес
let match = null;        // данные текущего матча + DOM дорожек
let lastState = null;    // последний снимок от сервера
let stateAt = 0;         // когда он пришёл (performance.now)
let held = 0;            // какие стрелки зажаты (битовая маска)
let sentHeld = -1;       // что последним отправили серверу
let search = null;       // { startedAt, inQueue, botAfter, timer }
let online = false;      // хотим ли быть подключены к хабу (false после выхода из аккаунта)
let profile = null;      // ответ /api/account/me
let gameMode = "classic";
let pace = "normal";
try {
  if (MODES[localStorage.getItem("arrowrush.mode")]) gameMode = localStorage.getItem("arrowrush.mode");
  else if (localStorage.getItem("arrowrush.mode") === "speed") pace = "fast"; // бывший режим «Скорость»
  if (PACES[localStorage.getItem("arrowrush.pace")]) pace = localStorage.getItem("arrowrush.pace");
} catch { /* приватный режим */ }

/** «Зеркало · быстрый» — режим и темп одной строкой. */
function modeLabel(mode, fast) {
  return `${MODES[mode].name} · ${PACES[fast ? "fast" : "normal"].name}`;
}

// режимы с нажатиями: свой прогресс считаем сразу по нажатию, не дожидаясь сервера
let pred = newPrediction();
let combo = 0;           // режимы с нажатиями: ползунков подряд без ошибки
let lastPractice = false; // «Ещё матч» повторяет тот же вид игры
let skinSlot = "slider"; // открытая вкладка на экране скинов

function newPrediction() {
  return { idx: 0, stunUntil: 0, hitUntil: 0, lastPress: 0, miss: 0, out: false };
}

/** Какую стрелку надо нажать для нарисованной: в «Зеркале» — противоположную. */
function targetOf(arrow) {
  return match && match.mirror ? (arrow + 2) % 4 : arrow;
}

// ---------- Экраны ----------

function show(name) {
  for (const s of ["auth", "menu", "modes", "stats", "skins", "search", "game", "results"]) {
    $("screen-" + s).classList.toggle("active", s === name);
  }
  // новый экран уже на месте (его можно измерять), занавес поверх него уезжает вверх
  if (name !== screen) fx.retrigger($("curtain"), "lift");
  screen = name;
  fx.setCalm(name === "game");
  if (name === "menu") refreshProfile();
}

/** Строка о связи с сервером — в меню и на экране выбора режима. */
function setConn(text, kind) {
  for (const el of document.querySelectorAll("[data-conn]")) {
    el.textContent = text;
    el.className = "conn " + (kind || "");
  }
}

/** Кнопки, которым нужна связь с сервером. */
function setPlayable(ok) {
  $("btn-find").disabled = !ok;
  $("btn-practice").disabled = !ok;
}

// ---------- Подключение к серверу ----------

const conn = new signalR.HubConnectionBuilder()
  .withUrl("/hub")
  .withAutomaticReconnect()
  .build();

conn.onreconnecting(() => {
  setConn("Связь потеряна, переподключаюсь…", "bad");
  setPlayable(false);
});

conn.onreconnected(() => {
  setPlayable(true);
  if (screen === "game" || screen === "search") {
    // после переподключения сервер считает, что мы вышли
    abortToMenu("Соединение прерывалось — матч отменён");
  } else {
    setConn("Подключено", "ok");
  }
});

conn.onclose(() => {
  setPlayable(false);
  if (!online) return; // сами отключились при выходе из аккаунта
  setConn("Нет связи с сервером. Обнови страницу.", "bad");
});

async function connect() {
  if (!online || conn.state !== signalR.HubConnectionState.Disconnected) return;
  setConn("Подключение к серверу…");
  try {
    await conn.start();
    setConn("Подключено", "ok");
    setPlayable(true);
  } catch {
    // хаб пускает только вошедших — возможно, сессия истекла
    const me = await api("GET", "me").catch(() => null);
    if (me && me.status === 401) return toAuth("Сессия истекла, войди снова");
    setConn("Сервер недоступен, пробую снова…", "bad");
    setTimeout(connect, 3000);
  }
}

// ---------- Аккаунт ----------

async function api(method, path, body) {
  const res = await fetch("/api/account/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

/** При загрузке: если cookie входа жива — сразу в меню, иначе на экран входа. */
async function boot() {
  try {
    const me = await api("GET", "me");
    if (!me.ok) return toAuth();
    applyProfile(me.data);
    online = true;
    show("menu");
    connect();
  } catch {
    toAuth("Сервер недоступен, пробую снова…");
    setTimeout(boot, 3000);
  }
}

function toAuth(message) {
  online = false;
  stopSearch();
  match = null;
  show("auth");
  $("auth-error").textContent = message || "";
  if (conn.state !== signalR.HubConnectionState.Disconnected) conn.stop();
}

let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  const reg = mode === "register";
  for (const t of document.querySelectorAll("#auth-form .tab")) t.classList.toggle("active", t.dataset.mode === mode);
  document.querySelector("#auth-form .tabs").dataset.active = reg ? "1" : "0";
  $("auth-pass2-field").hidden = !reg;
  $("auth-hint").hidden = !reg;
  $("auth-pass").autocomplete = reg ? "new-password" : "current-password";
  $("auth-submit").textContent = reg ? "Создать аккаунт" : "Войти";
  $("auth-error").textContent = "";
}

for (const t of document.querySelectorAll("#auth-form .tab")) {
  t.addEventListener("click", () => setAuthMode(t.dataset.mode));
}

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const userName = $("auth-name").value.trim();
  const password = $("auth-pass").value;
  const err = $("auth-error");

  if (!userName || !password) { err.textContent = "Введи ник и пароль"; return; }
  if (authMode === "register" && password !== $("auth-pass2").value) { err.textContent = "Пароли не совпадают"; return; }

  const btn = $("auth-submit");
  btn.disabled = true;
  err.textContent = "";
  try {
    const r = await api("POST", authMode, { userName, password });
    if (!r.ok) { err.textContent = (r.data && r.data.error) || "Не получилось, попробуй ещё раз"; return; }
    $("auth-pass").value = "";
    $("auth-pass2").value = "";
    await boot();
  } catch {
    err.textContent = "Сервер недоступен";
  } finally {
    btn.disabled = false;
  }
});

$("btn-logout").addEventListener("click", async () => {
  online = false;
  await conn.stop().catch(() => {});
  await api("POST", "logout").catch(() => {});
  toAuth();
});

async function refreshProfile() {
  try {
    const me = await api("GET", "me");
    if (me.ok) applyProfile(me.data);
    else if (me.status === 401) toAuth("Сессия истекла, войди снова");
  } catch { /* покажем то, что уже есть */ }
}

function modeIcon(m) {
  return m.icon === "bar"
    ? `<span class="mc-bar"><i></i></span>`
    : `<svg viewBox="0 0 24 24"><use href="#${m.icon}"/></svg>`;
}

// ---------- Выбор режима: карусель ----------

const MODE_IDS = Object.keys(MODES);
let swiped = false;

// карточка на каждый режим; видны текущая и соседние, остальные спрятаны за краем
for (const [id, m] of Object.entries(MODES)) {
  const slide = document.createElement("button");
  slide.type = "button";
  slide.className = "mode-slide";
  slide.dataset.gameMode = id;
  slide.setAttribute("role", "option");
  slide.style.setProperty("--c", m.color);
  slide.innerHTML = `
    <span class="slide-icon" aria-hidden="true">${modeIcon(m)}</span>
    <span class="slide-name">${m.name}</span>
    <span class="slide-desc"></span>
    <span class="slide-meta"></span>`;
  // соседняя карточка по клику становится текущей
  slide.addEventListener("click", () => {
    if (swiped) { swiped = false; return; } // свайп уже пролистал — клик в конце жеста не считаем
    if (id !== gameMode) setGameMode(id, true);
  });
  $("mode-stage").appendChild(slide);

  const dot = document.createElement("i");
  dot.dataset.gameMode = id;
  dot.style.setProperty("--c", m.color);
  $("mode-dots").appendChild(dot);
}

/** Листает режимы по кругу: dir = -1 влево, 1 вправо. */
function stepMode(dir) {
  const i = MODE_IDS.indexOf(gameMode);
  setGameMode(MODE_IDS[(i + dir + MODE_IDS.length) % MODE_IDS.length], true);
}

$("mode-prev").addEventListener("click", () => stepMode(-1));
$("mode-next").addEventListener("click", () => stepMode(1));

// свайп пальцем или мышью
{
  let startX = null;
  const stage = $("mode-stage");
  stage.addEventListener("pointerdown", (e) => { startX = e.clientX; swiped = false; });
  stage.addEventListener("pointerup", (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) {
      swiped = true;
      stepMode(dx < 0 ? 1 : -1);
    }
  });
  stage.addEventListener("pointercancel", () => { startX = null; });
}

/** animate — сменили режим руками: кольцо вокруг новой карточки. */
function setGameMode(mode, animate = false) {
  gameMode = mode;
  try { localStorage.setItem("arrowrush.mode", mode); } catch { /* ничего */ }

  const i = MODE_IDS.indexOf(mode);
  const n = MODE_IDS.length;
  for (const slide of document.querySelectorAll("#mode-stage .mode-slide")) {
    // смещение по кругу: -1 — слева, 0 — в центре, 1 — справа
    let off = MODE_IDS.indexOf(slide.dataset.gameMode) - i;
    if (off > n / 2) off -= n;
    if (off < -n / 2) off += n;
    slide.style.setProperty("--off", off);
    slide.classList.toggle("active", off === 0);
    slide.classList.toggle("side", Math.abs(off) === 1);
    slide.setAttribute("aria-selected", off === 0);
    slide.tabIndex = off === 0 ? 0 : -1;
  }
  for (const dot of document.querySelectorAll("#mode-dots i")) dot.classList.toggle("on", dot.dataset.gameMode === mode);
  $("screen-modes").style.setProperty("--c", MODES[mode].color);

  if (animate) {
    // карточка ещё едет — кольцо рисуем там, где она остановится: по центру, на месте иконки
    const cur = document.querySelector(`#mode-stage [data-game-mode="${mode}"]`);
    const stage = $("mode-stage").getBoundingClientRect();
    const icon = cur.querySelector(".slide-icon");
    const y = stage.top + cur.offsetTop + icon.offsetTop + icon.offsetHeight / 2;
    fx.ring(stage.left + stage.width / 2, y, getComputedStyle(cur).getPropertyValue("--c").trim(), 120, 4);
  }
  renderModeInfo();
}

function setPace(p) {
  pace = p;
  try { localStorage.setItem("arrowrush.pace", p); } catch { /* ничего */ }
  for (const t of document.querySelectorAll("#pace-tabs .tab")) {
    const on = t.dataset.pace === p;
    t.classList.toggle("active", on);
    t.setAttribute("aria-checked", on);
  }
  $("pace-tabs").dataset.active = p === "fast" ? "1" : "0";
  renderModeInfo();
}

for (const t of document.querySelectorAll("#pace-tabs .tab")) {
  t.addEventListener("click", () => { if (t.dataset.pace !== pace) setPace(t.dataset.pace); });
}

/** Описания и итоги на карточках режимов — под выбранный темп. В «Хардкоре» паузы за ошибку нет. */
function renderModeInfo() {
  for (const slide of document.querySelectorAll("#mode-stage .mode-slide")) {
    const mode = slide.dataset.gameMode;
    const paceDesc = pace === "fast" && mode !== "hardcore" ? PACES.fast.desc + " Ошибка — пауза." : PACES[pace].desc;
    slide.querySelector(".slide-desc").textContent = `${MODES[mode].desc} ${paceDesc}`;
    const s = profile && profile.stats[mode][pace];
    slide.querySelector(".slide-meta").textContent = !s ? "" : s.games ? `Побед: ${s.wins} из ${s.games}` : "Ещё не играл";
  }
}

setGameMode(gameMode);
setPace(pace);

/** Экран статистики: итоги по всем режимам и таблица «режим × темп». */
function renderStats() {
  if (!profile) return;
  let games = 0, wins = 0;
  for (const mode of MODE_IDS) for (const p of Object.keys(PACES)) {
    games += profile.stats[mode][p].games;
    wins += profile.stats[mode][p].wins;
  }
  fx.countUp($("st-games"), games);
  fx.countUp($("st-wins"), wins);
  if (games) fx.countUp($("st-rate"), Math.round((wins / games) * 100));
  else $("st-rate").textContent = "—";
  fx.countUp($("st-best"), profile.streak.best);

  const table = $("mode-table");
  table.innerHTML = `<div class="mt-row mt-head"><span>Режим</span><span>Обычный</span><span>Быстрый</span></div>`;
  for (const mode of MODE_IDS) {
    const row = document.createElement("div");
    row.className = "mt-row";
    row.style.setProperty("--c", MODES[mode].color);
    const cell = (s) => s.games ? `<b>${s.wins}</b> из ${s.games}` : `<span class="muted">—</span>`;
    row.innerHTML = `<span class="mt-mode"><i></i>${MODES[mode].name}</span><span>${cell(profile.stats[mode].normal)}</span><span>${cell(profile.stats[mode].fast)}</span>`;
    table.appendChild(row);
  }
  renderModeInfo();
}

/** Значок серии побед у ника: виден с двух побед подряд, оформлен надетым скином серии. */
function renderStreak() {
  const n = profile.streak.current;
  const badge = $("streak-badge");
  badge.hidden = n < 2;
  badge.className = `streak-badge streak-${profile.equipped.streak}`;
  $("streak-num").textContent = n;
}

function applyProfile(p) {
  profile = p;
  $("profile-name").textContent = p.userName;
  $("profile-avatar").textContent = p.userName.slice(0, 1).toUpperCase();
  renderStats();
  renderStreak();
  const open = p.skins.filter((s) => s.unlocked).length;
  $("skins-count").textContent = `открыто ${open} из ${p.skins.length}`;
  if (screen === "skins") renderSkins();

  const list = $("history-list");
  list.innerHTML = "";
  p.recent.forEach((m, i) => {
    const win = m.place === 1 && m.time != null;
    const li = document.createElement("li");
    li.style.setProperty("--i", i);

    const place = document.createElement("span");
    place.className = "res-place" + (win ? " win" : "");
    place.textContent = m.place;

    const what = document.createElement("span");
    what.className = "res-name";
    const text = document.createElement("span");
    text.className = "n";
    text.textContent = win ? `Победа · ${m.time.toFixed(2)} с`
      : m.time != null ? `${m.place} из ${m.players} · ${m.time.toFixed(2)} с`
      : m.left ? `Вышел · ${m.sliders}/${m.total}`
      : `${m.place} из ${m.players} · ${m.sliders}/${m.total}`;
    const tag = document.createElement("span");
    tag.className = "tag-mode";
    tag.textContent = modeLabel(m.mode, m.fast).toLowerCase();
    what.append(text, tag);

    const when = document.createElement("span");
    when.className = "res-time";
    when.textContent = formatDate(new Date(m.playedAt));

    li.append(place, what, when);
    list.appendChild(li);
  });
  $("history").hidden = p.recent.length === 0;
}

// ---------- Скины ----------

$("btn-skins").addEventListener("click", () => {
  show("skins");
  renderSkins();
});
$("btn-skins-back").addEventListener("click", () => show("menu"));

$("btn-play").addEventListener("click", () => {
  show("modes");
  setGameMode(gameMode); // карусель могла измениться, пока экран был скрыт
});
$("btn-modes-back").addEventListener("click", () => show("menu"));
$("btn-stats").addEventListener("click", () => {
  show("stats");
  renderStats();
});
$("btn-stats-back").addEventListener("click", () => show("menu"));

for (const t of document.querySelectorAll("#skin-tabs .tab")) {
  t.addEventListener("click", () => {
    skinSlot = t.dataset.slot;
    for (const o of document.querySelectorAll("#skin-tabs .tab")) o.classList.toggle("active", o === t);
    $("skin-tabs").dataset.active = SKIN_SLOTS.indexOf(skinSlot);
    renderSkins();
  });
}

/** Мини-дорожка из четырёх ползунков, которые сами заполняются, — превью скина ползунков. */
function sliderPreview(skin) {
  const track = document.createElement("div");
  track.className = `track mini skin-${skin}`;
  [1, 3, 0, 2].forEach((arrow, k) => {
    const el = document.createElement("div");
    el.className = "slider current";
    el.style.setProperty("--c", `var(--a${arrow})`);
    el.style.setProperty("--k", k);
    el.innerHTML = `<div class="bar"><div class="fill"></div></div><div class="key">${arrowSvg(arrow)}</div>`;
    track.appendChild(el);
  });
  return track;
}

function fxPreview(skin) {
  const [icon, color] = FX_PREVIEW[skin.id] || ["?", "var(--muted)"];
  const tile = document.createElement("div");
  tile.className = "fx-tile";
  tile.style.setProperty("--c", color);
  if (icon.startsWith("#")) tile.innerHTML = `<svg viewBox="0 0 24 24"><use href="${icon}"/></svg>`;
  else tile.textContent = icon;
  return tile;
}

/** Проигрывает эффект скина над элементом. */
function playSkinFx(slot, id, el, power = 1) {
  const [x, y] = fx.anchor(el);
  if (slot === "win") fx.win(id, x, y);
  else if (slot === "streak") fx.streak(id, x, y, power);
}

function renderSkins() {
  if (!profile) return;
  const grid = $("skin-grid");
  grid.innerHTML = "";
  $("skin-error").textContent = "";

  profile.skins.filter((s) => s.slot === skinSlot).forEach((s, i) => {
    const on = profile.equipped[s.slot] === s.id;
    const card = document.createElement("div");
    card.className = "skin-card glass" + (on ? " equipped" : "") + (s.unlocked ? "" : " locked");
    card.style.setProperty("--i", i);

    const preview = document.createElement("div");
    preview.className = "skin-preview";
    preview.appendChild(s.slot === "slider" ? sliderPreview(s.id) : fxPreview(s));
    if (!s.unlocked) preview.insertAdjacentHTML("beforeend", `<span class="skin-lock"><svg viewBox="0 0 24 24"><use href="#lock"/></svg></span>`);

    const name = document.createElement("div");
    name.className = "skin-name";
    name.textContent = s.name;

    const req = document.createElement("div");
    req.className = "skin-req";
    if (s.by === "free") {
      req.textContent = "Есть у всех";
    } else if (s.unlocked) {
      req.textContent = UNLOCK_TEXT[s.by](s.need);
    } else {
      req.innerHTML = `<span></span><span class="skin-progress"><i></i></span><b></b>`;
      req.firstChild.textContent = UNLOCK_TEXT[s.by](s.need);
      req.querySelector("i").style.width = `${Math.min(100, (s.have / s.need) * 100)}%`;
      req.querySelector("b").textContent = `${Math.min(s.have, s.need)} / ${s.need}`;
    }

    const buttons = document.createElement("div");
    buttons.className = "skin-buttons";
    if (s.slot !== "slider") {
      const look = document.createElement("button");
      look.className = "btn ghost small";
      look.textContent = "Посмотреть";
      look.addEventListener("click", () => playSkinFx(s.slot, s.id, preview, 1.5));
      buttons.appendChild(look);
    }
    if (s.unlocked) {
      const wear = document.createElement("button");
      wear.className = on ? "btn ghost small" : "btn primary small";
      wear.textContent = on ? "Надето" : "Надеть";
      wear.disabled = on;
      wear.addEventListener("click", () => equipSkin(s, wear, preview));
      buttons.appendChild(wear);
    }

    card.append(preview, name, req, buttons);
    grid.appendChild(card);
  });
}

async function equipSkin(skin, btn, preview) {
  btn.disabled = true;
  try {
    const r = await api("POST", "skin", { slot: skin.slot, id: skin.id });
    if (!r.ok) {
      $("skin-error").textContent = (r.data && r.data.error) || "Не получилось надеть скин";
      btn.disabled = false;
      return;
    }
    profile.equipped[skin.slot] = skin.id;
    renderStreak();
    renderSkins();
    const [x, y] = fx.anchor(preview);
    fx.ring(x, y, fx.colors[1], 120, 4);
  } catch {
    $("skin-error").textContent = "Сервер недоступен";
    btn.disabled = false;
  }
}

function formatDate(d) {
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const today = new Date().toDateString() === d.toDateString();
  return today ? time : `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}, ${time}`;
}

conn.on("queued", (d) => {
  if (!search) return;
  search.inQueue = d.inQueue;
  search.botAfter = d.botAfter;
  updateSearch();
});

conn.on("matchStart", startMatch);

conn.on("state", (s) => {
  if (!match) return;
  lastState = s;
  stateAt = performance.now();
});

conn.on("matchEnd", showResults);

// ---------- Меню и поиск ----------

$("btn-find").addEventListener("click", () => findMatch(false));
$("btn-practice").addEventListener("click", () => findMatch(true));
$("btn-again").addEventListener("click", () => findMatch(lastPractice));
$("btn-menu").addEventListener("click", () => show("menu"));

$("btn-cancel").addEventListener("click", () => {
  conn.invoke("CancelSearch").catch(() => {});
  stopSearch();
  show("modes");
});

$("btn-leave").addEventListener("click", () => {
  conn.invoke("LeaveMatch").catch(() => {});
  match = null;
  show("menu");
});

/** practice — тренировка: сервер сразу стартует матч с ботом, экран поиска не нужен. */
async function findMatch(practice) {
  if (conn.state !== signalR.HubConnectionState.Connected) return;
  lastPractice = practice;

  if (!practice) {
    search = { startedAt: performance.now(), inQueue: 1, botAfter: 12, timer: null };
    search.timer = setInterval(updateSearch, 250);
    updateSearch();
    $("search-mode").textContent = `Режим: ${modeLabel(gameMode, pace === "fast")}`;
    show("search");
  }

  try {
    await conn.invoke("FindMatch", gameMode, pace === "fast", practice);
  } catch (e) {
    // текст HubException с сервера приходит после "HubException: "
    const msg = String((e && e.message) || "").split("HubException: ")[1];
    abortToMenu(msg || "Не удалось начать поиск");
  }
}

function updateSearch() {
  if (!search) return;
  const sec = Math.floor((performance.now() - search.startedAt) / 1000);
  $("search-timer").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  $("search-info").textContent = `В очереди: ${search.inQueue}`;

  const botIn = Math.max(0, Math.ceil(search.botAfter - sec));
  $("search-bot").textContent = search.inQueue > 1
    ? "Соперник найден, собираем лобби…"
    : botIn > 0 ? `Если никого не найдём, через ${botIn} с сыграешь с ботом` : "Подключаем бота…";
}

function stopSearch() {
  if (search) clearInterval(search.timer);
  search = null;
}

function abortToMenu(message) {
  stopSearch();
  match = null;
  show("menu");
  setConn(message, "bad");
}

// ---------- Матч ----------

function arrowSvg(arrow) {
  return `<svg viewBox="0 0 24 24" style="rotate:${ROTATION[arrow]}deg"><use href="#arrow"/></svg>`;
}

/** Классы дорожки: плотная для режимов с нажатиями, «вслепую», скин ползунков. */
function trackClass(skin) {
  return ["track", match.press && "speed", match.blind && "blind", match.mirror && "mirror", `skin-${skin}`]
    .filter(Boolean).join(" ");
}

function buildTrack(container, level) {
  container.innerHTML = "";
  const sliders = level.map((s) => {
    const el = document.createElement("div");
    el.className = "slider";
    el.style.setProperty("--c", `var(--a${s.arrow})`);
    el.innerHTML = `<div class="bar"><div class="fill"></div></div><div class="key">${arrowSvg(s.arrow)}</div>`;
    container.appendChild(el);
    return { el, fill: el.querySelector(".fill") };
  });
  return { root: container, sliders, idx: -1 };
}

function nameRow(container, player) {
  container.textContent = "";
  const name = document.createElement("span");
  name.textContent = player.name;
  container.appendChild(name);
  if (player.bot) {
    const tag = document.createElement("span");
    tag.className = "tag-bot";
    tag.textContent = "бот";
    container.appendChild(tag);
  }
  const badge = document.createElement("span");
  badge.className = "place-badge";
  badge.hidden = true;
  container.appendChild(badge);
  return badge;
}

function startMatch(d) {
  stopSearch();

  match = {
    mode: d.mode,
    practice: d.practice,
    press: d.fast, // быстрый темп: ползунок — одно нажатие
    mirror: d.mirror,
    blind: d.blind,
    lives: d.lives,
    you: d.you,
    level: d.level,
    players: d.players,
    idleDrain: d.idleDrain,
    wrongDrain: d.wrongDrain,
    stun: d.stun,
    tracks: new Map(),
  };
  pred = newPrediction();
  combo = 0;
  $("combo").hidden = true;

  $("hud-lives-box").hidden = !d.lives;
  $("hud-tag").textContent = modeLabel(d.mode, d.fast) + (d.practice ? " · тренировка" : "");
  $("hud-tag").style.setProperty("--c", MODES[d.mode].color);

  // моя дорожка
  const me = d.players.find((p) => p.slot === d.you);
  $("my-track").className = trackClass(me.skin);
  const myTrack = buildTrack($("my-track"), d.level);
  myTrack.mine = true;
  myTrack.skin = me.skin;
  myTrack.badge = nameRow($("my-name"), { ...me, name: me.name + " (ты)" });
  match.tracks.set(d.you, myTrack);

  // соперники
  const opps = $("opponents");
  opps.innerHTML = "";
  for (const p of d.players.filter((p) => p.slot !== d.you)) {
    const box = document.createElement("div");
    box.className = "opp glass";
    const nameEl = document.createElement("div");
    nameEl.className = "track-name";
    const trackEl = document.createElement("div");
    trackEl.className = trackClass(p.skin);
    box.append(nameEl, trackEl);
    opps.appendChild(box);

    const t = buildTrack(trackEl, d.level);
    t.badge = nameRow(nameEl, p);
    t.box = box;
    match.tracks.set(p.slot, t);
  }

  // стартовый снимок, пока сервер не прислал первый
  lastState = {
    t: -d.countdown,
    players: d.players.map((p) => ({ slot: p.slot, idx: 0, p: 0, held: 0, stun: false, miss: 0, out: false, done: false, place: 0, left: false })),
  };
  stateAt = performance.now();
  sentHeld = -1;
  pushInput();

  show("game");
}

function showResults(r) {
  if (!match) return;
  const you = match.you;
  match = null;

  const me = r.results.find((x) => x.slot === you);
  const win = me && me.done && me.place === 1;

  const title = $("res-title");
  title.textContent = win ? "Победа!" : me ? `${me.place} место` : "Матч окончен";
  title.classList.toggle("win", win);
  $("screen-results").classList.toggle("win", win);

  $("res-sub").textContent = (me && me.done
    ? `Твоё время: ${me.time.toFixed(2)} с`
    : me && me.out ? `Выбыл на ${me.sliders + 1}-м ползунке из ${r.total}`
    : me ? `Заполнено ${me.sliders} из ${r.total} ползунков` : "") + (r.practice ? " · тренировка" : "");

  // серия побед: тренировка не считается; профиль обновим сразу, не дожидаясь сервера
  let streak = 0;
  if (!r.practice && profile && me) {
    streak = win ? profile.streak.current + 1 : 0;
    profile.streak.current = streak;
    profile.streak.best = Math.max(profile.streak.best, streak);
    renderStreak();
  }
  const banner = $("res-streak");
  banner.hidden = streak < 2;
  banner.className = `streak-banner streak-${profile ? profile.equipped.streak : "flame"}`;
  banner.textContent = `Серия побед: ${streak}`;

  const list = $("res-list");
  list.innerHTML = "";
  r.results.forEach((x, i) => {
    const li = document.createElement("li");
    li.style.setProperty("--i", i);
    li.classList.add("p" + x.place);
    if (x.slot === you) li.classList.add("me");

    const place = document.createElement("span");
    place.className = "res-place";
    place.textContent = x.place;

    const name = document.createElement("span");
    name.className = "res-name";
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = x.name;
    name.appendChild(n);
    if (x.bot) {
      const tag = document.createElement("span");
      tag.className = "tag-bot";
      tag.textContent = "бот";
      name.appendChild(tag);
    }

    const time = document.createElement("span");
    time.className = "res-time";
    time.textContent = x.done ? `${x.time.toFixed(2)} с` : x.left ? "вышел" : x.out ? "выбыл" : `${x.sliders}/${r.total}`;

    li.append(place, name, time);
    list.appendChild(li);
  });

  show("results");

  if (win) playSkinFx("win", profile ? profile.equipped.win : "confetti", title);
  if (streak >= 2) setTimeout(() => playSkinFx("streak", profile.equipped.streak, banner, streak / 3), 450);
}

// ---------- Отрисовка (60 fps) ----------

function renderTrack(track, idx, progress, wrong, holding, level) {
  if (track.idx !== idx) {
    const prev = track.idx;
    track.sliders.forEach((s, i) => {
      s.el.classList.toggle("done", i < idx);
      s.el.classList.toggle("current", i === idx);
      s.el.classList.remove("wrong", "holding");
      s.fill.style.height = i < idx ? "" : "0%";
    });
    track.root.classList.toggle("finished", idx >= level.length);
    track.idx = idx;
    if (prev >= 0 && idx > prev) celebrate(track, prev, idx, level);
  }

  // только что ошибся — тряска и красная вспышка
  if (track.mine && wrong && !track.wasWrong) fx.retrigger($("stage"), "hit");
  track.wasWrong = wrong;

  if (idx >= level.length) return;

  const cur = track.sliders[idx];
  cur.fill.style.height = (progress * 100).toFixed(1) + "%";
  cur.el.classList.toggle("wrong", wrong);
  cur.el.classList.toggle("holding", holding);
}

/** Искры над заполненными ползунками, салют на финише. */
function celebrate(track, from, to, level) {
  const finished = to >= level.length;

  if (track.mine) {
    const speed = match.press;
    for (let i = from; i < Math.min(to, level.length); i++) {
      const [x, y] = fx.anchor(track.sliders[i].el.querySelector(".bar"), true);
      fx.burst(x, y, burstColor(track.skin, level[i].arrow, i), speed ? 10 : 24, speed ? 0.7 : 1);
    }
    if (finished) {
      const [x, y] = fx.anchor(track.root);
      fx.arrowsFrom(x, y, 24);
      fx.confetti(70);
    }
  } else if (finished && track.box) {
    track.box.classList.add("finished");
    const [x, y] = fx.anchor(track.box);
    fx.ring(x, y, fx.colors[1], 140);
  }
}

/** Цвет искр над заполненным ползунком — под скин ползунков. */
function burstColor(skin, arrow, i) {
  if (skin === "gold") return "#f2ad16";
  if (skin === "rainbow") return fx.colors[i % 4];
  return fx.colors[arrow];
}

/** Режимы с нажатиями: счётчик серии без ошибок; каждые 10 — эффект серии побед. */
function showCombo() {
  const el = $("combo");
  if (combo < 3) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = `x${combo}`;
  el.classList.toggle("hot", combo >= 10);
  fx.retrigger(el, "pop");
  if (combo % 10 === 0) playSkinFx("streak", profile ? profile.equipped.streak : "flame", el, 0.5);
}

/** Режимы с нажатиями: сверяем своё предсказание с сервером. */
function syncPrediction(server, now) {
  if (server.done) pred.idx = match.level.length;
  // сервер впереди — догоняем сразу; расходимся в другую сторону — ждём, пока дойдут последние нажатия
  else if (server.idx > pred.idx || (server.idx !== pred.idx && now - pred.lastPress > 400)) pred.idx = server.idx;
  if (server.miss > pred.miss) pred.miss = server.miss;
  if (server.out) pred.out = true;
}

function renderLives() {
  const left = Math.max(0, match.lives - pred.miss);
  $("hud-lives").textContent = "♥".repeat(left) + "♡".repeat(match.lives - left);
}

function render(now) {
  const st = lastState;
  const level = match.level;
  const elapsed = Math.min((now - stateAt) / 1000, 0.2);
  const t = st.t + elapsed;

  // отсчёт: каждая цифра «влетает», от центра расходится кольцо
  const label = t < 0 ? String(Math.ceil(-t)) : t < 0.6 ? "СТАРТ!" : "";
  if (label !== match.cdLabel) {
    match.cdLabel = label;
    const num = $("cd-num");
    num.textContent = label;
    if (label) {
      fx.retrigger(num, "tick");
      const [x, y] = fx.anchor($("stage"));
      fx.ring(x, y, t < 0 ? fx.colors[0] : fx.colors[1], t < 0 ? 160 : 320, t < 0 ? 3 : 6);
    }
  }
  $("countdown").className = !label ? "countdown" : t < 0 ? "countdown show" : "countdown show go";

  $("hud-time").textContent = Math.max(0, t).toFixed(1);

  const speed = match.press;

  for (const p of st.players) {
    const track = match.tracks.get(p.slot);
    if (!track) continue;

    const isMe = p.slot === match.you;
    let idx = p.idx;
    let progress = p.p;
    let wrong = false;
    let holding = false;

    if (speed) {
      progress = 0;
      if (isMe) {
        syncPrediction(p, now);
        idx = pred.idx;
        wrong = now < Math.max(pred.stunUntil, pred.hitUntil);
      } else {
        wrong = p.stun;
      }
    } else {
      const mask = t < 0 ? 0 : isMe ? held : p.held;

      // предсказание своего ползунка между снимками сервера — чтобы было плавно
      if (isMe && t >= 0 && !p.done && !p.left && p.idx < level.length) {
        const target = 1 << targetOf(level[p.idx].arrow);
        if (held === 0) progress -= match.idleDrain * elapsed;
        else if ((held & ~target) !== 0) progress -= match.wrongDrain * elapsed;
        else progress += elapsed / level[p.idx].fill;
        progress = Math.min(1, Math.max(0, progress));
      }

      if (idx < level.length) {
        const target = 1 << targetOf(level[idx].arrow);
        wrong = (mask & ~target) !== 0;
        holding = mask === target;
      }
    }

    renderTrack(track, idx, progress, wrong, holding, level);

    if (p.done || p.out) {
      track.badge.hidden = false;
      track.badge.textContent = p.done ? `${p.place} место` : "выбыл";
      track.badge.classList.toggle("out", !p.done);
    }
    if (track.box) track.box.classList.toggle("left", p.left || p.out);
  }

  // подсказки для меня
  const mine = st.players.find((p) => p.slot === match.you);
  if (!mine) return;
  // при удержании ошибки считает только сервер
  if (!speed) { pred.miss = mine.miss; pred.out = mine.out; }
  if (match.lives) renderLives();

  const myIdx = speed ? pred.idx : mine.idx;
  const myDone = mine.done || myIdx >= level.length;
  $("hud-count").textContent = `${Math.min(myIdx + (myDone ? 0 : 1), level.length)} / ${level.length}`;

  const need = $("need");
  need.classList.remove("bad");
  if (myDone) {
    need.textContent = `Финиш! Ждём остальных…`;
  } else if (pred.out || mine.out) {
    need.textContent = "Ошибки кончились — ты выбыл. Ждём остальных…";
    need.classList.add("bad");
  } else if (t < 0) {
    need.textContent = match.mirror ? "Зеркало: жми наоборот!" : `Первая стрелка: ${ARROW_CHAR[level[0].arrow]}`;
  } else if (speed) {
    if (now < pred.stunUntil) {
      need.textContent = "Не та стрелка! Пауза…";
      need.classList.add("bad");
    } else if (now < pred.hitUntil) {
      need.textContent = `Мимо! Осталось ошибок: ${Math.max(0, match.lives - pred.miss)}`;
      need.classList.add("bad");
    } else {
      need.textContent = `Жми ${ARROW_CHAR[level[myIdx].arrow]}`;
    }
  } else {
    const target = 1 << targetOf(level[mine.idx].arrow);
    if ((held & ~target) !== 0) {
      need.textContent = "Не та стрелка!";
      need.classList.add("bad");
    } else if (held === 0) {
      // в «Зеркале» не подсказываем ответ, иначе режим теряет смысл
      need.textContent = match.mirror ? "Держи противоположную стрелку" : `Держи ${ARROW_CHAR[level[mine.idx].arrow]}`;
    } else {
      need.textContent = "";
    }
  }
}

function frame(now) {
  if (screen === "game" && match && lastState) render(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Клавиатура ----------

function pushInput() {
  if (!match || held === sentHeld) return;
  if (conn.state !== signalR.HubConnectionState.Connected) return;
  sentHeld = held;
  conn.send("Input", held).catch(() => {});
}

// выбор режима: ←/→ (или A/D) листают, Enter — найти матч
window.addEventListener("keydown", (e) => {
  if (screen !== "modes" || e.repeat) return;
  const a = KEY_TO_ARROW[e.code];
  if (a === 0 || a === 2) {
    e.preventDefault();
    stepMode(a === 0 ? -1 : 1);
  } else if (e.code === "Enter" && !$("btn-find").disabled && document.activeElement?.tagName !== "BUTTON") {
    e.preventDefault();
    findMatch(false);
  }
});

/** Стрелку зажали — с клавиатуры или экранной кнопкой. */
function pressArrow(a) {
  const bit = 1 << a;
  if (!(held & bit)) predictPress(bit); // автоповтор зажатой клавиши — не новое нажатие
  held |= bit;
  pushInput();
}

function releaseArrow(a) {
  held &= ~(1 << a);
  pushInput();
}

window.addEventListener("keydown", (e) => {
  if (screen !== "game") return;
  const a = KEY_TO_ARROW[e.code];
  if (a === undefined) return;
  e.preventDefault();
  pressArrow(a);
});

// экранные стрелки для телефона: каждая кнопка держится своим пальцем, можно зажать несколько сразу
for (const key of document.querySelectorAll("#touchpad [data-arrow]")) {
  const a = Number(key.dataset.arrow);
  key.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    key.setPointerCapture(e.pointerId); // палец съехал с кнопки — она всё равно держится, пока его не отпустят
    key.classList.add("down");
    if (navigator.vibrate) navigator.vibrate(8);
    if (screen === "game") pressArrow(a);
  });
  const up = () => {
    if (!key.classList.contains("down")) return;
    key.classList.remove("down");
    releaseArrow(a);
  };
  key.addEventListener("pointerup", up);
  key.addEventListener("pointercancel", up);
  key.addEventListener("lostpointercapture", up);
  key.addEventListener("contextmenu", (e) => e.preventDefault()); // долгое нажатие не открывает меню
}

/** Режимы с нажатиями: те же правила, что на сервере (Match.Press), — чтобы ползунок заполнялся мгновенно. */
function predictPress(bit) {
  if (!match || !match.press || !lastState) return;
  const now = performance.now();
  const t = lastState.t + Math.min((now - stateAt) / 1000, 0.2);
  if (t < 0 || pred.out || pred.idx >= match.level.length || now < pred.stunUntil) return;

  pred.lastPress = now;
  if (bit === 1 << targetOf(match.level[pred.idx].arrow)) {
    pred.idx++;
    combo++;
  } else {
    combo = 0;
    pred.hitUntil = now + 300;
    if (!match.lives) pred.stunUntil = now + match.stun * 1000;
    else if (++pred.miss >= match.lives) pred.out = true;
  }
  showCombo();
}

window.addEventListener("keyup", (e) => {
  const a = KEY_TO_ARROW[e.code];
  if (a === undefined) return;
  releaseArrow(a);
});

// переключился на другое окно — считаем, что всё отпущено
window.addEventListener("blur", () => {
  held = 0;
  for (const key of document.querySelectorAll("#touchpad .down")) key.classList.remove("down");
  pushInput();
});

boot();
