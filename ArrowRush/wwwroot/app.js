"use strict";

// Стрелки: 0 ← 1 ↑ 2 → 3 ↓ (так же, как enum Arrow на сервере)
const KEY_TO_ARROW = {
  ArrowLeft: 0, ArrowUp: 1, ArrowRight: 2, ArrowDown: 3,
  KeyA: 0, KeyW: 1, KeyD: 2, KeyS: 3,
};
const ARROW_CHAR = ["←", "↑", "→", "↓"];

// порядок здесь — порядок карточек в меню; правила режимов присылает сервер в matchStart
const MODES = {
  classic: { name: "Классика", icon: "bar", color: "var(--a1)", desc: "Без особых правил." },
  mirror: { name: "Зеркало", icon: "mirror", color: "var(--a0)", desc: "Жми стрелку, противоположную нарисованной: ← значит →, ↑ значит ↓." },
  blind: { name: "Вслепую", icon: "eye", color: "var(--a3)", desc: "Видна только текущая стрелка, следующие спрятаны." },
  hardcore: { name: "Хардкор", icon: "heart", color: "var(--bad)", desc: "Без пауз за ошибку, но три ошибки — и ты выбыл." },
  teams: { name: "2 на 2", icon: "team", color: "var(--a2)", seats: 4, desc: "Две команды по двое: чей игрок финишировал первым, та команда и победила." },
  teams5: { name: "5 на 5", icon: "team", color: "var(--gold)", seats: 10, desc: "Две команды по пять человек, уровень в 4 раза длиннее. Чей игрок финишировал первым, та команда и победила." },
};
// темп выбирается для любого режима
const PACES = {
  normal: { name: "обычный", desc: "Держи стрелку, пока ползунок не заполнится." },
  fast: { name: "быстрый", desc: "Одно нажатие — один ползунок, но их намного больше." },
};
// сложность — для матчей и тренировок; сам баланс задаёт сервер (GameRules.cs)
const DIFFS = {
  easy: { name: "лёгкая", desc: "Меньше ползунков, штрафы мягче, бот медлительный." },
  normal: { name: "нормальная", desc: "Обычный баланс." },
  hard: { name: "сложная", desc: "Больше ползунков, заполняются быстрее, штрафы и паузы жёстче, бот почти не ошибается." },
};

const MATE_COLOR = "#2fd6a8"; // «2 на 2»: напарник на траектории и его полоса внизу
const MAX_MATES_DRAWN = 4;    // в большой команде на траектории видны не все: иначе ники закроют уровень
const SKIN_SLOTS = ["slider", "hero", "win", "streak", "music"];
// кайма следа персонажа по скину ячеек; цвета стрелок от скина не зависят
const SKIN_TRAIL = { classic: "#b9c4ff", neon: "#39ffd0", candy: "#ff9ad5", pixel: "#7df9ff", gold: "#f2ad16", ocean: "#3fb6ff", lava: "#ff6a2b", mint: "#6fffc4" };
// экраны, где играет спокойная музыка меню; в матче её сменяет боевой трек
const MENU_SCREENS = new Set(["auth", "menu", "modes", "stats", "skins", "search", "rewards", "lobby"]);
// советы под витриной в меню
const TIPS = [
  "В «Зеркале» держи стрелку, противоположную нарисованной.",
  "За золотой ячейкой идут 10 одинаковых стрелок.",
  "В быстром темпе для двух одинаковых стрелок отпусти клавишу и нажми снова.",
  "В «Хардкоре» нет пауз за ошибку, но три ошибки — и ты выбыл.",
  "Можно играть на WASD.",
  "Звёзды за задания открывают новые скины.",
  "В командных режимах побеждает команда того, кто финишировал первым.",
  "Свой аудиофайл можно превратить в ритм-уровень.",
];
const TIP_MS = 12000;
const UNLOCK_TEXT = {
  games: (n) => `Сыграй ${n} ${plural(n, "матч", "матча", "матчей")}`,
  wins: (n) => `Выиграй ${n} ${plural(n, "матч", "матча", "матчей")}`,
  sliders: (n) => `Заполни ${n} ползунков`,
  streak: (n) => `Выиграй ${n} ${plural(n, "раз", "раза", "раз")} подряд`,
  stars: (n) => `Собери ${n} ★ за награды`,
};
// превью эффектов на экране скинов: значок (символ или #id из <svg> в index.html) и цвет плитки
const FX_PREVIEW = {
  rush: ["#arrow", "var(--a2)"], nova: ["✦", "var(--gold)"], frost: ["❄", "var(--a0)"], finale: ["✺", "var(--a3)"],
  flame: ["#flame", "var(--a2)"], electric: ["#bolt", "var(--a0)"], rainbow: ["◉", "var(--a1)"],
  sapphire: ["✦", "#4fa8ff"], redgiant: ["✦", "#ff3b3b"], frost2: ["❄", "#9fe3ff"], toxic: ["☣", "#b6ff3c"],
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
let difficulty = "normal";
try {
  if (DIFFS[localStorage.getItem("arrowrush.difficulty")]) difficulty = localStorage.getItem("arrowrush.difficulty");
  if (MODES[localStorage.getItem("arrowrush.mode")]) gameMode = localStorage.getItem("arrowrush.mode");
  else if (localStorage.getItem("arrowrush.mode") === "speed") pace = "fast"; // бывший режим «Скорость»
  if (PACES[localStorage.getItem("arrowrush.pace")]) pace = localStorage.getItem("arrowrush.pace");
} catch { /* приватный режим */ }

/** «Зеркало · быстрый · сложная» — режим, темп и (если не нормальная) сложность одной строкой. */
function modeLabel(mode, fast, diff = "normal") {
  const label = `${MODES[mode].name} · ${PACES[fast ? "fast" : "normal"].name}`;
  return diff !== "normal" && DIFFS[diff] ? `${label} · ${DIFFS[diff].name}` : label;
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
  for (const s of ["auth", "menu", "modes", "stats", "skins", "search", "rewards", "lobby", "game", "rhythm", "results"]) {
    $("screen-" + s).classList.toggle("active", s === name);
  }
  // ушли из «Своего трека» или из матча — музыку останавливаем (итоги сами гасят её плавно)
  if (screen === "rhythm" && name !== "rhythm") rhythm.stop();
  if (screen === "game" && name !== "game") music.stop(0.4);
  music.menu(MENU_SCREENS.has(name));
  // новый экран уже на месте (его можно измерять), занавес поверх него уезжает вверх
  if (name !== screen) fx.retrigger($("curtain"), "lift");
  screen = name;
  document.body.dataset.screen = name; // по нему CSS показывает экранные стрелки и прячет панель друзей
  if (name === "auth" || name === "game" || name === "rhythm") social.close();
  fx.setCalm(name === "game" || name === "rhythm");
  if (name === "menu") refreshProfile();
  if (name === "lobby") lobby.refresh();
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
  $("btn-lobby-create").disabled = !ok;
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
  lobby.reset(); // сервер считает, что мы вышли
  lobby.sync();
  if (screen === "game" || screen === "search") {
    // после переподключения сервер считает, что мы вышли
    abortToMenu("Соединение прерывалось — матч отменён");
  } else {
    setConn("Подключено", "ok");
  }
});

conn.onclose(() => {
  setPlayable(false);
  lobby.reset();
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
    lobby.sync();
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

function setDifficulty(d) {
  difficulty = d;
  try { localStorage.setItem("arrowrush.difficulty", d); } catch { /* ничего */ }
  const tabs = [...document.querySelectorAll("#diff-tabs .tab")];
  tabs.forEach((t) => {
    const on = t.dataset.difficulty === d;
    t.classList.toggle("active", on);
    t.setAttribute("aria-checked", on);
  });
  $("diff-tabs").dataset.active = tabs.findIndex((t) => t.dataset.difficulty === d);
  $("diff-tabs").dataset.level = d;
  $("diff-desc").textContent = DIFFS[d].desc;
}

for (const t of document.querySelectorAll("#diff-tabs .tab")) {
  t.addEventListener("click", () => { if (t.dataset.difficulty !== difficulty) setDifficulty(t.dataset.difficulty); });
}
setDifficulty(difficulty);

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

// вкладки экрана режимов: матч, лобби, свой трек
let modeTab = "match";

function setModeTab(tab) {
  modeTab = tab;
  const tabs = [...document.querySelectorAll("#mode-tabs .tab")];
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $("mode-tabs").dataset.active = tabs.findIndex((t) => t.dataset.tab === tab);
  for (const name of ["match", "lobby", "track"]) $(`mode-panel-${name}`).hidden = name !== tab;
  if (tab === "match") setGameMode(gameMode); // карусель меряется только видимой
  if (tab === "lobby") lobby.loadPublic();
}

for (const t of document.querySelectorAll("#mode-tabs .tab")) {
  t.addEventListener("click", () => setModeTab(t.dataset.tab));
}

let statTab = "all";     // открытая вкладка статистики: "all" или id режима

const paceText = (s) => (s.bestRate ? `${s.bestRate.toFixed(1)}/с` : "—");

// показатели, которые есть только у этой вкладки; общие (матчи, победы, %, К/Д) — у всех
const STAT_EXTRA = {
  all: (s) => [[profile.streak.best, "лучшая серия"], [s.sliders, "ползунков"]],
  classic: (s) => [[s.finishes, "финишей"], [paceText(s), "лучший темп"]],
  mirror: (s) => [[paceText(s), "лучший темп"], [s.sliders, "ползунков"]],
  blind: (s) => [[s.finishes, "финишей"], [s.sliders, "ползунков"]],
  hardcore: (s) => [[s.finishes, "дошёл до конца"], [s.games - s.finishes, "не дошёл"]],
  teams: (s) => [[s.carries, "финишировал первым"], [s.wins - s.carries, "вытащил напарник"]],
  teams5: (s) => [[s.carries, "финишировал первым"], [s.wins - s.carries, "вытащил напарник"]],
};

/** К/Д: сколько соперников обошёл на одного, кто обошёл тебя. */
function kd(s) {
  if (!s.kills && !s.deaths) return "—";
  return (s.deaths ? s.kills / s.deaths : s.kills).toFixed(2);
}

/** Сумма итогов по списку; лучший темп — наибольший, а не сумма. */
function sumStats(list) {
  const sum = { games: 0, wins: 0, sliders: 0, kills: 0, deaths: 0, finishes: 0, carries: 0, bestRate: 0 };
  for (const s of list) {
    for (const key of Object.keys(sum)) sum[key] = key === "bestRate" ? Math.max(sum[key], s[key]) : sum[key] + s[key];
  }
  return sum;
}

const modeTotal = (mode) => sumStats(Object.keys(PACES).map((p) => profile.stats[mode][p]));

for (const id of ["all", ...MODE_IDS]) {
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "stat-tab";
  tab.setAttribute("role", "tab");
  tab.dataset.tab = id;
  tab.textContent = id === "all" ? "Все режимы" : MODES[id].name;
  tab.addEventListener("click", () => { statTab = id; renderStats(); });
  $("stat-tabs").appendChild(tab);
}

/** Строка таблицы: первая колонка — подпись, в остальных уже готовый текст. */
function statRow(table, title, color, cells) {
  const row = document.createElement("div");
  row.className = "mt-row";
  row.style.setProperty("--c", color);
  row.innerHTML = `<span class="mt-mode"><i></i>${title}</span>${cells.map((c) => `<span>${c}</span>`).join("")}`;
  table.appendChild(row);
}

/** Экран статистики: вкладка «Все режимы» или один режим со своими показателями. */
function renderStats() {
  if (!profile) return;
  for (const tab of document.querySelectorAll("#stat-tabs .stat-tab")) {
    const on = tab.dataset.tab === statTab;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", on);
  }

  const all = statTab === "all";
  const s = all ? sumStats(MODE_IDS.map(modeTotal)) : modeTotal(statTab);
  const tiles = $("stat-tiles");
  tiles.innerHTML = "";
  const rate = s.games ? Math.round((s.wins / s.games) * 100) : "—";
  for (const [value, label] of [[s.games, "матчей"], [s.wins, "побед"], [rate, "% побед"], [kd(s), "К/Д"], ...STAT_EXTRA[statTab](s)]) {
    const tile = document.createElement("div");
    tile.className = "stat";
    const num = document.createElement("b");
    num.textContent = typeof value === "number" ? "0" : value;
    const name = document.createElement("span");
    name.textContent = label;
    tile.append(num, name);
    tiles.appendChild(tile);
    if (typeof value === "number") fx.countUp(num, value);
  }

  const none = `<span class="muted">—</span>`;
  const table = $("mode-table");
  if (all) {
    table.innerHTML = `<div class="mt-row mt-head"><span>Режим</span><span>Обычный</span><span>Быстрый</span><span>К/Д</span></div>`;
    const cell = (x) => (x.games ? `<b>${x.wins}</b> из ${x.games}` : none);
    for (const mode of MODE_IDS) {
      statRow(table, MODES[mode].name, MODES[mode].color, [cell(profile.stats[mode].normal), cell(profile.stats[mode].fast), `<b>${kd(modeTotal(mode))}</b>`]);
    }
  } else {
    table.innerHTML = `<div class="mt-row mt-head"><span>Темп</span><span>Матчи</span><span>Победы</span><span>К/Д</span></div>`;
    for (const p of Object.keys(PACES)) {
      const x = profile.stats[statTab][p];
      statRow(table, PACES[p].name, MODES[statTab].color, x.games ? [`<b>${x.games}</b>`, `<b>${x.wins}</b>`, `<b>${kd(x)}</b>`] : [none, none, none]);
    }
  }
  renderModeInfo();
}

/** Значок серии побед у ника: виден с двух побед подряд, оформлен надетым скином серии. */
function renderShowcase() {
  const s = sumStats(MODE_IDS.map(modeTotal));
  $("showcase-name").textContent = profile.userName;
  course.paintHero($("showcase-hero"), profile.equipped.hero);
  $("showcase-stats").replaceChildren(...[
    [s.games, "матчей"], [s.wins, "побед"], [s.games ? `${Math.round((s.wins / s.games) * 100)}%` : "—", "побед, %"], [profile.streak.best, "серия"],
  ].map(([value, label]) => {
    const tile = document.createElement("div");
    tile.className = "show-stat";
    const num = document.createElement("b");
    num.textContent = value;
    const name = document.createElement("span");
    name.textContent = label;
    tile.append(num, name);
    return tile;
  }));
}

// совет меняется сам, начиная со случайного
{
  let tip = Math.floor(Math.random() * TIPS.length);
  const nextTip = () => { $("menu-tip").textContent = TIPS[tip++ % TIPS.length]; };
  nextTip();
  setInterval(nextTip, TIP_MS);
}
$("btn-showcase").addEventListener("click", () => social.open(profile.userName));

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
  social.paintAvatar($("profile-avatar"), p.userName, p.color);
  social.loadFriends();
  rewards.load();
  renderShowcase();
  renderStats();
  renderStreak();
  const open = p.skins.filter((s) => s.unlocked).length;
  $("skins-count").textContent = `открыто ${open} из ${p.skins.length}`;
  if (screen === "skins") renderSkins();

  const list = $("history-list");
  list.innerHTML = "";
  p.recent.forEach((m, i) => list.appendChild(historyItem(m, i)));
  $("history").hidden = p.recent.length === 0;
}

/** Строка истории матчей: в статистике и в профилях. */
function historyItem(m, i) {
  const win = m.won;
  const li = document.createElement("li");
  li.style.setProperty("--i", i);

  const place = document.createElement("span");
  place.className = "res-place" + (win ? " win" : "");
  place.textContent = m.place;

  const what = document.createElement("span");
  what.className = "res-name";
  const text = document.createElement("span");
  text.className = "n";
  text.textContent = win ? (m.time != null ? `Победа · ${m.time.toFixed(2)} с` : `Победа · ${m.sliders}/${m.total}`)
    : m.time != null ? `${m.place} из ${m.players} · ${m.time.toFixed(2)} с`
    : m.left ? `Вышел · ${m.sliders}/${m.total}`
    : `${m.place} из ${m.players} · ${m.sliders}/${m.total}`;
  const tag = document.createElement("span");
  tag.className = "tag-mode";
  tag.textContent = modeLabel(m.mode, m.fast, m.difficulty).toLowerCase();
  what.append(text, tag);

  const when = document.createElement("span");
  when.className = "res-time";
  when.textContent = formatDate(new Date(m.playedAt));

  li.append(place, what, when);
  return li;
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

// «Свой трек»: выбор файла → rhythm.js делает уровень под бит
rhythm.init({ show, difficulty: () => difficulty, back: () => show("modes") });
$("btn-rhythm").addEventListener("click", () => $("rh-file").click());
$("rh-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // чтобы тот же файл можно было выбрать ещё раз
  if (file) rhythm.open(file);
});
$("btn-stats").addEventListener("click", () => {
  show("stats");
  renderStats();
  refreshProfile(); // только что сыгранный матч мог записаться уже после возврата в меню
});
$("btn-stats-back").addEventListener("click", () => show("menu"));

social.init({ api, historyItem, me: () => profile, refresh: refreshProfile });
lobby.init({ conn, show, screen: () => screen, onChange: () => social.loadFriends() });
rewards.init({
  api,
  show,
  me: () => profile,
  refresh: refreshProfile,
  skinTile,
  openSkins: (slot) => {
    $("btn-skins").click();
    document.querySelector(`#skin-tabs [data-slot="${slot}"]`).click();
  },
});

for (const t of document.querySelectorAll("#skin-tabs .tab")) {
  t.addEventListener("click", () => {
    skinSlot = t.dataset.slot;
    for (const o of document.querySelectorAll("#skin-tabs .tab")) o.classList.toggle("active", o === t);
    $("skin-tabs").dataset.active = SKIN_SLOTS.indexOf(skinSlot);
    renderSkins();
  });
}

/** Плитка-превью: значок и цвет из таблицы (по умолчанию — эффекты победы и серии). */
function fxPreview(skin, table = FX_PREVIEW) {
  const [icon, color] = table[skin.id] || ["?", "var(--muted)"];
  const tile = document.createElement("div");
  tile.className = "fx-tile";
  tile.style.setProperty("--c", color);
  if (icon.startsWith("#")) tile.innerHTML = `<svg viewBox="0 0 24 24"><use href="${icon}"/></svg>`;
  else tile.textContent = icon;
  return tile;
}

/** Персонаж на плитке — рисует тот же код, что и в матче. */
function heroPreview(id) {
  const tile = document.createElement("div");
  tile.className = "fx-tile";
  tile.style.setProperty("--c", "#2a2150");
  const canvas = document.createElement("canvas");
  canvas.className = "hero-preview";
  canvas.width = canvas.height = 84;
  course.paintHero(canvas, id);
  tile.appendChild(canvas);
  return tile;
}

/** Проигрывает эффект серии побед над элементом. */
function playStreakFx(id, el, power = 1) {
  const [x, y] = fx.anchor(el);
  fx.streak(id, x, y, power);
}

/** Сцена победы с персонажем игрока. */
function playVictory(skin, sub) {
  const hero = document.createElement("canvas");
  hero.width = hero.height = 252;
  course.paintHero(hero, profile ? profile.equipped.hero : "circle");
  victory.play(skin, { title: "ПОБЕДА!", sub, hero });
}

/** Ячейка на плитке; animated — сама заполняется и лопается. */
function cellTile(id, animated) {
  const tile = document.createElement("div");
  tile.className = "fx-tile cell-tile";
  tile.appendChild(cells.preview(id, animated));
  return tile;
}

/** Значок скина для кнопки наград: персонаж и ячейка рисуются, остальное — плитка эффекта. Иней занят скином победы. */
function skinTile(s) {
  if (s.slot === "hero") return heroPreview(s.id);
  if (s.slot === "slider") return cellTile(s.id, false);
  return fxPreview({ id: s.slot === "streak" && s.id === "frost" ? "frost2" : s.id });
}

function renderSkins() {
  if (skinSlot === "music") return renderMusicTab();
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
    preview.appendChild(s.slot === "slider" ? cellTile(s.id, true) : skinTile(s));
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
    if (s.slot === "win" || s.slot === "streak") {
      const look = document.createElement("button");
      look.className = "btn ghost small";
      look.textContent = "Посмотреть";
      look.addEventListener("click", () => (s.slot === "win" ? playVictory(s.id, s.name) : playStreakFx(s.id, preview, 1.5)));
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

// ---------- Музыка меню и матчей (вкладка в скинах) ----------

const MUSIC_TILE = { relax: ["♪", "var(--a1)"], night: ["☾", "var(--a0)"], space: ["✦", "var(--a3)"], custom: ["#note", "var(--a2)"], off: ["#mute", "var(--muted)"], beat: ["#arrow", "var(--a1)"] };

/**
 * Две группы карточек: музыка меню (встроенные треки, свой файл, «без музыки») и музыка в матче
 * (встроенный бит или свой файл). Включённый трек меню играет прямо сейчас.
 */
function renderMusicTab() {
  const grid = $("skin-grid");
  grid.innerHTML = "";
  $("skin-error").textContent = "";

  const menuFile = music.customName("menu");
  musicGroup("В меню", "menu", [
    ...Object.entries(music.menuTracks).map(([id, t]) => ({ id, name: t.name, desc: t.desc })),
    { id: "custom", name: "Свой трек", desc: menuFile ? `Файл: ${menuFile}` : "Любой твой файл — играет по кругу" },
    { id: "off", name: "Без музыки", desc: "Тишина в меню" },
  ], music.menuTrack(), music.setMenuTrack);

  const matchFile = music.customName("match");
  musicGroup("В матче", "match", [
    { id: "beat", name: "Встроенный бит", desc: "Электронный бит, у каждого матча своя мелодия" },
    { id: "custom", name: "Свой трек", desc: matchFile ? `Файл: ${matchFile}` : "Твой файл играет в каждом матче — слышишь его только ты" },
  ], music.matchTrack(), music.setMatchTrack);
}

/** Заголовок и карточки одной группы. kind — "menu" или "match": чей свой файл, set — что включает кнопка. */
function musicGroup(title, kind, items, current, set) {
  const grid = $("skin-grid");
  const h = document.createElement("h3");
  h.className = "skin-group";
  h.textContent = title;
  grid.appendChild(h);
  const fileName = music.customName(kind);

  items.forEach((it, i) => {
    const on = it.id === current;
    const live = on && it.id !== "off" && kind === "menu"; // музыку матча здесь не слышно — без «эквалайзера»
    const card = document.createElement("div");
    card.className = "skin-card glass" + (on ? " equipped" : "") + (live ? " playing" : "");
    card.style.setProperty("--i", grid.children.length);

    const preview = document.createElement("div");
    preview.className = "skin-preview";
    preview.appendChild(fxPreview({ id: it.id }, MUSIC_TILE));
    if (live) preview.insertAdjacentHTML("beforeend", `<span class="eq-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`);

    const name = document.createElement("div");
    name.className = "skin-name";
    name.textContent = it.name;
    const req = document.createElement("div");
    req.className = "skin-req";
    req.textContent = it.desc;

    const buttons = document.createElement("div");
    buttons.className = "skin-buttons";
    if (it.id === "custom") {
      const pick = document.createElement("button");
      pick.className = fileName ? "btn ghost small" : "btn primary small";
      pick.textContent = fileName ? "Другой файл" : "Выбрать файл";
      pick.addEventListener("click", () => $(kind + "-file").click());
      buttons.appendChild(pick);
    }
    if (it.id !== "custom" || fileName) {
      const use = document.createElement("button");
      use.className = on ? "btn ghost small" : "btn primary small";
      use.textContent = on ? (live ? "Играет" : "Выбрано") : "Включить";
      use.disabled = on;
      use.addEventListener("click", () => {
        music.unlock();
        set(it.id);
        renderMusicTab();
      });
      buttons.appendChild(use);
    }

    card.append(preview, name, req, buttons);
    grid.appendChild(card);
  });
}

for (const kind of ["menu", "match"]) {
  $(kind + "-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 80 * 1024 * 1024) { $("skin-error").textContent = "Файл больше 80 МБ — выбери поменьше"; return; }
    try {
      const saved = await music.setCustomFile(file, kind);
      renderMusicTab();
      if (!saved) $("skin-error").textContent = "Браузер не дал сохранить файл — он будет играть только до перезагрузки страницы";
    } catch {
      $("skin-error").textContent = "Не получилось прочитать файл. Подойдут mp3, ogg, wav или m4a.";
    }
  });
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

conn.on("friends", () => social.changed());

// матч записан в базу: прогресс наград и статистика изменились
conn.on("stats", refreshProfile);

conn.on("state", (s) => {
  if (!match) return;
  lastState = s;
  stateAt = performance.now();
});

conn.on("matchEnd", (r) => {
  if (!match) return;
  const me = r.results.find((x) => x.slot === match.you);
  if (me && me.won) celebrateWin();
  victory.after(() => showResults(r));
});

// ---------- Меню и поиск ----------

$("btn-find").addEventListener("click", () => findMatch(false));
$("btn-practice").addEventListener("click", () => findMatch(true));
$("btn-again").addEventListener("click", () => findMatch(lastPractice));
$("btn-menu").addEventListener("click", () => show(lobby.active() ? "lobby" : "menu"));

$("btn-cancel").addEventListener("click", () => {
  conn.invoke("CancelSearch").catch(() => {});
  stopSearch();
  show("modes");
});

// музыка вкл/выкл — запоминается
// звук вкл/выкл — одна настройка на всю игру: кнопка в меню и кнопка в матче
function renderMusicBtn() {
  const off = music.isMuted();
  for (const b of document.querySelectorAll(".music-toggle")) {
    b.classList.toggle("off", off);
    b.setAttribute("aria-pressed", !off);
    b.querySelector("use").setAttribute("href", off ? "#mute" : "#sound");
  }
}
for (const b of document.querySelectorAll(".music-toggle")) {
  b.addEventListener("click", () => {
    music.setMuted(!music.isMuted());
    renderMusicBtn();
  });
}
renderMusicBtn();

// браузер разрешает звук только после первого действия игрока — тогда и заиграет музыка меню
for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, () => music.unlock(), { once: true, capture: true });

$("btn-leave").addEventListener("click", () => {
  conn.invoke("LeaveMatch").catch(() => {});
  match = null;
  show(lobby.active() ? "lobby" : "menu");
});

/** practice — тренировка: сервер сразу стартует матч с ботом, экран поиска не нужен. */
async function findMatch(practice) {
  if (conn.state !== signalR.HubConnectionState.Connected) return;
  lastPractice = practice;
  music.unlock(); // звук браузер разрешает только после нажатия игрока — а это оно

  if (!practice) {
    search = { startedAt: performance.now(), inQueue: 1, botAfter: 12, timer: null };
    search.timer = setInterval(updateSearch, 250);
    updateSearch();
    $("search-mode").textContent = `Режим: ${modeLabel(gameMode, pace === "fast", difficulty)}`;
    show("search");
  }

  try {
    await conn.invoke("FindMatch", gameMode, pace === "fast", difficulty, practice);
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
  if (MODES[gameMode].seats) {
    $("search-info").textContent = `В очереди: ${search.inQueue} из ${MODES[gameMode].seats}`;
    $("search-bot").textContent = botIn > 0 ? `Через ${botIn} с свободные места займут боты` : "Подключаем ботов…";
    return;
  }
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
  // у каждого матча своя мелодия: тональность и аккорды — от его id; бит вступает на «СТАРТ!»
  music.start({ seed: parseInt(d.matchId.slice(0, 6), 16) || 0, fast: d.fast, introSeconds: d.countdown });

  match = {
    mode: d.mode,
    practice: d.practice,
    fromLobby: d.lobby,
    press: d.fast, // быстрый темп: ползунок — одно нажатие
    mirror: d.mirror,
    blind: d.blind,
    lives: d.lives,
    teams: d.teams,
    you: d.you,
    level: d.level,
    idleDrain: d.idleDrain,
    wrongDrain: d.wrongDrain,
    stun: d.stun,
    tracks: new Map(),
  };
  pred = newPrediction();
  combo = 0;
  $("combo").hidden = true;
  $("chart-banner").hidden = true;

  $("hud-lives-box").hidden = !d.lives;
  $("hud-tag").textContent = modeLabel(d.mode, d.fast, d.difficulty) + (d.lobby ? " · лобби" : d.practice ? " · тренировка" : "");
  $("hud-tag").style.setProperty("--c", MODES[d.mode].color);

  // моя дорожка — сцена с траекторией; траектория от id матча, у всех одна
  const me = d.players.find((p) => p.slot === d.you);
  course.start({
    seed: parseInt(d.matchId.slice(0, 8), 16) || 1,
    level: d.level,
    fast: d.fast,
    blind: d.blind,
    mirror: d.mirror,
    theme: d.theme,
    cell: me.skin,
    hero: profile ? profile.equipped.hero : "circle",
    trailOf: (i) => (me.skin === "rainbow" ? fx.colors[i % 4] : SKIN_TRAIL[me.skin] || SKIN_TRAIL.classic),
  });
  match.tracks.set(d.you, {
    mine: true,
    skin: me.skin,
    idx: -1,
    badge: nameRow($("my-name"), { ...me, name: me.name + " (ты)" }),
  });

  // соперники
  const opps = $("opponents");
  opps.innerHTML = "";
  // соперников много — плотная панель: в один ряд напарники, в другой соперники
  $("screen-game").classList.toggle("crowd", d.players.length > 4);
  $("screen-game").classList.toggle("horde", d.players.length > 10);
  // напарник — первым: его полоса другого цвета
  const isMate = (p) => d.teams && p.team === me.team;
  for (const p of d.players.filter((p) => p.slot !== d.you).sort((a, b) => isMate(b) - isMate(a))) {
    const box = document.createElement("div");
    box.className = "opp glass" + (isMate(p) ? " mate" : "");
    const nameEl = document.createElement("div");
    nameEl.className = "track-name";
    const bar = document.createElement("div");
    bar.className = "opp-bar";
    const fill = document.createElement("i");
    const count = document.createElement("span");
    bar.append(fill, count);
    box.append(nameEl, bar);
    opps.appendChild(box);

    const badge = nameRow(nameEl, p);
    if (d.teams) {
      const tag = document.createElement("span");
      tag.className = "tag-bot";
      tag.textContent = isMate(p) ? "напарник" : "соперник";
      nameEl.insertBefore(tag, badge);
    }
    match.tracks.set(p.slot, { box, bar, fill, count, badge, name: p.name, mate: isMate(p) });
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

/**
 * Победная сцена матча, один раз за матч. Без команд первый финиш — уже победа, поэтому она
 * начинается сразу, не дожидаясь остальных; в командах её запускает конец матча.
 */
function celebrateWin() {
  if (match.celebrated) return;
  match.celebrated = true;
  music.stop(0.4);
  playVictory(profile ? profile.equipped.win : "rush", match.teams ? "Твоя команда финишировала первой" : "Первое место");
}

function showResults(r) {
  if (!match) return;
  const you = match.you;
  match = null;
  music.stop(0.6);

  const me = r.results.find((x) => x.slot === you);
  const win = !!(me && me.won);

  const title = $("res-title");
  title.textContent = win ? "Победа!" : r.teams && me ? "Поражение" : me ? `${me.place} место` : "Матч окончен";
  title.classList.toggle("win", win);
  $("screen-results").classList.toggle("win", win);

  const someoneWon = r.results.some((x) => x.won);
  $("res-sub").textContent = (r.teams && me
    ? (win ? "Твоя команда финишировала первой" : someoneWon ? "Соперники финишировали первыми" : "Никто не успел финишировать")
    : me && me.done
    ? `Твоё время: ${me.time.toFixed(2)} с`
    : me && me.out ? `Выбыл на ${me.sliders + 1}-м ползунке из ${r.total}`
    : me ? `Заполнено ${me.sliders} из ${r.total} ползунков` : "") + (r.lobby ? " · лобби" : r.practice ? " · тренировка" : "");

  // из лобби возвращаемся в него: новый матч запускает лидер
  $("btn-again").hidden = r.lobby;
  $("btn-menu").textContent = lobby.active() ? "В лобби" : "В меню";

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
    // у людей ник открывает профиль: отсюда удобно добавить соперника в друзья
    const n = document.createElement(x.bot ? "span" : "button");
    n.className = x.bot ? "n" : "n player-link";
    n.textContent = x.name;
    if (!x.bot) {
      n.type = "button";
      n.addEventListener("click", () => social.open(x.name));
    }
    name.appendChild(n);
    if (x.bot) {
      const tag = document.createElement("span");
      tag.className = "tag-bot";
      tag.textContent = "бот";
      name.appendChild(tag);
    }
    if (r.teams && me) {
      const tag = document.createElement("span");
      tag.className = "tag-bot";
      tag.textContent = x.team === me.team ? "твоя команда" : "соперники";
      name.appendChild(tag);
    }

    const time = document.createElement("span");
    time.className = "res-time";
    time.textContent = x.done ? `${x.time.toFixed(2)} с` : x.left ? "вышел" : x.out ? "выбыл" : `${x.sliders}/${r.total}`;

    li.append(place, name, time);
    list.appendChild(li);
  });

  show("results");

  if (!win) music.jingle(false); // у победы была своя фанфара
  if (streak >= 2) setTimeout(() => playStreakFx(profile.equipped.streak, banner, streak / 3), 450);
}

// ---------- Отрисовка (60 fps) ----------

/** Своя дорожка: сцена рисует её сама, здесь — только искры и удары по событиям. */
function trackMine(track, idx, wrong, level) {
  if (track.idx !== idx) {
    const prev = track.idx;
    track.idx = idx;
    if (prev >= 0 && idx > prev) {
      celebrate(track, prev, idx, level);
      for (let i = prev; i < Math.min(idx, level.length); i++) if (level[i].chart) chartPassed(i);
    }
  }
  if (wrong && !track.wasWrong) {
    fx.retrigger($("stage"), "hit");
    course.hit();
    music.miss();
  }
  track.wasWrong = wrong;
}

/** Пройден чарт: следующие ячейки на экране игрока стали одинаковыми. */
function chartPassed(i) {
  const banner = $("chart-banner");
  banner.textContent = "ЧАРТ! Следующие 10 — одинаковые";
  banner.hidden = false;
  fx.retrigger(banner, "pop");
  clearTimeout(banner._hide);
  banner._hide = setTimeout(() => { banner.hidden = true; }, 1800);
  course.chart(i);
  music.jingle(true);
}

/** Соперник: полоса прогресса на весь уровень. */
function renderOpponent(track, idx, progress, wrong, level) {
  const n = level.length;
  track.fill.style.width = (Math.min(n, idx + progress) / n * 100).toFixed(1) + "%";
  track.count.textContent = `${Math.min(idx, n)} / ${n}`;
  track.bar.classList.toggle("wrong", wrong);
  if (idx >= n && !track.box.classList.contains("finished")) {
    track.box.classList.add("finished");
    const [x, y] = fx.anchor(track.box);
    fx.ring(x, y, fx.colors[1], 140);
  }
}

/** Искры над заполненными ползунками, салют на финише. */
function celebrate(track, from, to, level) {
  const speed = match.press;
  for (let i = from; i < Math.min(to, level.length); i++) {
    const [x, y] = course.point(i);
    fx.burst(x, y, burstColor(track.skin, level[i].arrow, i), speed ? 10 : 24, speed ? 0.7 : 1);
    course.filled(i);
    music.ding(i);
  }
  if (to >= level.length) {
    const [x, y] = fx.anchor($("stage"));
    fx.arrowsFrom(x, y, 24);
    fx.confetti(70);
  }
}

/** Цвет искр над заполненной ячейкой — под её скин. */
function burstColor(skin, arrow, i) {
  if (["gold", "ocean", "lava", "mint"].includes(skin)) return SKIN_TRAIL[skin];
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
  if (combo % 10 === 0) playStreakFx(profile ? profile.equipped.streak : "flame", el, 0.5);
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
  let myPos = 0, myWrong = false, myHolding = false;
  const mates = [];

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

    if (isMe) {
      trackMine(track, idx, wrong, level);
      myPos = idx >= level.length ? level.length + 1 : idx + progress;
      myWrong = wrong;
      myHolding = holding;
    } else {
      renderOpponent(track, idx, progress, wrong, level);
      if (track.mate && !p.left && mates.length < MAX_MATES_DRAWN) mates.push({ slot: p.slot, pos: p.idx + p.p, name: track.name, color: MATE_COLOR });
    }

    if (p.done || p.out) {
      track.badge.hidden = false;
      track.badge.textContent = p.done ? `${p.place} место` : "выбыл";
      track.badge.classList.toggle("out", !p.done);
    }
    if (track.box) track.box.classList.toggle("left", p.left || p.out);
  }

  course.frame(now, { pos: myPos, wrong: myWrong, holding: myHolding, mates, energy: music.energy(), part: music.part() });

  // подсказки для меня
  const mine = st.players.find((p) => p.slot === match.you);
  if (!mine) return;
  if (mine.done && mine.place === 1 && !match.teams) celebrateWin();
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
      need.textContent = match.mirror ? "Жми противоположную стрелку" : `Жми ${ARROW_CHAR[level[myIdx].arrow]}`;
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
  // ник в панели печатается здесь же; карусель есть только на вкладке «Матч»
  if (screen !== "modes" || modeTab !== "match" || e.repeat || e.target.matches("input, textarea")) return;
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
  if (screen !== "game" && screen !== "rhythm") return;
  const a = KEY_TO_ARROW[e.code];
  if (a === undefined) return;
  e.preventDefault();
  if (screen === "rhythm") {
    if (!e.repeat) rhythm.press(a); // в ритм-режиме считается только само нажатие
    return;
  }
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
    else if (screen === "rhythm") rhythm.press(a);
  });
  const up = () => {
    if (!key.classList.contains("down")) return;
    key.classList.remove("down");
    releaseArrow(a);
    rhythm.release(a);
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
  rhythm.release(a);
});

// переключился на другое окно — считаем, что всё отпущено
window.addEventListener("blur", () => {
  held = 0;
  for (const key of document.querySelectorAll("#touchpad .down")) key.classList.remove("down");
  pushInput();
});

boot();
