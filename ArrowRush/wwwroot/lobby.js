"use strict";

// Лобби: лидер настраивает матч, зовёт друзей и ставит ботов, скины игроков парят рядами над полом.
// Всё состояние присылает сервер (MatchManager.Lobby.cs), здесь только показ и вызовы хаба.
// Приглашения — вывеска сверху на несколько секунд и список в панели друзей.
const lobby = (() => {
  const $ = (id) => document.getElementById(id);
  const BANNER_MS = 15000;

  // ряды стоят друг за другом: передний полный, неполный — сзади; сколько в ряду, по числу игроков
  const ROWS = [{ upTo: 10, perRow: 5 }, { upTo: 21, perRow: 7 }, { upTo: 40, perRow: 10 }];
  const TURNS = ["sway", "spin", "rock", "flip", "wobble"]; // как у скина меняется поворот, см. .turn-*
  const FIG_MAX = 300;      // самый крупный скин, пикселей
  const FIG_TALL = 1.55;    // высота с ником, зазором над полом и полом к размеру скина
  const FIG_WIDE = 1.3;     // ширина с промежутком и краями пола к размеру скина

  const THEMES = [
    ["auto", "Случайный", "conic-gradient(#ff4f9a, #ffb31f, #7ee03a, #22c7f0, #ff4f9a)"],
    ["violet", "Фиолетовый", "#5a3ae8"], ["ocean", "Океан", "#1064a8"], ["neon", "Неон", "#ff50dc"], ["night", "Ночь", "#14143c"],
    ["lighthouse", "Маяк", "#ff2e4a"], ["abyss", "Бездна", "#02028e"],
  ];
  const FORMATS = [[false, "Все против всех"], [true, "Команды"]];
  const MODS = [["classic", "Классика"], ["mirror", "Зеркало"], ["blind", "Вслепую"], ["hardcore", "Хардкор"]];
  const PACES = [[false, "Обычная"], [true, "Быстрая"]];
  const DIFFS = [["easy", "Лёгкая"], ["normal", "Нормальная"], ["hard", "Сложная"]];

  let o = null;       // { conn, show, screen — текущий экран, onChange — лидерство или участие изменились }
  let cur = null;     // состояние лобби от сервера, null — не в лобби
  let invites = [];   // [{ id, from, total, max }]
  let bannerFor = null;
  let bannerTimer = 0;

  /** Вызов хаба; текст HubException показывается в строке el. */
  async function call(el, method, ...args) {
    el.textContent = "";
    try {
      await o.conn.invoke(method, ...args);
      return true;
    } catch (e) {
      el.textContent = String((e && e.message) || "").split("HubException: ")[1] || "Не получилось, попробуй ещё раз";
      return false;
    }
  }

  const act = (method, ...args) => call($("lobby-error"), method, ...args);

  // ---------- Настройки ----------

  function push(change) {
    const s = { ...cur.settings, ...change };
    act("UpdateLobby", s.mode, s.teams, s.fast, s.difficulty, s.theme, s.maxPlayers);
  }

  /** Ряд кнопок-переключателей настройки. */
  function chips(id, items, value, set) {
    $(id).replaceChildren(...items.map(([key, label, swatch]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lobby-chip" + (key === value ? " on" : "");
      b.disabled = !cur.leader || cur.inMatch;
      if (swatch) {
        const dot = document.createElement("i");
        dot.style.background = swatch;
        b.appendChild(dot);
      }
      b.append(label);
      b.addEventListener("click", () => set(key));
      return b;
    }));
  }

  function renderSettings() {
    const s = cur.settings, locked = !cur.leader || cur.inMatch;
    chips("lobby-format", FORMATS, s.teams, (teams) => push({ teams }));
    chips("lobby-mod", MODS, s.mode, (mode) => push({ mode }));
    chips("lobby-pace", PACES, s.fast, (fast) => push({ fast }));
    chips("lobby-diff", DIFFS, s.difficulty, (difficulty) => push({ difficulty }));
    chips("lobby-theme", THEMES, s.theme, (theme) => push({ theme }));

    $("lobby-max").textContent = s.maxPlayers;
    $("lobby-bots").textContent = cur.bots;
    $("lobby-range").value = s.maxPlayers;
    for (const id of ["lobby-range", "lobby-max-minus", "lobby-max-plus", "lobby-bots-minus", "lobby-bots-plus"]) $(id).disabled = locked;
    $("lobby-hint").hidden = cur.leader;
  }

  // ---------- Игроки ----------

  /**
   * Своё парение у каждого: движение зависит от ника, поэтому не меняется между обновлениями лобби.
   * Сдвиг по часам нужен, потому что ряды строятся заново: иначе анимации начинались бы с начала.
   */
  function floatStyle(fig, name) {
    let seed = 0;
    for (const ch of name) seed = (seed * 31 + ch.codePointAt(0)) >>> 0;
    const bob = 2.6 + (seed % 21) / 10, turn = 3.2 + ((seed >>> 4) % 31) / 10;
    const now = performance.now() / 1000;
    fig.classList.add(`turn-${TURNS[(seed >>> 8) % TURNS.length]}`);
    fig.style.setProperty("--tilt", `${-22 + ((seed >>> 3) % 45)}deg`);
    fig.style.setProperty("--bob", `${bob}s`);
    fig.style.setProperty("--turn", `${turn}s`);
    fig.style.setProperty("--bob-at", `${-((now + seed % 7) % bob)}s`);
    fig.style.setProperty("--turn-at", `${-((now + seed % 5) % turn)}s`);
  }

  function figure(p, size) {
    const fig = document.createElement("div");
    fig.className = "fig" + (p.you ? " you" : "");
    fig.style.setProperty("--h", `${size}px`);
    floatStyle(fig, p.name);

    const name = document.createElement("div");
    name.className = "fig-name";
    name.textContent = (p.leader ? "★ " : "") + p.name;

    const head = document.createElement("canvas");
    head.className = "fig-head";
    head.width = head.height = 168;
    course.paintHero(head, p.hero);

    const float = document.createElement("div");
    float.className = "fig-float";
    float.appendChild(head);
    const shadow = document.createElement("div");
    shadow.className = "fig-shadow";

    fig.append(name, float, shadow);

    if (cur.leader && !p.you && !cur.inMatch) {
      const kick = document.createElement("button");
      kick.type = "button";
      kick.className = "fig-kick";
      kick.textContent = "×";
      kick.setAttribute("aria-label", `Убрать: ${p.name}`);
      kick.addEventListener("click", () => act("KickFromLobby", p.name));
      fig.appendChild(kick);
    }
    return fig;
  }

  function renderStage() {
    const { players } = cur;
    const stage = $("lobby-stage");
    const { perRow } = ROWS.find((r) => players.length <= r.upTo);
    const rows = [];
    for (let i = 0; i < players.length; i += perRow) rows.push(players.slice(i, i + perRow));
    // размер подбирается под экран; первые игроки впереди, задние ряды чуть мельче
    const widest = Math.max(...rows.map((r) => r.length));
    const size = Math.min(FIG_MAX, stage.clientHeight / rows.length / FIG_TALL, stage.clientWidth / widest / FIG_WIDE);
    stage.replaceChildren(...rows.map((row, i) => {
      const el = document.createElement("div");
      el.className = "fig-row";
      el.style.zIndex = rows.length - i;
      el.style.setProperty("--h", `${size * (1 - i * 0.05)}px`); // толщина пола по размеру скинов
      el.append(...row.map((p) => figure(p, size * (1 - i * 0.05))));
      return el;
    }).reverse());
  }

  function render() {
    renderSettings();
    renderStage();
    $("lobby-count").textContent = `Игроков: ${cur.total} из ${cur.settings.maxPlayers}`;
    $("lobby-log").replaceChildren(...cur.log.map((line) => {
      const el = document.createElement("div");
      el.textContent = line;
      return el;
    }));
    $("btn-lobby-start").hidden = !cur.leader;
    $("btn-lobby-start").disabled = cur.inMatch;
  }

  function onState(state) {
    const was = cur;
    cur = state;
    if (!was || !cur || was.leader !== cur.leader) o.onChange();
    if (cur) {
      if (!was && o.screen() !== "game") o.show("lobby"); // размер скинов считается по видимой сцене
      render();
      if (was && o.screen() === "lobby" && !cur.inMatch) $("lobby-error").textContent = "";
    } else if (o.screen() === "lobby") {
      o.show("menu");
    }
  }

  // ---------- Приглашения ----------

  function hideBanner() {
    clearTimeout(bannerTimer);
    bannerFor = null;
    $("invite-banner").hidden = true;
  }

  function showBanner(invite) {
    bannerFor = invite.id;
    $("invite-text").textContent = `${invite.from} приглашает в лобби · ${invite.total} из ${invite.max}`;
    $("invite-error").textContent = "";
    $("invite-banner").hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, BANNER_MS); // в панели друзей приглашение останется
    music.ding(4);
  }

  function onInvites(list) {
    const known = new Set(invites.map((i) => i.id));
    invites = list;
    if (bannerFor && !list.some((i) => i.id === bannerFor)) hideBanner();
    const fresh = list.find((i) => !known.has(i.id));
    if (fresh) showBanner(fresh);
    social.setInvites(list);
  }

  const accept = (id, el) => call(el, "JoinLobby", id);
  const decline = (id) => o.conn.invoke("DeclineInvite", id).catch(() => {});

  function init(options) {
    o = options;
    o.conn.on("lobby", onState);
    o.conn.on("lobbyInvites", onInvites);
    addEventListener("resize", () => { if (cur && o.screen() === "lobby") renderStage(); });

    $("btn-lobby-create").addEventListener("click", () => call($("lobby-create-error"), "CreateLobby"));
    $("btn-lobby-exit").addEventListener("click", async () => {
      await act("LeaveLobby");
    });
    $("btn-lobby-start").addEventListener("click", () => act("StartLobby"));
    $("btn-lobby-invite").addEventListener("click", () => social.openList());

    const step = (id, delta) => $(id).addEventListener("click", () => push({ maxPlayers: cur.settings.maxPlayers + delta }));
    step("lobby-max-minus", -1);
    step("lobby-max-plus", 1);
    $("lobby-range").addEventListener("change", (e) => push({ maxPlayers: Number(e.target.value) }));
    $("lobby-range").addEventListener("input", (e) => { $("lobby-max").textContent = e.target.value; });
    $("lobby-bots-minus").addEventListener("click", () => act("SetLobbyBots", cur.bots - 1));
    $("lobby-bots-plus").addEventListener("click", () => act("SetLobbyBots", cur.bots + 1));

    $("invite-accept").addEventListener("click", async () => {
      const id = bannerFor;
      if (await accept(id, $("invite-error"))) hideBanner();
    });
    $("invite-decline").addEventListener("click", () => {
      decline(bannerFor);
      hideBanner();
    });
  }

  /** Связь пропала: сервер уже вывел игрока из лобби. */
  function reset() {
    onState(null);
    hideBanner();
  }

  /** Подключились: приглашения могли прийти раньше. */
  async function sync() {
    try {
      invites = await o.conn.invoke("LobbyInvites");
      social.setInvites(invites);
    } catch { /* придут событием */ }
  }

  return {
    init, reset, sync, accept, decline,
    active: () => !!cur,
    canInvite: () => !!cur && cur.leader,
    invite: (name, el) => call(el, "InviteToLobby", name),
  };
})();
