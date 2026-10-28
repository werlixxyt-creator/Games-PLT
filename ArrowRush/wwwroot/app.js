"use strict";

// Стрелки: 0 ← 1 ↑ 2 → 3 ↓ (так же, как enum Arrow на сервере)
const KEY_TO_ARROW = {
  ArrowLeft: 0, ArrowUp: 1, ArrowRight: 2, ArrowDown: 3,
  KeyA: 0, KeyW: 1, KeyD: 2, KeyS: 3,
};
const ROTATION = [-90, 0, 90, 180];
const ARROW_CHAR = ["←", "↑", "→", "↓"];

const MODES = {
  classic: { name: "Классика" },
  speed: { name: "Скорость" },
};

const $ = (id) => document.getElementById(id);

// ---------- Состояние клиента ----------

let screen = "menu";
let match = null;        // данные текущего матча + DOM дорожек
let lastState = null;    // последний снимок от сервера
let stateAt = 0;         // когда он пришёл (performance.now)
let held = 0;            // какие стрелки зажаты (битовая маска)
let sentHeld = -1;       // что последним отправили серверу
let search = null;       // { startedAt, inQueue, botAfter, timer }
let online = false;      // хотим ли быть подключены к хабу (false после выхода из аккаунта)
let profile = null;      // ответ /api/account/me
let gameMode = "classic";
try { if (MODES[localStorage.getItem("arrowrush.mode")]) gameMode = localStorage.getItem("arrowrush.mode"); } catch { /* приватный режим */ }

// «Скорость»: свой прогресс считаем сразу по нажатию, не дожидаясь сервера
let pred = { idx: 0, stunUntil: 0, lastPress: 0 };
let combo = 0;           // «Скорость»: ползунков подряд без ошибки

// ---------- Экраны ----------

function show(name) {
  for (const s of ["auth", "menu", "search", "game", "results"]) {
    $("screen-" + s).classList.toggle("active", s === name);
  }
  screen = name;
  fx.setCalm(name === "game");
  if (name === "menu") refreshProfile();
}

function setConn(text, kind) {
  const el = $("conn-status");
  el.textContent = text;
  el.className = "conn " + (kind || "");
}

// ---------- Подключение к серверу ----------

const conn = new signalR.HubConnectionBuilder()
  .withUrl("/hub")
  .withAutomaticReconnect()
  .build();

conn.onreconnecting(() => {
  setConn("Связь потеряна, переподключаюсь…", "bad");
  $("btn-find").disabled = true;
});

conn.onreconnected(() => {
  $("btn-find").disabled = false;
  if (screen === "game" || screen === "search") {
    // после переподключения сервер считает, что мы вышли
    abortToMenu("Соединение прерывалось — матч отменён");
  } else {
    setConn("Подключено", "ok");
  }
});

conn.onclose(() => {
  $("btn-find").disabled = true;
  if (!online) return; // сами отключились при выходе из аккаунта
  setConn("Нет связи с сервером. Обнови страницу.", "bad");
});

async function connect() {
  if (!online || conn.state !== signalR.HubConnectionState.Disconnected) return;
  setConn("Подключение к серверу…");
  try {
    await conn.start();
    setConn("Подключено", "ok");
    $("btn-find").disabled = false;
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

function setGameMode(mode) {
  gameMode = mode;
  try { localStorage.setItem("arrowrush.mode", mode); } catch { /* ничего */ }
  for (const t of document.querySelectorAll("#mode-tabs [data-game-mode]")) {
    const on = t.dataset.gameMode === mode;
    t.classList.toggle("active", on);
    t.setAttribute("aria-checked", on);
  }
  renderStats();
}

for (const t of document.querySelectorAll("#mode-tabs [data-game-mode]")) {
  t.addEventListener("click", () => {
    if (t.dataset.gameMode === gameMode) return;
    setGameMode(t.dataset.gameMode);
    const [x, y] = fx.anchor(t);
    fx.ring(x, y, getComputedStyle(t).getPropertyValue("--c").trim(), 110);
  });
}
setGameMode(gameMode);

/** Статистика выбранного режима (числа докручиваются) + подписи на карточках режимов. */
function renderStats() {
  if (!profile) return;
  const s = profile.stats[gameMode];
  fx.countUp($("st-games"), s.games);
  fx.countUp($("st-wins"), s.wins);
  if (s.games) fx.countUp($("st-rate"), Math.round((s.wins / s.games) * 100));
  else $("st-rate").textContent = "—";
  fx.countUp($("st-sliders"), s.sliders);

  for (const t of document.querySelectorAll("#mode-tabs [data-game-mode]")) {
    const m = profile.stats[t.dataset.gameMode];
    t.querySelector(".mc-meta").textContent = m.games ? `Побед: ${m.wins} из ${m.games}` : "Ещё не играл";
  }
}

function applyProfile(p) {
  profile = p;
  $("profile-name").textContent = p.userName;
  $("profile-avatar").textContent = p.userName.slice(0, 1).toUpperCase();
  renderStats();

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
    tag.textContent = MODES[m.mode].name.toLowerCase();
    what.append(text, tag);

    const when = document.createElement("span");
    when.className = "res-time";
    when.textContent = formatDate(new Date(m.playedAt));

    li.append(place, what, when);
    list.appendChild(li);
  });
  $("history").hidden = p.recent.length === 0;
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

$("btn-find").addEventListener("click", findMatch);
$("btn-again").addEventListener("click", findMatch);
$("btn-menu").addEventListener("click", () => show("menu"));

$("btn-cancel").addEventListener("click", () => {
  conn.invoke("CancelSearch").catch(() => {});
  stopSearch();
  show("menu");
});

$("btn-leave").addEventListener("click", () => {
  conn.invoke("LeaveMatch").catch(() => {});
  match = null;
  show("menu");
});

async function findMatch() {
  if (conn.state !== signalR.HubConnectionState.Connected) return;

  search = { startedAt: performance.now(), inQueue: 1, botAfter: 12, timer: null };
  search.timer = setInterval(updateSearch, 250);
  updateSearch();
  $("search-mode").textContent = `Режим: ${MODES[gameMode].name}`;
  show("search");

  try {
    await conn.invoke("FindMatch", gameMode);
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
    you: d.you,
    level: d.level,
    players: d.players,
    idleDrain: d.idleDrain,
    wrongDrain: d.wrongDrain,
    stun: d.stun,
    tracks: new Map(),
  };
  pred = { idx: 0, stunUntil: 0, lastPress: 0 };
  combo = 0;
  $("combo").hidden = true;
  const speed = d.mode === "speed";

  // моя дорожка
  const me = d.players.find((p) => p.slot === d.you);
  $("my-track").classList.toggle("speed", speed);
  const myTrack = buildTrack($("my-track"), d.level);
  myTrack.mine = true;
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
    trackEl.className = speed ? "track speed" : "track";
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
    players: d.players.map((p) => ({ slot: p.slot, idx: 0, p: 0, held: 0, stun: false, done: false, place: 0, left: false })),
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

  $("res-sub").textContent = me && me.done
    ? `Твоё время: ${me.time.toFixed(2)} с`
    : me ? `Заполнено ${me.sliders} из ${r.total} ползунков` : "";

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
    time.textContent = x.done ? `${x.time.toFixed(2)} с` : x.left ? "вышел" : `${x.sliders}/${r.total}`;

    li.append(place, name, time);
    list.appendChild(li);
  });

  show("results");

  if (win) {
    fx.confetti(180);
    const [x, y] = fx.anchor(title);
    fx.arrowsFrom(x, y, 28);
  }
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
    const speed = match.mode === "speed";
    for (let i = from; i < Math.min(to, level.length); i++) {
      const [x, y] = fx.anchor(track.sliders[i].el.querySelector(".bar"), true);
      fx.burst(x, y, fx.colors[level[i].arrow], speed ? 10 : 24, speed ? 0.7 : 1);
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

/** «Скорость»: счётчик серии без ошибок. */
function showCombo() {
  const el = $("combo");
  if (combo < 3) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = `x${combo}`;
  el.classList.toggle("hot", combo >= 10);
  fx.retrigger(el, "pop");
}

/** «Скорость»: сверяем своё предсказание с сервером. */
function syncPrediction(server, now) {
  if (server.done) pred.idx = match.level.length;
  // сервер впереди — догоняем сразу; расходимся в другую сторону — ждём, пока дойдут последние нажатия
  else if (server.idx > pred.idx || (server.idx !== pred.idx && now - pred.lastPress > 400)) pred.idx = server.idx;
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

  const speed = match.mode === "speed";

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
        wrong = now < pred.stunUntil;
      } else {
        wrong = p.stun;
      }
    } else {
      const mask = t < 0 ? 0 : isMe ? held : p.held;

      // предсказание своего ползунка между снимками сервера — чтобы было плавно
      if (isMe && t >= 0 && !p.done && !p.left && p.idx < level.length) {
        const target = 1 << level[p.idx].arrow;
        if (held === 0) progress -= match.idleDrain * elapsed;
        else if ((held & ~target) !== 0) progress -= match.wrongDrain * elapsed;
        else progress += elapsed / level[p.idx].fill;
        progress = Math.min(1, Math.max(0, progress));
      }

      if (idx < level.length) {
        const target = 1 << level[idx].arrow;
        wrong = (mask & ~target) !== 0;
        holding = mask === target;
      }
    }

    renderTrack(track, idx, progress, wrong, holding, level);

    if (p.done) {
      track.badge.hidden = false;
      track.badge.textContent = `${p.place} место`;
    }
    if (track.box) track.box.classList.toggle("left", p.left);
  }

  // подсказки для меня
  const mine = st.players.find((p) => p.slot === match.you);
  if (!mine) return;

  const myIdx = speed ? pred.idx : mine.idx;
  const myDone = mine.done || myIdx >= level.length;
  $("hud-count").textContent = `${Math.min(myIdx + (myDone ? 0 : 1), level.length)} / ${level.length}`;

  const need = $("need");
  need.classList.remove("bad");
  if (myDone) {
    need.textContent = `Финиш! Ждём остальных…`;
  } else if (t < 0) {
    need.textContent = `Первая стрелка: ${ARROW_CHAR[level[0].arrow]}`;
  } else if (speed) {
    if (now < pred.stunUntil) {
      need.textContent = "Не та стрелка! Пауза…";
      need.classList.add("bad");
    } else {
      need.textContent = `Жми ${ARROW_CHAR[level[myIdx].arrow]}`;
    }
  } else {
    const target = 1 << level[mine.idx].arrow;
    if ((held & ~target) !== 0) {
      need.textContent = "Не та стрелка!";
      need.classList.add("bad");
    } else if (held === 0) {
      need.textContent = `Держи ${ARROW_CHAR[level[mine.idx].arrow]}`;
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

window.addEventListener("keydown", (e) => {
  if (screen !== "game") return;
  const a = KEY_TO_ARROW[e.code];
  if (a === undefined) return;
  e.preventDefault();
  const bit = 1 << a;
  if (!(held & bit)) predictPress(bit); // автоповтор зажатой клавиши — не новое нажатие
  held |= bit;
  pushInput();
});

/** «Скорость»: те же правила, что на сервере (Match.Press), — чтобы ползунок заполнялся мгновенно. */
function predictPress(bit) {
  if (!match || match.mode !== "speed" || !lastState) return;
  const now = performance.now();
  const t = lastState.t + Math.min((now - stateAt) / 1000, 0.2);
  if (t < 0 || pred.idx >= match.level.length || now < pred.stunUntil) return;

  pred.lastPress = now;
  if (bit === 1 << match.level[pred.idx].arrow) {
    pred.idx++;
    combo++;
  } else {
    pred.stunUntil = now + match.stun * 1000;
    combo = 0;
  }
  showCombo();
}

window.addEventListener("keyup", (e) => {
  const a = KEY_TO_ARROW[e.code];
  if (a === undefined) return;
  held &= ~(1 << a);
  pushInput();
});

// переключился на другое окно — считаем, что всё отпущено
window.addEventListener("blur", () => {
  held = 0;
  pushInput();
});

boot();
